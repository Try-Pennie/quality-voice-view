const MAX_REASON_CODES = 10
const MAX_AGENT_ATTEMPTS = 10
const MAX_EVIDENCE_QUOTES = 10
const MAX_NAME_LENGTH = 120
const MAX_QUOTE_LENGTH = 600
const MAX_DETECTION_VERSION_LENGTH = 120

const TRANSFER_REASON_TEXT: Readonly<Record<string, string>> = {
  live_rep_then_ivr_reentry_then_live_rep:
    'The client reached a live representative, returned to the automated phone menu, and then reached another live representative.',
  ivr_reentry_before_later_live_agent:
    'The client returned to the automated phone menu before later reaching a live agent.',
}

/** A live-agent transfer attempt detected within the partner call leg. */
export type TransferAgentAttempt = {
  readonly line: number
  readonly nameAsr: string | null
  readonly quote: string
}

/** A partner-leg transcript excerpt supporting a transfer-experience result. */
export type TransferEvidence = {
  readonly line: number
  readonly quote: string
}

/** The safely parsed additive transfer-experience result used by the Achieve portal. */
export type TransferExperience = {
  readonly poorTransfer: boolean
  readonly reasons: readonly string[]
  readonly ivrReentryLines: readonly number[]
  readonly agentAttempts: readonly TransferAgentAttempt[]
  readonly evidence: readonly TransferEvidence[]
  readonly detectionVersion: string | null
}

function isTransferRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1).trimEnd()}…`
}

function reasonCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toLowerCase()
  return /^[a-z][a-z0-9_]{0,99}$/.test(code) ? code : null
}

function lineNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function parseReasons(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  const reasons = new Set<string>()
  for (const candidate of value.slice(0, MAX_REASON_CODES)) {
    const parsed = reasonCode(candidate)
    if (parsed) reasons.add(parsed)
  }
  return Array.from(reasons)
}

function parseLineNumbers(value: unknown): readonly number[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_EVIDENCE_QUOTES).flatMap(candidate => {
    const parsed = lineNumber(candidate)
    return parsed === null ? [] : [parsed]
  })
}

function parseAgentAttempts(value: unknown): readonly TransferAgentAttempt[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_AGENT_ATTEMPTS).flatMap(candidate => {
    if (!isTransferRecord(candidate)) return []
    const line = lineNumber(candidate.line)
    const quote = boundedText(candidate.quote, MAX_QUOTE_LENGTH)
    if (line === null || quote === null) return []
    return [{
      line,
      nameAsr: boundedText(candidate.name_asr, MAX_NAME_LENGTH),
      quote,
    }]
  })
}

function parseEvidence(value: unknown): readonly TransferEvidence[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_EVIDENCE_QUOTES).flatMap(candidate => {
    if (!isTransferRecord(candidate)) return []
    const line = lineNumber(candidate.line)
    const quote = boundedText(candidate.quote, MAX_QUOTE_LENGTH)
    return line === null || quote === null ? [] : [{ line, quote }]
  })
}

/**
 * Parse the backend's additive transfer_experience JSON without trusting its
 * runtime shape. Historical or malformed values return null and keep the
 * portal's pre-transfer rendering path unchanged.
 */
export function parseTransferExperience(value: unknown): TransferExperience | null {
  if (!isTransferRecord(value) || typeof value.poor_transfer !== 'boolean') return null

  return {
    poorTransfer: value.poor_transfer,
    reasons: parseReasons(value.reasons),
    ivrReentryLines: parseLineNumbers(value.ivr_reentry_lines),
    agentAttempts: parseAgentAttempts(value.agent_attempts),
    evidence: parseEvidence(value.evidence),
    detectionVersion:
      boundedText(value.detection_version, MAX_DETECTION_VERSION_LENGTH) ??
      boundedText(value.detection, MAX_DETECTION_VERSION_LENGTH),
  }
}

/** Convert a transfer reason code into narrowly scoped, partner-safe copy. */
export function humanizeTransferReason(reason: string): string {
  const code = reasonCode(reason)
  if (!code) return 'An unrecognized transfer issue was detected.'
  const knownText = TRANSFER_REASON_TEXT[code]
  if (knownText) return knownText
  return `Transfer issue: ${code.replace(/_/g, ' ')}.`
}

/** Return a concise queue-safe explanation for a poor transfer result. */
export function transferExperienceSummary(transfer: TransferExperience): string {
  const firstReason = transfer.reasons[0]
  if (!firstReason) return 'The handoff experience did not complete smoothly.'
  const summary = humanizeTransferReason(firstReason)
  if (transfer.reasons.length === 1) return summary
  return `${summary.replace(/\.$/, '')} (+${transfer.reasons.length - 1} more).`
}
