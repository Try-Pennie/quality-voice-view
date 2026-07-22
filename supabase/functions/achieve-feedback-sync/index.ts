// achieve-feedback-sync edge function
//
// Pulls Pennie agent feedback rows from the "Achieve Welcome Call 🚨" Google
// Sheet (Form Responses) into public.achieve_agent_feedback, then matches them
// to Achieve welcome calls by normalized phone + submission-time proximity
// (public.match_achieve_agent_feedback). The /achieve portal reads the result
// through the achieve-portal edge function.
//
// Triggered every 15 min by pg_cron/pg_net (see migration
// 20260722120000_achieve_agent_feedback.sql). Auth is a shared secret header:
//   x-sync-secret must equal the ACHIEVE_SYNC_SECRET function secret, and the
//   cron job reads the same value from Vault ('achieve_feedback_sync_secret').
//
// Required function secrets (supabase secrets set ...):
//   ACHIEVE_SYNC_SECRET          — shared secret described above
//   ACHIEVE_FEEDBACK_SHEET_ID    — Google spreadsheet id
//   GOOGLE_SA_EMAIL              — service-account email (sheet shared read-only with it)
//   GOOGLE_SA_PRIVATE_KEY        — service-account PKCS8 private key (PEM, \n-escaped ok)
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SHEET_RANGE = "'Form Responses'!A2:I"

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

// --- Google service-account auth (RS256 JWT -> access token) -----------------

function base64url(bytes: Uint8Array): string {
  let str = ""
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const normalized = pem.replace(/\\n/g, "\n")
  const body = normalized
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "")
  const der = Uint8Array.from(atob(body), c => c.charCodeAt(0))
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  )
}

async function googleAccessToken(saEmail: string, privateKeyPem: string): Promise<string> {
  const enc = new TextEncoder()
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })))
  const claims = base64url(enc.encode(JSON.stringify({
    iss: saEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })))
  const unsigned = `${header}.${claims}`
  const key = await importPrivateKey(privateKeyPem)
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned))
  const jwt = `${unsigned}.${base64url(new Uint8Array(sig))}`

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  })
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  if (!data.access_token) throw new Error("google token exchange returned no access_token")
  return data.access_token
}

// --- Sheet row parsing --------------------------------------------------------

// Last 10 digits (US numbers; strips formatting and a leading country code).
// Returns null for garbage like '#ERROR!' or too-short values.
export function normalizePhone(raw: string): string | null {
  const digits = (raw ?? "").replace(/\D/g, "")
  if (digits.length < 10) return null
  return digits.slice(-10)
}

// Form timestamps look like "Jul 15, 2026, 4:59:55 PM" and are UTC (verified
// against eavesly_calls.started_at for matched rows). Google sometimes uses
// narrow no-break spaces before AM/PM — normalize those first.
export function parseSheetTimestamp(raw: string): string | null {
  const cleaned = (raw ?? "").replace(/[\u202f\u00a0]/g, " ").trim()
  const m = cleaned.match(/^([A-Za-z]{3,9}) (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/)
  if (!m) return null
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  }
  const month = months[m[1].slice(0, 3).toLowerCase()]
  if (month === undefined) return null
  let hour = Number(m[4]) % 12
  if (m[7] === "PM") hour += 12
  const date = new Date(Date.UTC(Number(m[3]), month, Number(m[2]), hour, Number(m[5]), Number(m[6])))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function yesNo(raw: string | undefined): boolean | null {
  const v = (raw ?? "").trim().toLowerCase()
  if (v === "yes") return true
  if (v === "no") return false
  return null
}

type FeedbackRow = {
  lead_phone_raw: string
  achieve_agent_name: string | null
  accent: boolean | null
  background_noise: boolean | null
  connection_issues: boolean | null
  call_quality: string | null
  notes: string | null
  submitted_by: string
  submitted_at: string
  phone_normalized: string | null
}

// Sheet columns: A Lead Phone | B Agent Name | C Accent | D Background Noise |
// E Connection Issues | F Call Quality | G Notes | H Submitted By | I Timestamp
export function parseSheetRow(cells: string[]): FeedbackRow | null {
  const [phone, agentName, accent, noise, connection, quality, notes, submittedBy, timestamp] = cells
  const submittedAt = parseSheetTimestamp(timestamp ?? "")
  if (!submittedAt) return null // no timestamp -> can't dedup or match; skip
  const phoneRaw = (phone ?? "").trim()
  if (!phoneRaw) return null
  const clean = (v: string | undefined) => {
    const t = (v ?? "").trim()
    return t && t.toLowerCase() !== "n/a" ? t : null
  }
  return {
    lead_phone_raw: phoneRaw.slice(0, 64),
    achieve_agent_name: clean(agentName),
    accent: yesNo(accent),
    background_noise: yesNo(noise),
    connection_issues: yesNo(connection),
    call_quality: clean(quality),
    notes: clean(notes)?.slice(0, 4000) ?? null,
    submitted_by: clean(submittedBy) ?? "",
    submitted_at: submittedAt,
    phone_normalized: normalizePhone(phoneRaw),
  }
}

// --- Handler -------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)

  const secret = Deno.env.get("ACHIEVE_SYNC_SECRET")
  if (!secret) return json({ error: "not_configured" }, 503)
  if (req.headers.get("x-sync-secret") !== secret) return json({ error: "unauthorized" }, 401)

  const sheetId = Deno.env.get("ACHIEVE_FEEDBACK_SHEET_ID")
  const saEmail = Deno.env.get("GOOGLE_SA_EMAIL")
  const saKey = Deno.env.get("GOOGLE_SA_PRIVATE_KEY")
  if (!sheetId || !saEmail || !saKey) return json({ error: "google_not_configured" }, 503)

  try {
    const token = await googleAccessToken(saEmail, saKey)
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_RANGE)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) throw new Error(`sheets fetch failed: ${res.status} ${await res.text()}`)
    const data = await res.json()
    const values: string[][] = data.values ?? []

    const rows = values.map(parseSheetRow).filter((r): r is FeedbackRow => r !== null)

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )

    // Upsert in chunks against the dedup index (submitted_at, lead_phone_raw,
    // submitted_by). Existing rows keep their matched_call_id.
    let upserted = 0
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200)
      const { error } = await admin
        .from("achieve_agent_feedback")
        .upsert(chunk, {
          onConflict: "submitted_at,lead_phone_raw,submitted_by",
          ignoreDuplicates: true,
        })
      if (error) throw new Error(`upsert failed: ${error.message}`)
      upserted += chunk.length
    }

    const { data: matched, error: matchError } = await admin.rpc("match_achieve_agent_feedback")
    if (matchError) throw new Error(`match rpc failed: ${matchError.message}`)

    return json({
      ok: true,
      sheet_rows: values.length,
      parsed_rows: rows.length,
      skipped_rows: values.length - rows.length,
      upserted,
      newly_matched: matched,
    })
  } catch (error) {
    console.error("achieve-feedback-sync error", error)
    return json({ error: "sync_failed", detail: String(error) }, 500)
  }
})
