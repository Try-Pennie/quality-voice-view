import type { FirstPayEnrollmentPlan } from './achieve-first-pay-outcomes.ts'

export type FirstPayQaRating = 'Good' | 'Fair' | 'Poor'

type QaRollup = {
  readonly rating: FirstPayQaRating | null
  readonly aiReviewed: boolean
  readonly aiFlagged: boolean
}

type BoundaryRecord = Readonly<Record<string, unknown>>

function record(value: unknown): BoundaryRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as BoundaryRecord
}

function count(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(String(value))
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function fail(): never {
  throw new Error('achieve_first_pay_qa_rollup_invalid')
}

/** Validate the complete sparse, service-only QA rollup returned by Supabase. */
export function parseFirstPayQaRollups(value: unknown): ReadonlyMap<string, QaRollup> {
  const payload = record(value)
  const coverage = record(payload?.coverage)
  if (!payload || !coverage || !Array.isArray(payload.rows)) return fail()
  const expectedRows = count(coverage.rows)
  const expectedHuman = count(coverage.human_clients)
  const expectedAi = count(coverage.ai_clients)
  if (expectedRows === null || expectedHuman === null || expectedAi === null || expectedRows !== payload.rows.length) return fail()

  const rollups = new Map<string, QaRollup>()
  let humanClients = 0
  let aiClients = 0
  for (const raw of payload.rows) {
    const row = record(raw)
    const normalizedClientId = typeof row?.client_id === 'string' ? row.client_id.trim().toLowerCase() : ''
    const rating = row?.agent_rating === null ? null
      : row?.agent_rating === 'good' ? 'Good'
      : row?.agent_rating === 'fair' ? 'Fair'
      : row?.agent_rating === 'poor' ? 'Poor'
      : undefined
    if (
      !normalizedClientId || normalizedClientId.length > 255 || /[\r\n\0]/.test(normalizedClientId)
      || rating === undefined || typeof row?.ai_reviewed !== 'boolean' || typeof row.ai_flagged !== 'boolean'
      || (!row.ai_reviewed && row.ai_flagged) || (rating === null && !row.ai_reviewed)
      || rollups.has(normalizedClientId)
    ) return fail()
    if (rating !== null) humanClients++
    if (row.ai_reviewed) aiClients++
    rollups.set(normalizedClientId, { rating, aiReviewed: row.ai_reviewed, aiFlagged: row.ai_flagged })
  }
  if (humanClients !== expectedHuman || aiClients !== expectedAi) return fail()
  return rollups
}

function csvCell(value: string | boolean): string {
  const text = String(value)
  const safe = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

const HEADER = 'AFF Number,Enrollment Date,Termination Date,Client Deposit Flag,Termination Before First Pay Flag,Original Scheduled First Pay Date,WC Agent Email,Agent Rating,AI Flag'

/** Build Geoff's exact nine-column, CRLF weekly attachment without persistence. */
export function achieveFirstPayEnrollmentCsv(
  plan: FirstPayEnrollmentPlan,
  qa: ReadonlyMap<string, QaRollup>,
): string {
  const rows = [...plan.rows]
    .sort((left, right) => left.normalizedAffNumber < right.normalizedAffNumber ? -1 : left.normalizedAffNumber > right.normalizedAffNumber ? 1 : 0)
    .map(enrollment => {
      const review = qa.get(enrollment.normalizedAffNumber)
      return [
        enrollment.affNumber,
        enrollment.enrollmentDate ?? '',
        enrollment.terminationDate ?? '',
        enrollment.clientDepositFlag,
        enrollment.terminationBeforeFirstPayFlag,
        enrollment.originalScheduledFirstPayDate,
        enrollment.wcAgentEmail,
        review?.rating ?? '',
        review?.aiReviewed ? review.aiFlagged : '',
      ].map(csvCell).join(',')
    })
  return `${HEADER}\r\n${rows.join('\r\n')}\r\n`
}
