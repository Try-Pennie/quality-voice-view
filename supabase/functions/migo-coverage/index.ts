// migo-coverage edge function
//
// Returns "did agents who got a Migo pre-call briefing perform better?"
// Joins eavesly_calls.sfdc_lead_id against the Migo project's
// migo_generated_summary.sfdc_lead_record_id without exposing the cross-
// project credentials to the browser.
//
// Optimization order matters here: we query Eavesly first to bound the
// universe of lead IDs to those that actually appeared in this team's calls
// in window, then ask Migo only about those IDs in chunked IN-queries.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

type Body = {
  agent_emails?: string[]
  start?: string
  end?: string
}

type CoverageResult = {
  configured: boolean
  briefed_calls: number
  unbriefed_calls: number
  briefed_compliance_rate: number | null
  unbriefed_compliance_rate: number | null
  briefed_escalation_rate: number | null
  unbriefed_escalation_rate: number | null
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const EMPTY: CoverageResult = {
  configured: true,
  briefed_calls: 0,
  unbriefed_calls: 0,
  briefed_compliance_rate: null,
  unbriefed_compliance_rate: null,
  briefed_escalation_rate: null,
  unbriefed_escalation_rate: null,
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)

  const authHeader = req.headers.get("Authorization")
  if (!authHeader) return json({ error: "missing_auth" }, 401)

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: "bad_json" }, 400)
  }
  const requestedEmails = body.agent_emails ?? []
  const start = body.start
  const end = body.end
  if (!Array.isArray(requestedEmails) || !start || !end) {
    return json({ error: "bad_request" }, 400)
  }

  const eavesUrl = Deno.env.get("SUPABASE_URL")!
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  // Migo project access. The anon key here is intentionally inlined: the
  // migo_generated_summary table already has a permissive public RLS policy,
  // so this key carries no privilege beyond what any anonymous reader has.
  // Move to Deno.env if/when Migo locks down RLS.
  const migoUrl =
    Deno.env.get("MIGO_SUPABASE_URL") ||
    "https://bjemesyodhmpfyvwiter.supabase.co"
  const migoKey =
    Deno.env.get("MIGO_SUPABASE_ANON_KEY") ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqZW1lc3lvZGhtcGZ5dndpdGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAwODQ1MDEsImV4cCI6MjA2NTY2MDUwMX0.-XmeOQiV3C5I_HXvuIgyO-N7it7zkRMDrCmNsW9nD-c"

  // 1. Identify the caller from their JWT
  const userClient = createClient(eavesUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user?.email) {
    return json({ error: "unauthenticated" }, 401)
  }
  const callerEmail = userData.user.email

  // 2. Resolve manager scope server-side — caller can only see agents they
  // manage (or any agent if god-mode). This mirrors fetchUserScope() in the
  // frontend but is the source of truth here.
  const eavesAdmin = createClient(eavesUrl, serviceKey)
  const [mappingRes, promptRes] = await Promise.all([
    eavesAdmin
      .from("agent_manager_mapping")
      .select("agent_email")
      .eq("manager_email", callerEmail),
    eavesAdmin
      .from("manager_coaching_prompts")
      .select("is_god_mode")
      .eq("manager_email", callerEmail)
      .maybeSingle(),
  ])
  const isGodMode = !!(promptRes.data as { is_god_mode?: boolean } | null)?.is_god_mode
  const managed = new Set(
    ((mappingRes.data as { agent_email: string }[] | null) ?? []).map(
      r => r.agent_email,
    ),
  )
  const allowed = isGodMode
    ? requestedEmails
    : requestedEmails.filter(e => managed.has(e))
  if (allowed.length === 0) {
    return json({ ...EMPTY, configured: !!(migoUrl && migoKey) })
  }

  // 3. Fetch calls (light projection: only the keys we'll join on) +
  // QA scoring rows for those calls. Fired in parallel where possible.
  const { data: callRows, error: callsErr } = await eavesAdmin
    .from("eavesly_calls")
    .select("call_id, sfdc_lead_id, agent_email")
    .in("agent_email", allowed)
    .gte("started_at", start)
    .lte("started_at", end)
    .not("sfdc_lead_id", "is", null)
    .limit(10000)
  if (callsErr) {
    console.error("eavesly_calls error", callsErr)
    return json({ error: "calls_fetch_failed" }, 500)
  }
  const calls = (callRows ?? []) as {
    call_id: string
    sfdc_lead_id: string
    agent_email: string
  }[]
  if (calls.length === 0) {
    return json({ ...EMPTY, configured: !!(migoUrl && migoKey) })
  }

  const callIds = calls.map(c => c.call_id)
  const qaByCallId = new Map<
    string,
    { compliance_rating: string | null; manager_escalation: boolean | null }
  >()
  // Chunk QA fetch — same pattern as team-queries.ts batchSize=300.
  const QA_CHUNK = 300
  for (let i = 0; i < callIds.length; i += QA_CHUNK) {
    const chunk = callIds.slice(i, i + QA_CHUNK)
    const { data, error } = await eavesAdmin
      .from("eavesly_transcription_qa")
      .select("call_id, compliance_rating, manager_escalation")
      .in("call_id", chunk)
    if (error) {
      console.error("qa fetch error", error)
      continue
    }
    for (const row of (data ?? []) as {
      call_id: string
      compliance_rating: string | null
      manager_escalation: boolean | null
    }[]) {
      qaByCallId.set(row.call_id, {
        compliance_rating: row.compliance_rating,
        manager_escalation: row.manager_escalation,
      })
    }
  }

  // 4. Ask Migo only about lead IDs we actually saw — bounds the cross-project
  // payload from ~89k to whatever this team touched in window.
  const briefedSet = new Set<string>()
  if (migoUrl && migoKey) {
    const migo = createClient(migoUrl, migoKey)
    const uniqueLeadIds = Array.from(
      new Set(calls.map(c => c.sfdc_lead_id).filter(Boolean) as string[]),
    )
    const MIGO_CHUNK = 500
    for (let i = 0; i < uniqueLeadIds.length; i += MIGO_CHUNK) {
      const chunk = uniqueLeadIds.slice(i, i + MIGO_CHUNK)
      const { data, error } = await migo
        .from("migo_generated_summary")
        .select("sfdc_lead_record_id")
        .in("sfdc_lead_record_id", chunk)
      if (error) {
        console.error("migo fetch error", error)
        continue
      }
      for (const row of (data ?? []) as { sfdc_lead_record_id: string }[]) {
        briefedSet.add(row.sfdc_lead_record_id)
      }
    }
  }

  // 5. Aggregate by briefed/unbriefed bucket.
  const buckets = {
    briefed: { calls: 0, compPass: 0, compTotal: 0, escalations: 0 },
    unbriefed: { calls: 0, compPass: 0, compTotal: 0, escalations: 0 },
  }
  for (const c of calls) {
    const bucket = briefedSet.has(c.sfdc_lead_id) ? buckets.briefed : buckets.unbriefed
    bucket.calls += 1
    const qa = qaByCallId.get(c.call_id)
    if (!qa) continue
    if (qa.compliance_rating === "pass" || qa.compliance_rating === "fail") {
      bucket.compTotal += 1
      if (qa.compliance_rating === "pass") bucket.compPass += 1
    }
    if (qa.manager_escalation) bucket.escalations += 1
  }

  const rate = (num: number, denom: number): number | null =>
    denom > 0 ? Math.round((num / denom) * 100) : null

  const result: CoverageResult = {
    configured: !!(migoUrl && migoKey),
    briefed_calls: buckets.briefed.calls,
    unbriefed_calls: buckets.unbriefed.calls,
    briefed_compliance_rate: rate(buckets.briefed.compPass, buckets.briefed.compTotal),
    unbriefed_compliance_rate: rate(buckets.unbriefed.compPass, buckets.unbriefed.compTotal),
    briefed_escalation_rate: rate(buckets.briefed.escalations, buckets.briefed.calls),
    unbriefed_escalation_rate: rate(buckets.unbriefed.escalations, buckets.unbriefed.calls),
  }
  return json(result)
})
