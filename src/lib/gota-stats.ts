// Pure types + aggregation helpers for the Achieve GOTA adoption page.
// No supabase import — keep this file importable by the tsx self-check
// (gota-stats.check.ts), mirroring the achieve-checklist.ts convention.
//
// The GOTA (Going Over The Agreement) is Pennie's guided, page-by-page signing
// walkthrough, mandatory on every Achieve enrollment before the welcome call.
// Eavesly's gota_check module evaluates each Achieve enrollment call and stores
// one row per call (surfaced through eavesly_module_results_with_feedback —
// NOT the alerts view, which filters to alert_sent and would hide clean calls):
//
//   result_json.enrollment_completed  — the client e-signed on this call
//   result_json.gota_conducted        — the agent ran the guided walkthrough
//   result_json.gota_type             — turnbull_red | fdr_green | unknown
//   result_json.*_beat_covered        — six coaching "key beats"
//   has_violation                     — signed WITHOUT a walkthrough
//
// Adoption rate = walkthroughs conducted / signings. Key beats are coaching
// signals only — they never make a call a violation.

import { ymdInBusinessTZ } from './time-zone'

export const GOTA_MODULE = 'gota_check'

// ---------- Result parsing ----------

export type GotaPacket = 'turnbull_red' | 'fdr_green' | 'unknown'

export const GOTA_PACKET_LABELS: Record<GotaPacket, string> = {
  turnbull_red: 'Turnbull (red state)',
  fdr_green: 'FDR (green state)',
  unknown: 'Unknown',
}

// Order + labels mirror BEAT_LABELS in the eavesly gota-check module.
export const GOTA_BEATS = [
  { key: 'fee_structure', label: 'Fee structure' },
  { key: 'cancellation_rights', label: 'Cancellation rights' },
  { key: 'do_not_sign_page', label: 'DO-NOT-SIGN page' },
  { key: 'banking_readback', label: 'Banking read-back' },
  { key: 'ssn_verification', label: 'SSN verification' },
  { key: 'wc_transfer_brief', label: 'Welcome-call handoff' },
] as const

export type GotaBeatKey = (typeof GOTA_BEATS)[number]['key']

export type GotaResult = {
  enrollment_completed: boolean
  gota_conducted: boolean
  gota_type: GotaPacket
  wc_transfer_occurred: boolean
  beats: Record<GotaBeatKey, boolean>
  missing_beats: string[]
  violation_reason: string
}

// result_json crosses a runtime hop, so parse defensively — missing or
// malformed fields degrade to false/unknown rather than crashing the page.
export function parseGotaResult(raw: unknown): GotaResult {
  const r: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const beats = {} as Record<GotaBeatKey, boolean>
  for (const beat of GOTA_BEATS) {
    beats[beat.key] = r[`${beat.key}_beat_covered`] === true
  }
  const gotaType: GotaPacket =
    r.gota_type === 'turnbull_red' || r.gota_type === 'fdr_green'
      ? r.gota_type
      : 'unknown'
  return {
    enrollment_completed: r.enrollment_completed === true,
    gota_conducted: r.gota_conducted === true,
    gota_type: gotaType,
    wc_transfer_occurred: r.wc_transfer_occurred === true,
    beats,
    missing_beats: Array.isArray(r.missing_beats)
      ? r.missing_beats.filter((b: unknown) => typeof b === 'string')
      : [],
    violation_reason: typeof r.violation_reason === 'string' ? r.violation_reason : '',
  }
}

export type GotaEvaluation = {
  call_id: string
  agent_email: string | null
  contact_name: string | null
  evaluated_at: string
  has_violation: boolean
  is_reviewed: boolean
  accurate: boolean | null
  result: GotaResult
}

// ---------- Aggregation (pure) ----------

export type GotaSummary = {
  evaluated: number // gota_check evaluations in window
  signings: number // enrollment_completed = true
  conducted: number // signings with a guided walkthrough
  adoptionRate: number | null // conducted / signings, % (null when no signings)
  violations: number // signed WITHOUT a walkthrough
  overturned: number // violations managers marked inaccurate
  wcTransferRate: number | null // % of signings warm-transferred on-call
  packetMix: Record<GotaPacket, number> // among signings
  // Coverage among CONDUCTED walkthroughs, worst-covered first.
  beatCoverage: { key: GotaBeatKey; label: string; covered: number; rate: number }[]
}

export function aggregateGotaSummary(rows: GotaEvaluation[]): GotaSummary {
  const signingRows = rows.filter(r => r.result.enrollment_completed)
  const conductedRows = signingRows.filter(r => r.result.gota_conducted)
  const violationRows = rows.filter(r => r.has_violation)
  const packetMix: Record<GotaPacket, number> = {
    turnbull_red: 0,
    fdr_green: 0,
    unknown: 0,
  }
  for (const r of signingRows) packetMix[r.result.gota_type] += 1

  const beatCoverage = GOTA_BEATS.map(beat => {
    const covered = conductedRows.filter(r => r.result.beats[beat.key]).length
    return {
      key: beat.key,
      label: beat.label,
      covered,
      rate: conductedRows.length === 0 ? 0 : Math.round((covered / conductedRows.length) * 100),
    }
  }).sort((a, b) => a.rate - b.rate)

  const wcTransfers = signingRows.filter(r => r.result.wc_transfer_occurred).length

  return {
    evaluated: rows.length,
    signings: signingRows.length,
    conducted: conductedRows.length,
    adoptionRate:
      signingRows.length === 0
        ? null
        : Math.round((conductedRows.length / signingRows.length) * 100),
    violations: violationRows.length,
    overturned: violationRows.filter(r => r.accurate === false).length,
    wcTransferRate:
      signingRows.length === 0
        ? null
        : Math.round((wcTransfers / signingRows.length) * 100),
    packetMix,
    beatCoverage,
  }
}

export type GotaAgentRow = {
  agent_email: string
  evaluated: number
  signings: number
  conducted: number
  adoptionRate: number | null
  violations: number
  avgMissedBeats: number | null // among conducted walkthroughs
  lastCallAt: string // ISO of most recent evaluation
}

export function aggregateGotaByAgent(rows: GotaEvaluation[]): GotaAgentRow[] {
  const byAgent = new Map<string, GotaEvaluation[]>()
  for (const row of rows) {
    if (!row.agent_email) continue
    const list = byAgent.get(row.agent_email) ?? []
    list.push(row)
    byAgent.set(row.agent_email, list)
  }

  const result: GotaAgentRow[] = []
  for (const [agent_email, agentRows] of byAgent) {
    const signings = agentRows.filter(r => r.result.enrollment_completed)
    const conducted = signings.filter(r => r.result.gota_conducted)
    const missedBeatCounts = conducted.map(
      r => GOTA_BEATS.filter(beat => !r.result.beats[beat.key]).length,
    )
    result.push({
      agent_email,
      evaluated: agentRows.length,
      signings: signings.length,
      conducted: conducted.length,
      adoptionRate:
        signings.length === 0
          ? null
          : Math.round((conducted.length / signings.length) * 100),
      violations: agentRows.filter(r => r.has_violation).length,
      avgMissedBeats:
        missedBeatCounts.length === 0
          ? null
          : Math.round(
              (missedBeatCounts.reduce((a, b) => a + b, 0) / missedBeatCounts.length) * 10,
            ) / 10,
      lastCallAt: agentRows.reduce(
        (latest, r) => (r.evaluated_at > latest ? r.evaluated_at : latest),
        agentRows[0].evaluated_at,
      ),
    })
  }

  // Coaching order: violations first, then lowest adoption, then volume.
  return result.sort((a, b) => {
    if (b.violations !== a.violations) return b.violations - a.violations
    const aRate = a.adoptionRate ?? 101
    const bRate = b.adoptionRate ?? 101
    if (aRate !== bRate) return aRate - bRate
    return b.signings - a.signings
  })
}

export type GotaDailyBucket = {
  day: string // YYYY-MM-DD in ET
  label: string // e.g. "Jul 21"
  signings: number
  conducted: number
  violations: number
  adoptionRate: number | null
}

export function aggregateGotaDaily(rows: GotaEvaluation[]): GotaDailyBucket[] {
  const byDay = new Map<string, { signings: number; conducted: number; violations: number }>()
  for (const row of rows) {
    const day = ymdInBusinessTZ(new Date(row.evaluated_at))
    const bucket = byDay.get(day) ?? { signings: 0, conducted: 0, violations: 0 }
    if (row.result.enrollment_completed) bucket.signings += 1
    if (row.result.enrollment_completed && row.result.gota_conducted) bucket.conducted += 1
    if (row.has_violation) bucket.violations += 1
    byDay.set(day, bucket)
  }

  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, bucket]) => {
      const [y, m, d] = day.split('-').map(Number)
      const label = new Date(y, m - 1, d).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
      })
      return {
        day,
        label,
        ...bucket,
        adoptionRate:
          bucket.signings === 0
            ? null
            : Math.round((bucket.conducted / bucket.signings) * 100),
      }
    })
}
