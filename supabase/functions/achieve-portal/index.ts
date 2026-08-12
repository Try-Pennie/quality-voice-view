// achieve-portal edge function (PSAI-204)
//
// Server boundary for the external-facing /achieve portal. The browser never
// touches eavesly tables for Achieve rows: it POSTs here with the portal
// password, the password is validated against a server-side secret
// (ACHIEVE_PORTAL_PASSWORD, set via `supabase secrets set` — never committed),
// and reads/writes run with the service role, scoped to the Achieve module.
//
// Actions:
//   verify           — password check only (unlock gate)
//   list             — { alerts, all_calls, backfill_audit } with server-trimmed
//                      transcripts and withheld-row sanitization (see portal-logic.ts)
//   submit_feedback  — validated upsert into eavesly_alert_feedback
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import {
  ACHIEVE_MODULE_NAME,
  buildAgentFeedbackView,
  buildPortalRow,
  canSubmitPortalFeedback,
  isCompetitorTransfer,
  isQueueRow,
  parseWelcomeAgentLookupRow,
  partitionPortalRows,
  validateFeedback,
  type AgentFeedbackRow,
  type WelcomeAgentIdentity,
} from "./portal-logic.ts"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

// Pagination for the module-results scan. PostgREST silently caps every
// response at ~1000 rows regardless of .limit(), so we page in 500-row .range()
// windows and stop at separate normal/audit ceilings. The Achieve pilot is
// small enough that each newest-1000 window covers its surface; if either
// outgrows that, add a date-window request param instead of raising the cap.
const PAGE_SIZE = 500
const MAX_LIST_ROWS = 1000
const MAX_AUDIT_ROWS = 1000
const ID_CHUNK_SIZE = 200
const AUDIT_ONLY_MARKER = { backfill: { audit_only: true } }

const MODULE_RESULT_COLUMNS =
  "id, created_at, call_id, module_name, violation_type, has_violation, alert_sent, alert_sent_at, contact_name, contact_phone, recording_link, transcript_url, call_summary, processing_time_ms, result_json, sfdc_lead_id"

const FEEDBACK_COLUMNS =
  "id, call_id, module_name, manager_email, accurate, action_taken, inaccuracy_reason, comment, reviewed_at"

const AGENT_FEEDBACK_COLUMNS =
  "id, lead_phone_raw, achieve_agent_name, accent, background_noise, connection_issues, call_quality, notes, submitted_by, submitted_at, matched_call_id, matched_eavesly_call_id, call_match_status, call_match_confidence, call_match_reason"

// Cap for the standalone unmatched-feedback list.
const MAX_UNMATCHED_FEEDBACK = 200

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  })
}

// Compare SHA-256 digests so the comparison is constant-time and
// length-independent.
async function passwordMatches(supplied: string, expected: string) {
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(supplied)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ])
  const av = new Uint8Array(a)
  const bv = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i]
  return diff === 0
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)

  // deno-lint-ignore no-explicit-any
  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: "bad_json" }, 400)
  }

  const expected = Deno.env.get("ACHIEVE_PORTAL_PASSWORD")
  if (!expected) return json({ error: "not_configured" }, 503)

  const supplied = typeof body?.password === "string" ? body.password : ""
  if (!supplied || !(await passwordMatches(supplied, expected))) {
    // Fixed small delay blunts brute force; add per-IP rate limiting if the
    // portal ever sees abuse.
    await new Promise(resolve => setTimeout(resolve, 400))
    return json({ error: "invalid_password" }, 401)
  }

  const action = body?.action
  if (action === "verify") return json({ ok: true })

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  if (action === "list") {
    // Fetch ordinary and audit-only module rows independently. Audit rows cannot
    // consume the normal MAX_LIST_ROWS budget and therefore cannot skew normal
    // All calls metrics by displacing ordinary rows from the capped result set.
    // eavesly_module_results.result_json is schema-NOT-NULL (and production has
    // zero NULL rows), so NOT-containment cannot drop a NULL from the normal path.
    // deno-lint-ignore no-explicit-any
    const normalCandidates: any[] = []
    for (let offset = 0; offset < MAX_LIST_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await admin
        .from("eavesly_module_results")
        .select(MODULE_RESULT_COLUMNS)
        .eq("module_name", ACHIEVE_MODULE_NAME)
        .not("result_json", "cs", JSON.stringify(AUDIT_ONLY_MARKER))
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1)
      if (error) {
        console.error("achieve normal list error", error)
        return json({ error: "list_failed" }, 500)
      }
      const page = data ?? []
      normalCandidates.push(...page.filter(row => !isCompetitorTransfer(row.result_json)))
      if (page.length < PAGE_SIZE) break
    }
    if (normalCandidates.length >= MAX_LIST_ROWS) {
      console.warn(
        `achieve normal list hit MAX_LIST_ROWS (${MAX_LIST_ROWS}); older rows not returned. Consider a date-window param.`,
      )
    }

    // deno-lint-ignore no-explicit-any
    const auditCandidates: any[] = []
    for (let offset = 0; offset < MAX_AUDIT_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await admin
        .from("eavesly_module_results")
        .select(MODULE_RESULT_COLUMNS)
        .eq("module_name", ACHIEVE_MODULE_NAME)
        .contains("result_json", AUDIT_ONLY_MARKER)
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1)
      if (error) {
        console.error("achieve backfill audit list error", error)
        return json({ error: "list_failed" }, 500)
      }
      const page = data ?? []
      auditCandidates.push(...page.filter(row => !isCompetitorTransfer(row.result_json)))
      if (page.length < PAGE_SIZE) break
    }
    if (auditCandidates.length >= MAX_AUDIT_ROWS) {
      console.warn(
        `achieve backfill audit hit MAX_AUDIT_ROWS (${MAX_AUDIT_ROWS}); older audit rows not returned.`,
      )
    }

    // Parse the exact marker again at the projection boundary. This fail-closed
    // partition guards against filter/serialization drift in either query.
    const normalRows = partitionPortalRows(normalCandidates).normalRows
    const auditRows = partitionPortalRows(auditCandidates).auditRows
    const callRows = [...normalRows, ...auditRows]

    const callIds = Array.from(
      new Set(callRows.map(row => row.call_id).filter(Boolean)),
    )
    const sfdcLeadIds = Array.from(
      new Set(
        callRows.flatMap(row =>
          typeof row.sfdc_lead_id === "string" && row.sfdc_lead_id.trim()
            ? [row.sfdc_lead_id]
            : []
        ),
      ),
    )
    const welcomeAgentByLead = new Map<string, WelcomeAgentIdentity>()
    for (let i = 0; i < sfdcLeadIds.length; i += ID_CHUNK_SIZE) {
      const { data, error } = await admin.rpc(
        "get_achieve_welcome_agents_for_leads",
        { p_sfdc_lead_ids: sfdcLeadIds.slice(i, i + ID_CHUNK_SIZE) },
      )
      if (error) {
        // Attribution is additive: keep the QA portal available when the bridge
        // sync/RPC is temporarily unavailable, but make the loss observable.
        console.error("achieve welcome-agent lookup error", error)
        continue
      }
      for (const rawRow of data ?? []) {
        const parsed = parseWelcomeAgentLookupRow(rawRow)
        if (!parsed) continue
        welcomeAgentByLead.set(parsed.sfdc_lead_id, {
          achieve_agent_name: parsed.achieve_agent_name,
          achieve_agent_email: parsed.achieve_agent_email,
        })
      }
    }

    // deno-lint-ignore no-explicit-any
    const transcriptByCall = new Map<string, any>()
    // deno-lint-ignore no-explicit-any
    const feedbackByCall = new Map<string, any>()
    const agentFeedbackByCall = new Map<string, AgentFeedbackRow[]>()
    // Chunk the .in() lookups: up to MAX_LIST_ROWS ids would blow past URL /
    // response limits, so fetch in ID_CHUNK_SIZE batches and merge the maps.
    for (let i = 0; i < callIds.length; i += ID_CHUNK_SIZE) {
      const chunk = callIds.slice(i, i + ID_CHUNK_SIZE)
      const [transcriptsRes, feedbackRes, agentFeedbackRes] = await Promise.all([
        admin
          .from("eavesly_transcription_qa")
          .select("call_id, original_transcript, transcription_link, recording_link")
          .in("call_id", chunk),
        admin
          .from("eavesly_alert_feedback")
          .select(FEEDBACK_COLUMNS)
          .eq("module_name", ACHIEVE_MODULE_NAME)
          .in("call_id", chunk),
        admin
          .from("achieve_agent_feedback")
          .select(AGENT_FEEDBACK_COLUMNS)
          .in("matched_call_id", chunk)
          .order("submitted_at", { ascending: true }),
      ])
      if (transcriptsRes.error) console.error("achieve transcripts error", transcriptsRes.error)
      if (feedbackRes.error) console.error("achieve feedback error", feedbackRes.error)
      if (agentFeedbackRes.error) {
        console.error("achieve agent feedback error", agentFeedbackRes.error)
        return json({ error: "list_failed" }, 500)
      }
      for (const row of transcriptsRes.data ?? []) {
        if (row.call_id) transcriptByCall.set(row.call_id, row)
      }
      for (const row of feedbackRes.data ?? []) {
        if (row.call_id) feedbackByCall.set(row.call_id, row)
      }
      for (const row of agentFeedbackRes.data ?? []) {
        if (!row.matched_call_id) continue
        const bucket = agentFeedbackByCall.get(row.matched_call_id)
        if (bucket) bucket.push(row)
        else agentFeedbackByCall.set(row.matched_call_id, [row])
      }
    }

    // Feedback without an Achieve QA module match stays visible. The explicit
    // projection separates high-confidence call-found/QA-missing rows from rows
    // where no unambiguous Eavesly call was found.
    const [qaMissingResult, unmatchedResult] = await Promise.all([
      admin
        .from("achieve_agent_feedback")
        .select(AGENT_FEEDBACK_COLUMNS)
        .is("matched_call_id", null)
        .not("matched_eavesly_call_id", "is", null)
        .order("submitted_at", { ascending: false })
        .limit(MAX_UNMATCHED_FEEDBACK),
      admin
        .from("achieve_agent_feedback")
        .select(AGENT_FEEDBACK_COLUMNS)
        .is("matched_call_id", null)
        .is("matched_eavesly_call_id", null)
        .order("submitted_at", { ascending: false })
        .limit(MAX_UNMATCHED_FEEDBACK),
    ])
    if (qaMissingResult.error || unmatchedResult.error) {
      if (qaMissingResult.error) {
        console.error("achieve QA-missing agent feedback error", qaMissingResult.error)
      }
      if (unmatchedResult.error) {
        console.error("achieve unmatched agent feedback error", unmatchedResult.error)
      }
      return json({ error: "list_failed" }, 500)
    }

    const qaMissingAgentFeedback = (qaMissingResult.data ?? [])
      .map(row => buildAgentFeedbackView(row, true))
    const unmatchedAgentFeedback = (unmatchedResult.data ?? [])
      .map(row => buildAgentFeedbackView(row, true))

    // deno-lint-ignore no-explicit-any
    const toRow = (row: any) =>
      buildPortalRow(
        row,
        transcriptByCall.get(row.call_id),
        feedbackByCall.get(row.call_id),
        agentFeedbackByCall.get(row.call_id) ?? [],
        typeof row.sfdc_lead_id === "string"
          ? welcomeAgentByLead.get(row.sfdc_lead_id)
          : undefined,
      )
    return json({
      alerts: normalRows.filter(row => isQueueRow(row)).map(toRow),
      all_calls: normalRows.map(toRow),
      backfill_audit: auditRows.map(toRow),
      qa_missing_agent_feedback: qaMissingAgentFeedback,
      unmatched_agent_feedback: unmatchedAgentFeedback,
    })
  }

  if (action === "submit_feedback") {
    const validated = validateFeedback(body?.feedback)
    if (!validated.ok) return json({ error: validated.error }, 400)

    // Only accept feedback for calls that actually have an ordinary Achieve
    // module row. Parse every persisted result for the call and fail closed if
    // any exact audit-only row exists; the UI is not the authorization boundary.
    const { data: moduleRows, error: moduleErr } = await admin
      .from("eavesly_module_results")
      .select("id, result_json")
      .eq("module_name", ACHIEVE_MODULE_NAME)
      .eq("call_id", validated.payload.call_id)
    if (moduleErr) {
      console.error("achieve module lookup error", moduleErr)
      return json({ error: "feedback_failed" }, 500)
    }
    if (!moduleRows || moduleRows.length === 0) return json({ error: "unknown_call" }, 404)
    if (moduleRows.some(row => !canSubmitPortalFeedback(row.result_json))) {
      return json({ error: "audit_read_only" }, 403)
    }

    const { error } = await admin
      .from("eavesly_alert_feedback")
      .upsert(
        { ...validated.payload, reviewed_at: new Date().toISOString() },
        { onConflict: "call_id,module_name" },
      )
    if (error) {
      console.error("achieve feedback upsert error", error)
      return json({ error: "feedback_failed" }, 500)
    }
    return json({ ok: true })
  }

  return json({ error: "unknown_action" }, 400)
})
