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
//   list             — { alerts, all_calls } with server-trimmed transcripts
//                      and withheld-row sanitization (see portal-logic.ts)
//   submit_feedback  — validated upsert into eavesly_alert_feedback
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import {
  ACHIEVE_MODULE_NAME,
  buildPortalRow,
  validateFeedback,
} from "./portal-logic.ts"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const LIST_LIMIT = 100

const MODULE_RESULT_COLUMNS =
  "id, created_at, call_id, module_name, violation_type, has_violation, alert_sent, alert_sent_at, contact_name, contact_phone, recording_link, transcript_url, call_summary, processing_time_ms, result_json"

const ALERT_VIEW_COLUMNS =
  "module_result_id, alert_created_at, alert_sent_at, call_id, module_name, violation_type, has_violation, alert_sent, contact_name, contact_phone, recording_link, transcript_url, call_summary, processing_time_ms, result_json, feedback_id, feedback_by, accurate, action_taken, inaccuracy_reason, feedback_comment, reviewed_at"

const FEEDBACK_COLUMNS =
  "id, call_id, module_name, manager_email, accurate, action_taken, inaccuracy_reason, comment, reviewed_at"

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
    const [alertsRes, callsRes] = await Promise.all([
      admin
        .from("eavesly_alerts_with_feedback")
        .select(ALERT_VIEW_COLUMNS)
        .eq("module_name", ACHIEVE_MODULE_NAME)
        .order("alert_created_at", { ascending: false })
        .limit(LIST_LIMIT),
      admin
        .from("eavesly_module_results")
        .select(MODULE_RESULT_COLUMNS)
        .eq("module_name", ACHIEVE_MODULE_NAME)
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT),
    ])
    if (alertsRes.error || callsRes.error) {
      console.error("achieve list error", alertsRes.error ?? callsRes.error)
      return json({ error: "list_failed" }, 500)
    }
    const alertRows = alertsRes.data ?? []
    const callRows = callsRes.data ?? []

    const callIds = Array.from(
      new Set(
        [...alertRows, ...callRows].map(row => row.call_id).filter(Boolean),
      ),
    )
    // deno-lint-ignore no-explicit-any
    const transcriptByCall = new Map<string, any>()
    // deno-lint-ignore no-explicit-any
    const feedbackByCall = new Map<string, any>()
    if (callIds.length > 0) {
      const [transcriptsRes, feedbackRes] = await Promise.all([
        admin
          .from("eavesly_transcription_qa")
          .select("call_id, original_transcript, transcription_link, recording_link")
          .in("call_id", callIds),
        admin
          .from("eavesly_alert_feedback")
          .select(FEEDBACK_COLUMNS)
          .eq("module_name", ACHIEVE_MODULE_NAME)
          .in("call_id", callIds),
      ])
      if (transcriptsRes.error) console.error("achieve transcripts error", transcriptsRes.error)
      if (feedbackRes.error) console.error("achieve feedback error", feedbackRes.error)
      for (const row of transcriptsRes.data ?? []) {
        if (row.call_id) transcriptByCall.set(row.call_id, row)
      }
      for (const row of feedbackRes.data ?? []) {
        if (row.call_id) feedbackByCall.set(row.call_id, row)
      }
    }

    // deno-lint-ignore no-explicit-any
    const toRow = (row: any) =>
      buildPortalRow(row, transcriptByCall.get(row.call_id), feedbackByCall.get(row.call_id))
    return json({
      alerts: alertRows.map(toRow),
      all_calls: callRows.map(toRow),
    })
  }

  if (action === "submit_feedback") {
    const validated = validateFeedback(body?.feedback)
    if (!validated.ok) return json({ error: validated.error }, 400)

    // Only accept feedback for calls that actually have an Achieve module row —
    // keeps this boundary from writing rows for arbitrary call ids.
    const { data: moduleRow, error: moduleErr } = await admin
      .from("eavesly_module_results")
      .select("id")
      .eq("module_name", ACHIEVE_MODULE_NAME)
      .eq("call_id", validated.payload.call_id)
      .limit(1)
      .maybeSingle()
    if (moduleErr) {
      console.error("achieve module lookup error", moduleErr)
      return json({ error: "feedback_failed" }, 500)
    }
    if (!moduleRow) return json({ error: "unknown_call" }, 404)

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
