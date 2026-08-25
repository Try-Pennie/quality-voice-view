// achieve-portal edge function (PSAI-204)
//
// Authenticated server boundary for the external Achieve portal.
//
// Compatibility contract for backend-first rollout:
//   verify                    — legacy password-only unlock
//   list                      — legacy monolithic full response
//   list_overview             — optimized lightweight initial response
//   detail                    — one full drawer row
//   list_audit                — deferred lightweight audit rows
//   list_feedback_exceptions  — deferred capped exception lists
//   get_feedback_overview     — complete Form + ordinary AI QA representative rollups
//   get_management_report     — completed 2/4/6-week Form-led rankings and dashboards
//   list_feedback_for_rep     — Form notes + AI call summaries for one exact representative
//   submit_feedback           — existing validated write semantics
//
// Keep verify/list until a separately approved cleanup after the new frontend
// is deployed; the function must remain a superset during rollout.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import {
  ACHIEVE_REPORT_REPRESENTATIVE_LIMIT,
  loadAchieveManagementReport,
} from "../_shared/achieve-management-report.ts"
import {
  ACHIEVE_MODULE_NAME,
  buildAgentFeedbackView,
  buildPortalListRow,
  buildPortalRow,
  canSubmitPortalFeedback,
  feedbackLeadershipSnapshotsAgree,
  isAuditOnlyResult,
  isCompetitorTransfer,
  isQueueRow,
  parseWelcomeAgentLookupRow,
  partitionPortalRows,
  validateFeedback,
  type AgentFeedbackRow,
  type FeedbackRow,
  type WelcomeAgentIdentity,
} from "./portal-logic.ts"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const PAGE_SIZE = 500
const MAX_LIST_ROWS = 1000
const MAX_AUDIT_ROWS = 1000
const ID_CHUNK_SIZE = 200
// The normal/audit windows are capped at 1000, so each enrichment query
// family has at most five chunks (up to 15 bounded requests across the three
// concurrently started families). Keep this explicit if either cap changes.
const MAX_CONCURRENT_CHUNKS = 5
const MAX_CONCURRENT_LEGACY_CHUNKS = 10
const MAX_UNMATCHED_FEEDBACK = 200
const MAX_FEEDBACK_REPRESENTATIVES = 200
const MAX_REPRESENTATIVE_FEEDBACK_ROWS = 200
const AUDIT_ONLY_MARKER = { backfill: { audit_only: true } }
const COMPETITOR_TRANSFER_MARKER = { grading_skipped: true, skip_reason: "competitor_transfer" }

const LIST_MODULE_RESULT_COLUMNS =
  "id, created_at, call_id, module_name, violation_type, has_violation, contact_name, contact_phone, result_json, sfdc_lead_id"
const DETAIL_MODULE_RESULT_COLUMNS =
  "id, created_at, call_id, module_name, violation_type, has_violation, alert_sent, alert_sent_at, contact_name, contact_phone, recording_link, transcript_url, call_summary, processing_time_ms, result_json, sfdc_lead_id"
const FEEDBACK_COLUMNS =
  "id, call_id, module_name, manager_email, accurate, action_taken, inaccuracy_reason, comment, reviewed_at"
const AGENT_FEEDBACK_COLUMNS =
  "id, lead_phone_raw, achieve_agent_name, accent, background_noise, connection_issues, call_quality, notes, submitted_by, submitted_at, matched_call_id, matched_eavesly_call_id, call_match_status, call_match_confidence, call_match_reason, call_match_provenance, call_match_method, call_match_evidence"

type BoundaryRow = Record<string, unknown>
type AdminClient = ReturnType<typeof createClient>

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  })
}

function parseRecord(value: unknown): BoundaryRow | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  // SAFETY: Runtime checks establish the only record invariant used at this
  // protocol boundary; individual fields are refined before use.
  return value as BoundaryRow
}

function parseRepresentativeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().toLowerCase()
  if (normalized.length < 3 || normalized.length > 254 || !/^\S+@\S+\.\S+$/.test(normalized)) return null
  return normalized
}

function nullableProjectedString(value: unknown): string | null | undefined {
  return value === null || typeof value === "string" ? value : undefined
}

function parseFeedbackRow(value: unknown): FeedbackRow | null {
  const row = parseRecord(value)
  if (!row || typeof row.id !== "number" || typeof row.call_id !== "string") return null
  if (typeof row.module_name !== "string") return null
  return {
    id: row.id,
    call_id: row.call_id,
    module_name: row.module_name,
    manager_email: typeof row.manager_email === "string" ? row.manager_email : null,
    accurate: typeof row.accurate === "boolean" ? row.accurate : null,
    action_taken: typeof row.action_taken === "string" ? row.action_taken : null,
    inaccuracy_reason: typeof row.inaccuracy_reason === "string" ? row.inaccuracy_reason : null,
    comment: typeof row.comment === "string" ? row.comment : null,
    reviewed_at: typeof row.reviewed_at === "string" ? row.reviewed_at : null,
  }
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null
}

function chunks<T>(values: readonly T[], maximumChunks = MAX_CONCURRENT_CHUNKS): T[][] {
  const result: T[][] = []
  for (let offset = 0; offset < values.length; offset += ID_CHUNK_SIZE) {
    result.push(values.slice(offset, offset + ID_CHUNK_SIZE))
  }
  if (result.length > maximumChunks) {
    throw new Error("achieve list chunk bound exceeded")
  }
  return result
}

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

async function fetchWelcomeAgents(
  admin: AdminClient,
  rows: readonly BoundaryRow[],
  maximumChunks = MAX_CONCURRENT_CHUNKS,
): Promise<Map<string, WelcomeAgentIdentity>> {
  const leadIds = Array.from(new Set(rows.flatMap(row =>
    typeof row.sfdc_lead_id === "string" && row.sfdc_lead_id.trim()
      ? [row.sfdc_lead_id]
      : []
  )))
  const welcomeAgentByLead = new Map<string, WelcomeAgentIdentity>()
  const results = await Promise.all(chunks(leadIds, maximumChunks).map(chunk =>
    admin.rpc("get_achieve_welcome_agents_for_leads", { p_sfdc_lead_ids: chunk })
  ))
  for (const result of results) {
    if (result.error) {
      // Attribution is additive and intentionally fail-open.
      console.error("achieve welcome-agent lookup error", result.error)
      continue
    }
    for (const rawRow of result.data ?? []) {
      const parsed = parseWelcomeAgentLookupRow(rawRow)
      if (!parsed) continue
      welcomeAgentByLead.set(parsed.sfdc_lead_id, {
        achieve_agent_name: parsed.achieve_agent_name,
        achieve_agent_email: parsed.achieve_agent_email,
      })
    }
  }
  return welcomeAgentByLead
}

async function enrichLightweightRows(
  admin: AdminClient,
  rows: readonly BoundaryRow[],
  qaScope: "ordinary" | "audit" = "ordinary",
) {
  const callIds = Array.from(new Set(rows.flatMap(row =>
    typeof row.call_id === "string" && row.call_id ? [row.call_id] : []
  )))
  const callIdChunks = chunks(callIds)
  const [welcomeAgentByLead, feedbackResults, agentFeedbackResults] = await Promise.all([
    fetchWelcomeAgents(admin, rows),
    Promise.all(callIdChunks.map(chunk => admin
      .from("eavesly_alert_feedback")
      .select(FEEDBACK_COLUMNS)
      .eq("module_name", ACHIEVE_MODULE_NAME)
      .in("call_id", chunk))),
    Promise.all(callIdChunks.map(chunk => {
      let query = admin
        .from("achieve_agent_feedback")
        .select(AGENT_FEEDBACK_COLUMNS)
      query = qaScope === "audit"
        ? query.in("matched_eavesly_call_id", chunk).is("matched_call_id", null)
        : query.in("matched_call_id", chunk)
      return query.order("submitted_at", { ascending: true })
    })),
  ])

  const feedbackByCall = new Map<string, FeedbackRow>()
  for (const result of feedbackResults) {
    if (result.error) {
      // Manager review metadata is additive on the list. Preserve the previous
      // fail-open behavior rather than taking down QA rows.
      console.error("achieve manager feedback error", result.error)
      continue
    }
    for (const rawRow of result.data ?? []) {
      const row = parseFeedbackRow(rawRow)
      if (row) feedbackByCall.set(row.call_id, row)
    }
  }

  const agentFeedbackByCall = new Map<string, AgentFeedbackRow[]>()
  for (const result of agentFeedbackResults) {
    if (result.error) {
      // Agent feedback drives portal metrics and filters, so partial data would
      // be misleading. Preserve the established fail-closed behavior.
      console.error("achieve agent feedback error", result.error)
      return null
    }
    for (const rawRow of result.data ?? []) {
      const row = rawRow as AgentFeedbackRow
      const associationId = qaScope === "audit" ? row.matched_eavesly_call_id : row.matched_call_id
      if (!associationId) continue
      const bucket = agentFeedbackByCall.get(associationId)
      if (bucket) bucket.push(row)
      else agentFeedbackByCall.set(associationId, [row])
    }
  }

  return rows.map(row => buildPortalListRow(
    row,
    typeof row.call_id === "string" ? feedbackByCall.get(row.call_id) : undefined,
    typeof row.call_id === "string" ? agentFeedbackByCall.get(row.call_id) ?? [] : [],
    typeof row.sfdc_lead_id === "string"
      ? welcomeAgentByLead.get(row.sfdc_lead_id)
      : undefined,
    qaScope === "audit" ? "qa_audit" : "qa_matched",
  ))
}

async function fetchModuleRows(
  admin: AdminClient,
  mode: "normal" | "audit",
  columns = LIST_MODULE_RESULT_COLUMNS,
): Promise<{ rows: BoundaryRow[]; total: number; capReached: boolean } | null> {
  const cap = mode === "normal" ? MAX_LIST_ROWS : MAX_AUDIT_ROWS
  const candidates: BoundaryRow[] = []
  let exactTotal: number | null = null
  for (let offset = 0; offset < cap; offset += PAGE_SIZE) {
    let query = admin
      .from("eavesly_module_results")
      .select(columns, { count: "exact" })
      .eq("module_name", ACHIEVE_MODULE_NAME)
      .not("result_json", "cs", JSON.stringify(COMPETITOR_TRANSFER_MARKER))
    query = mode === "audit"
      ? query.contains("result_json", AUDIT_ONLY_MARKER)
      : query.not("result_json", "cs", JSON.stringify(AUDIT_ONLY_MARKER))
    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error || count === null) {
      console.error(`achieve ${mode} list error`, error ?? { code: "exact_count_missing" })
      return null
    }
    exactTotal = count
    const page = data ?? []
    for (const rawRow of page) {
      const row = parseRecord(rawRow)
      if (!row) {
        console.error(`achieve ${mode} list error`, { code: "invalid_module_row" })
        return null
      }
      if (!isCompetitorTransfer(row.result_json)) candidates.push(row)
    }
    if (page.length < PAGE_SIZE) break
  }

  if (exactTotal === null) return { rows: [], total: 0, capReached: false }
  const partitioned = partitionPortalRows(candidates)
  return {
    rows: mode === "audit" ? partitioned.auditRows : partitioned.normalRows,
    total: exactTotal,
    capReached: exactTotal > cap,
  }
}

function parseFeedbackTotals(value: unknown) {
  const totals = parseRecord(value)
  if (!totals) return null
  const keys = [
    "deterministic_matched",
    "inferred_matched",
    "audit_qa_available",
    "true_qa_absent",
    "unresolved",
  ] as const
  const parsed: Record<typeof keys[number], number> = {
    deterministic_matched: 0,
    inferred_matched: 0,
    audit_qa_available: 0,
    true_qa_absent: 0,
    unresolved: 0,
  }
  for (const key of keys) {
    if (typeof totals[key] !== "number" || !Number.isSafeInteger(totals[key]) || totals[key] < 0) return null
    parsed[key] = totals[key]
  }
  return parsed
}

async function fetchFeedbackLeadership(admin: AdminClient) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const snapshotEndAt = new Date().toISOString()
    const [overviewResult, representativesResult] = await Promise.all([
      admin.rpc("get_achieve_agent_feedback_overview", { p_end_at: snapshotEndAt }),
      admin.rpc("list_achieve_agent_feedback_by_rep", {
        p_end_at: snapshotEndAt,
        p_limit: MAX_FEEDBACK_REPRESENTATIVES,
        p_offset: 0,
      }),
    ])
    if (overviewResult.error || representativesResult.error) {
      console.error("achieve feedback aggregate error", {
        overview: overviewResult.error,
        representatives: representativesResult.error,
        attempt: attempt + 1,
      })
      continue
    }
    const overview = parseRecord(overviewResult.data)
    const representatives = parseRecord(representativesResult.data)
    if (
      overview
      && representatives
      && Array.isArray(representatives.rows)
      && feedbackLeadershipSnapshotsAgree(overview, representatives)
    ) return { overview, representatives }

    console.warn("achieve feedback aggregate snapshot mismatch", { attempt: attempt + 1 })
  }
  return null
}

async function fetchRepresentativeFeedback(admin: AdminClient, agentEmail: string) {
  const result = await admin.rpc("list_achieve_agent_feedback_for_rep", {
    p_agent_email: agentEmail,
    p_limit: MAX_REPRESENTATIVE_FEEDBACK_ROWS,
    p_offset: 0,
  })
  if (result.error) {
    console.error("achieve representative feedback detail error", result.error)
    return null
  }
  const payload = parseRecord(result.data)
  const coverage = parseRecord(payload?.coverage)
  const qaCoverage = parseRecord(payload?.qa_coverage)
  if (
    !payload
    || !coverage
    || !qaCoverage
    || !Array.isArray(payload.rows)
    || !Array.isArray(payload.qa_rows)
  ) return null

  const rows: BoundaryRow[] = []
  for (const raw of payload.rows) {
    const row = parseRecord(raw)
    const notes = nullableProjectedString(row?.notes)
    const submittedBy = nullableProjectedString(row?.submitted_by)
    if (
      !row
      || typeof row.feedback_id !== "number"
      || !Number.isSafeInteger(row.feedback_id)
      || row.feedback_id < 1
      || typeof row.submitted_at !== "string"
      || (row.rating !== "good" && row.rating !== "fair" && row.rating !== "poor" && row.rating !== "other")
      || typeof row.accent !== "boolean"
      || typeof row.background_noise !== "boolean"
      || typeof row.connection_issues !== "boolean"
      || notes === undefined
      || submittedBy === undefined
    ) {
      console.error("achieve representative feedback detail error", { code: "invalid_detail_shape" })
      return null
    }
    rows.push({
      feedback_id: row.feedback_id,
      submitted_at: row.submitted_at,
      rating: row.rating,
      accent: row.accent,
      background_noise: row.background_noise,
      connection_issues: row.connection_issues,
      notes,
      submitted_by: submittedBy,
    })
  }

  const qaRows: BoundaryRow[] = []
  for (const raw of payload.qa_rows) {
    const row = parseRecord(raw)
    if (
      !row
      || typeof row.module_result_id !== "number"
      || !Number.isSafeInteger(row.module_result_id)
      || row.module_result_id < 1
      || typeof row.graded_at !== "string"
      || (row.outcome !== "pass" && row.outcome !== "flagged")
    ) {
      console.error("achieve representative QA detail error", { code: "invalid_qa_summary_shape" })
      return null
    }
    qaRows.push({
      module_result_id: row.module_result_id,
      graded_at: row.graded_at,
      outcome: row.outcome,
    })
  }
  return { rows, coverage, qa_rows: qaRows, qa_coverage: qaCoverage }
}

async function fetchFeedbackExceptions(admin: AdminClient) {
  const [totalsResult, qaAbsentResult, unresolvedResult] = await Promise.all([
    admin.rpc("get_achieve_feedback_match_totals"),
    admin.rpc("list_achieve_feedback_exceptions", {
      p_category: "true_qa_absent",
      p_limit: MAX_UNMATCHED_FEEDBACK,
    }),
    admin.rpc("list_achieve_feedback_exceptions", {
      p_category: "unresolved",
      p_limit: MAX_UNMATCHED_FEEDBACK,
    }),
  ])
  if (totalsResult.error || qaAbsentResult.error || unresolvedResult.error) {
    if (totalsResult.error) console.error("achieve feedback totals error", totalsResult.error)
    if (qaAbsentResult.error) console.error("achieve QA-absent feedback error", qaAbsentResult.error)
    if (unresolvedResult.error) console.error("achieve unresolved feedback error", unresolvedResult.error)
    return null
  }
  const totals = parseFeedbackTotals(totalsResult.data)
  if (!totals) {
    console.error("achieve feedback totals error", { code: "invalid_aggregate_shape" })
    return null
  }
  const qaAbsent = (qaAbsentResult.data ?? []).map(row => buildAgentFeedbackView(row, {
    includePhone: true,
    qaStatus: "qa_absent",
  }))
  const unresolved = (unresolvedResult.data ?? []).map(row => buildAgentFeedbackView(row, {
    includePhone: true,
    qaStatus: "call_unmatched",
  }))
  return {
    true_qa_absent_agent_feedback: qaAbsent,
    unresolved_agent_feedback: unresolved,
    // Compatibility aliases for the deployed frontend during the additive rollout.
    qa_missing_agent_feedback: qaAbsent,
    unmatched_agent_feedback: unresolved,
    totals,
    coverage: {
      limit_per_list: MAX_UNMATCHED_FEEDBACK,
      true_qa_absent: {
        total: totals.true_qa_absent,
        loaded: qaAbsent.length,
        cap_reached: totals.true_qa_absent > qaAbsent.length,
      },
      unresolved: {
        total: totals.unresolved,
        loaded: unresolved.length,
        cap_reached: totals.unresolved > unresolved.length,
      },
    },
  }
}

async function enrichLegacyRows(admin: AdminClient, rows: readonly BoundaryRow[]) {
  const callIds = Array.from(new Set(rows.flatMap(row =>
    typeof row.call_id === "string" && row.call_id ? [row.call_id] : []
  )))
  const callIdChunks = chunks(callIds, MAX_CONCURRENT_LEGACY_CHUNKS)
  const [welcomeAgentByLead, transcriptResults, feedbackResults, agentFeedbackResults] = await Promise.all([
    fetchWelcomeAgents(admin, rows, MAX_CONCURRENT_LEGACY_CHUNKS),
    Promise.all(callIdChunks.map(chunk => admin
      .from("eavesly_transcription_qa")
      .select("call_id, original_transcript, transcription_link, recording_link")
      .in("call_id", chunk))),
    Promise.all(callIdChunks.map(chunk => admin
      .from("eavesly_alert_feedback")
      .select(FEEDBACK_COLUMNS)
      .eq("module_name", ACHIEVE_MODULE_NAME)
      .in("call_id", chunk))),
    Promise.all(callIdChunks.map(chunk => admin
      .from("achieve_agent_feedback")
      .select(AGENT_FEEDBACK_COLUMNS)
      .in("matched_eavesly_call_id", chunk)
      .order("submitted_at", { ascending: true }))),
  ])

  const transcriptByCall = new Map<string, BoundaryRow>()
  for (const result of transcriptResults) {
    if (result.error) {
      // Preserve legacy fail-open transcript behavior.
      console.error("achieve transcripts error", result.error)
      continue
    }
    for (const rawRow of result.data ?? []) {
      const row = parseRecord(rawRow)
      if (row && typeof row.call_id === "string") transcriptByCall.set(row.call_id, row)
    }
  }

  const feedbackByCall = new Map<string, FeedbackRow>()
  for (const result of feedbackResults) {
    if (result.error) {
      // Preserve legacy fail-open manager-feedback behavior.
      console.error("achieve feedback error", result.error)
      continue
    }
    for (const rawRow of result.data ?? []) {
      const row = parseFeedbackRow(rawRow)
      if (row) feedbackByCall.set(row.call_id, row)
    }
  }

  const ordinaryAgentFeedbackByCall = new Map<string, AgentFeedbackRow[]>()
  const auditAgentFeedbackByCall = new Map<string, AgentFeedbackRow[]>()
  for (const result of agentFeedbackResults) {
    if (result.error) {
      // Preserve legacy fail-closed agent-feedback behavior.
      console.error("achieve agent feedback error", result.error)
      return null
    }
    for (const rawRow of result.data ?? []) {
      const feedback = rawRow as AgentFeedbackRow
      const associationId = feedback.matched_call_id ?? feedback.matched_eavesly_call_id
      if (!associationId) continue
      const target = feedback.matched_call_id ? ordinaryAgentFeedbackByCall : auditAgentFeedbackByCall
      const bucket = target.get(associationId)
      if (bucket) bucket.push(feedback)
      else target.set(associationId, [feedback])
    }
  }

  return rows.map(row => {
    const auditOnly = isAuditOnlyResult(row.result_json)
    const agentFeedbackByCall = auditOnly ? auditAgentFeedbackByCall : ordinaryAgentFeedbackByCall
    return buildPortalRow(
      row,
      typeof row.call_id === "string" ? transcriptByCall.get(row.call_id) : undefined,
      typeof row.call_id === "string" ? feedbackByCall.get(row.call_id) : undefined,
      typeof row.call_id === "string" ? agentFeedbackByCall.get(row.call_id) ?? [] : [],
      typeof row.sfdc_lead_id === "string"
        ? welcomeAgentByLead.get(row.sfdc_lead_id)
        : undefined,
      auditOnly ? "qa_audit" : "qa_matched",
    )
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return json({ error: "bad_json" }, 400)
  }
  const body = parseRecord(rawBody)
  if (!body) return json({ error: "bad_request" }, 400)

  const expected = Deno.env.get("ACHIEVE_PORTAL_PASSWORD")
  if (!expected) return json({ error: "not_configured" }, 503)

  // Authentication precedes action and identifier parsing so unauthorized
  // callers cannot probe valid actions, IDs, or competitor-row existence.
  const supplied = typeof body.password === "string" ? body.password : ""
  if (!supplied || !(await passwordMatches(supplied, expected))) {
    await new Promise(resolve => setTimeout(resolve, 400))
    return json({ error: "invalid_password" }, 401)
  }

  // Legacy password-only action remains unchanged for backend-first rollout.
  if (body.action === "verify") return json({ ok: true })

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  if (body.action === "get_feedback_overview") {
    const dashboard = await fetchFeedbackLeadership(admin)
    if (!dashboard) return json({ error: "feedback_overview_failed" }, 500)
    return json(dashboard)
  }

  if (body.action === "get_management_report") {
    try {
      const result = await loadAchieveManagementReport(
        async range => admin.rpc("get_achieve_agent_feedback_dashboard", {
          p_start_at: range.startAt,
          p_end_at: range.endAt,
          p_representative_limit: ACHIEVE_REPORT_REPRESENTATIVE_LIMIT,
          p_representative_offset: 0,
        }),
        async endAt => admin.rpc("list_achieve_agent_termination_monitoring", { p_end_at: endAt }),
        new Date(),
      )
      if (!result.ok) {
        console.error("achieve management report error", { reason: result.reason })
        return json({ error: result.reason }, 500)
      }
      return json(result.report)
    } catch (cause: unknown) {
      console.error("achieve management report error", {
        reason: cause instanceof Error ? cause.name : "unknown",
      })
      return json({ error: "management_report_failed" }, 500)
    }
  }

  if (body.action === "list_feedback_for_rep") {
    const agentEmail = parseRepresentativeEmail(body.agent_email)
    if (!agentEmail) return json({ error: "invalid_agent_email" }, 400)
    const detail = await fetchRepresentativeFeedback(admin, agentEmail)
    if (!detail) return json({ error: "feedback_detail_failed" }, 500)
    return json(detail)
  }

  if (body.action === "list_overview") {
    const loaded = await fetchModuleRows(admin, "normal")
    if (!loaded) return json({ error: "list_failed" }, 500)
    const rows = await enrichLightweightRows(admin, loaded.rows)
    if (!rows) return json({ error: "list_failed" }, 500)
    return json({
      all_calls: rows,
      coverage: {
        total: loaded.total,
        loaded: rows.length,
        cap: MAX_LIST_ROWS,
        cap_reached: loaded.capReached,
      },
    })
  }

  if (body.action === "list") {
    // Compatibility path for the already-deployed frontend. Preserve the full
    // sanitized response and security guards while the optimized frontend is
    // rolled out separately.
    const [normalLoaded, auditLoaded, exceptions] = await Promise.all([
      fetchModuleRows(admin, "normal", DETAIL_MODULE_RESULT_COLUMNS),
      fetchModuleRows(admin, "audit", DETAIL_MODULE_RESULT_COLUMNS),
      fetchFeedbackExceptions(admin),
    ])
    if (!normalLoaded || !auditLoaded || !exceptions) {
      return json({ error: "list_failed" }, 500)
    }
    const allRows = [...normalLoaded.rows, ...auditLoaded.rows]
    const fullRows = await enrichLegacyRows(admin, allRows)
    if (!fullRows) return json({ error: "list_failed" }, 500)
    const normalRows = fullRows.slice(0, normalLoaded.rows.length)
    const auditRows = fullRows.slice(normalLoaded.rows.length)
    return json({
      alerts: normalRows.filter(row => isQueueRow(row)),
      all_calls: normalRows,
      backfill_audit: auditRows,
      ...exceptions,
    })
  }

  if (body.action === "list_audit") {
    const loaded = await fetchModuleRows(admin, "audit")
    if (!loaded) return json({ error: "list_failed" }, 500)
    const rows = await enrichLightweightRows(admin, loaded.rows, "audit")
    if (!rows) return json({ error: "list_failed" }, 500)
    return json({
      rows,
      coverage: {
        total: loaded.total,
        loaded: rows.length,
        cap: MAX_AUDIT_ROWS,
        cap_reached: loaded.capReached,
      },
    })
  }

  if (body.action === "list_feedback_exceptions") {
    const exceptions = await fetchFeedbackExceptions(admin)
    if (!exceptions) return json({ error: "list_failed" }, 500)
    return json(exceptions)
  }

  if (body.action === "detail") {
    const moduleResultId = positiveInteger(body.module_result_id)
    if (moduleResultId === null) return json({ error: "invalid_module_result_id" }, 400)

    const { data: rawRow, error: moduleError } = await admin
      .from("eavesly_module_results")
      .select(DETAIL_MODULE_RESULT_COLUMNS)
      .eq("module_name", ACHIEVE_MODULE_NAME)
      .eq("id", moduleResultId)
      .maybeSingle()
    if (moduleError) {
      console.error("achieve detail module lookup error", moduleError)
      return json({ error: "detail_failed" }, 500)
    }
    const row = parseRecord(rawRow)
    if (!row || isCompetitorTransfer(row.result_json)) return json({ error: "not_found" }, 404)
    if (typeof row.call_id !== "string") return json({ error: "not_found" }, 404)

    const leadIds = typeof row.sfdc_lead_id === "string" && row.sfdc_lead_id.trim()
      ? [row.sfdc_lead_id]
      : []
    const auditOnly = isAuditOnlyResult(row.result_json)
    let agentFeedbackQuery = admin
      .from("achieve_agent_feedback")
      .select(AGENT_FEEDBACK_COLUMNS)
    agentFeedbackQuery = auditOnly
      ? agentFeedbackQuery.eq("matched_eavesly_call_id", row.call_id).is("matched_call_id", null)
      : agentFeedbackQuery.eq("matched_call_id", row.call_id)
    const [transcriptResult, feedbackResult, agentFeedbackResult, welcomeAgentByLead] = await Promise.all([
      admin
        .from("eavesly_transcription_qa")
        .select("call_id, original_transcript, transcription_link, recording_link")
        .eq("call_id", row.call_id)
        .maybeSingle(),
      admin
        .from("eavesly_alert_feedback")
        .select(FEEDBACK_COLUMNS)
        .eq("module_name", ACHIEVE_MODULE_NAME)
        .eq("call_id", row.call_id)
        .maybeSingle(),
      agentFeedbackQuery.order("submitted_at", { ascending: true }),
      fetchWelcomeAgents(admin, leadIds.length > 0 ? [row] : []),
    ])
    if (agentFeedbackResult.error) {
      console.error("achieve detail agent feedback error", agentFeedbackResult.error)
      return json({ error: "detail_failed" }, 500)
    }
    if (transcriptResult.error) console.error("achieve detail transcript error", transcriptResult.error)
    if (feedbackResult.error) console.error("achieve detail manager feedback error", feedbackResult.error)

    return json({ row: buildPortalRow(
      row,
      transcriptResult.data,
      feedbackResult.data ?? undefined,
      agentFeedbackResult.data ?? [],
      typeof row.sfdc_lead_id === "string"
        ? welcomeAgentByLead.get(row.sfdc_lead_id)
        : undefined,
      auditOnly ? "qa_audit" : "qa_matched",
    ) })
  }

  if (body.action === "submit_feedback") {
    const validated = validateFeedback(body.feedback)
    if (!validated.ok) return json({ error: validated.error }, 400)

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
