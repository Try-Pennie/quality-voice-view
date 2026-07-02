// Pitch-call talk-time risk bands (PSAI-178).
//
// Eavesly/QVV flags rushed pitch calls by talk time, but the bands apply ONLY
// to eligible pitch cohorts (Cal.com Meeting / CALL NOW REQUESTED). Non-pitch
// calls keep the generic DEFAULT_THRESHOLDS behavior and never get a band.
//
// Pure functions, no IO — safe to call per-row in render and in rollups.

export type RiskBand = 'high' | 'watch' | 'target' | 'unknown'

// Talk-time cutoffs in seconds: < 30m rushed/high, 30–40m watch, >= 40m target.
export const PITCH_HIGH_RISK_SECONDS = 1800 // 30 min
export const PITCH_WATCH_SECONDS = 2400 // 40 min

// Markers (already normalized) that mark a call as part of a pitch cohort.
const PITCH_MARKERS = ['cal com meeting', 'call now requested']

// Dispositions where the lead never connected. These have a few seconds of ring
// time, so the talk-time bands would mislabel them "rushed" (PSAI). A no-show
// isn't a pitch attempt — exclude it from the cohort entirely.
const NO_CONNECT_MARKERS = ['no show']

// Lowercase + collapse any run of non-alphanumerics to a single space so
// "Cal.com Meeting", "CAL_COM_MEETING", and "call-now  requested" all match.
function normalize(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export type PitchFields = {
  campaign_name?: string | null
  disposition?: string | null
  talk_time?: number | null
}

// Eligible pitch cohort when campaign_name OR disposition contains a marker.
// Missing/empty fields → non-pitch.
export function isPitchCall(fields: PitchFields): boolean {
  const disp = normalize(fields.disposition)
  if (NO_CONNECT_MARKERS.some(m => disp.includes(m))) return false
  const hay = `${normalize(fields.campaign_name)} ${disp}`
  return PITCH_MARKERS.some(m => hay.includes(m))
}

// Band from talk time alone. Null/zero/negative → unknown (not target).
export function talkTimeBand(talkTime: number | null | undefined): RiskBand {
  if (!talkTime || talkTime <= 0) return 'unknown'
  if (talkTime < PITCH_HIGH_RISK_SECONDS) return 'high'
  if (talkTime < PITCH_WATCH_SECONDS) return 'watch'
  return 'target'
}

export type PitchRisk = {
  isPitch: boolean
  band: RiskBand // 'unknown' for non-pitch calls (no band applies)
  rushed: boolean // pitch call under the 30-minute high-risk cutoff
}

export function pitchCallRisk(fields: PitchFields): PitchRisk {
  if (!isPitchCall(fields)) return { isPitch: false, band: 'unknown', rushed: false }
  const band = talkTimeBand(fields.talk_time)
  return { isPitch: true, band, rushed: band === 'high' }
}

// ---- UI copy -------------------------------------------------------------

export const BAND_LABEL: Record<RiskBand, string> = {
  high: 'Rushed',
  watch: 'Watch',
  target: 'On target',
  unknown: 'Unknown',
}

// One-line "why" for the call detail page. Only meaningful for pitch calls.
export function explainPitchRisk(fields: PitchFields): string {
  const { band } = pitchCallRisk(fields)
  const mins = fields.talk_time ? Math.round((fields.talk_time / 60) * 10) / 10 : 0
  switch (band) {
    case 'high':
      return `Pitch call under 30 minutes of talk time (${mins} min) — flagged as rushed.`
    case 'watch':
      return `Pitch call between 30 and 40 minutes (${mins} min) — on the watch band.`
    case 'target':
      return `Pitch call at or above 40 minutes (${mins} min) — on target.`
    default:
      return 'Pitch call with no recorded talk time — risk band unknown.'
  }
}
