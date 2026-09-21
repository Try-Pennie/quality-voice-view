const ISSUE_CODES = [
  'outcome_snapshot_not_current',
  'termination_snapshot_not_current',
  'snapshot_source_mismatch',
  'daily_sync_claim_stuck',
  'weekly_delivery_claim_stuck',
  'weekly_delivery_overdue',
] as const

type IssueCode = typeof ISSUE_CODES[number]

/** Parsed, PII-free reliability state returned by Postgres. */
export type AchieveReliabilitySnapshot = {
  readonly ok: boolean
  readonly expectedSourceAsOf: string
  readonly outcomeSourceAsOf: string | null
  readonly terminationSourceAsOf: string | null
  readonly expectedWeekEnding: string
  readonly stuckSyncClaims: number
  readonly stuckDeliveryClaims: number
  readonly issues: ReadonlyArray<IssueCode>
}

/** Slack's minimal incoming-webhook payload. */
export type AchieveReliabilitySlackPayload = { readonly text: string }

/** Real persistence and transport seam used by the scheduled handler. */
export type AchieveReliabilityAlertOperations = {
  readonly claim: (
    fingerprint: string,
    notificationHour: string,
    options: { readonly signal: AbortSignal },
  ) => Promise<'claimed' | 'duplicate'>
  readonly send: (
    payload: AchieveReliabilitySlackPayload,
    options: { readonly signal: AbortSignal },
  ) => Promise<void>
}

/** Monitor outcome suitable for safe structured logs. */
export type AchieveReliabilityAlertResult =
  | { readonly status: 'healthy' | 'duplicate' }
  | { readonly status: 'sent'; readonly issues: ReadonlyArray<IssueCode> }

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  // SAFETY: Runtime checks establish an indexable boundary record.
  return value as Readonly<Record<string, unknown>>
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** Parse only the aggregate fields allowed to reach Slack. */
export function parseAchieveReliabilitySnapshot(value: unknown): AchieveReliabilitySnapshot | null {
  const payload = record(value)
  const expectedSourceAsOf = isoDate(payload?.expected_source_as_of)
  const outcomeSourceAsOf = payload?.outcome_source_as_of === null ? null : isoDate(payload?.outcome_source_as_of)
  const terminationSourceAsOf = payload?.termination_source_as_of === null
    ? null
    : isoDate(payload?.termination_source_as_of)
  const expectedWeekEnding = isoDate(payload?.expected_week_ending)
  const stuckSyncClaims = count(payload?.stuck_sync_claims)
  const stuckDeliveryClaims = count(payload?.stuck_delivery_claims)
  if (
    typeof payload?.ok !== 'boolean' || expectedSourceAsOf === null
    || (outcomeSourceAsOf === null && payload?.outcome_source_as_of !== null)
    || (terminationSourceAsOf === null && payload?.termination_source_as_of !== null)
    || expectedWeekEnding === null || stuckSyncClaims === null || stuckDeliveryClaims === null
    || !Array.isArray(payload?.issues)
  ) return null
  const issues = payload.issues.filter((issue): issue is IssueCode => (
    typeof issue === 'string' && (ISSUE_CODES as ReadonlyArray<string>).includes(issue)
  ))
  if (issues.length !== payload.issues.length || new Set(issues).size !== issues.length || payload.ok !== (issues.length === 0)) {
    return null
  }
  return {
    ok: payload.ok,
    expectedSourceAsOf,
    outcomeSourceAsOf,
    terminationSourceAsOf,
    expectedWeekEnding,
    stuckSyncClaims,
    stuckDeliveryClaims,
    issues,
  }
}

async function fingerprint(snapshot: AchieveReliabilitySnapshot): Promise<string> {
  const stable = JSON.stringify({
    issues: [...snapshot.issues].sort(),
    expectedSourceAsOf: snapshot.expectedSourceAsOf,
    outcomeSourceAsOf: snapshot.outcomeSourceAsOf,
    terminationSourceAsOf: snapshot.terminationSourceAsOf,
    expectedWeekEnding: snapshot.expectedWeekEnding,
  })
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable)))
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function notificationHour(now: Date): string {
  const hour = new Date(now)
  hour.setUTCMinutes(0, 0, 0)
  return hour.toISOString()
}

function slackPayload(snapshot: AchieveReliabilitySnapshot): AchieveReliabilitySlackPayload {
  return {
    text: [
      ':warning: Eavesly Achieve reliability deadline missed',
      `Issues: ${snapshot.issues.join(', ')}`,
      `Minimum accepted source: ${snapshot.expectedSourceAsOf}; outcomes: ${snapshot.outcomeSourceAsOf ?? 'missing'}; terminations: ${snapshot.terminationSourceAsOf ?? 'missing'}`,
      `Expected sent week: ${snapshot.expectedWeekEnding}; stuck sync claims: ${snapshot.stuckSyncClaims}; stuck delivery claims: ${snapshot.stuckDeliveryClaims}`,
      'No report was resent and no claim was deleted. Investigate the ledgers and provider mailbox before manual recovery.',
    ].join('\n'),
  }
}

/** Deliver at most one alert per issue fingerprint per UTC hour. */
export async function runAchieveReliabilityAlert(
  snapshot: AchieveReliabilitySnapshot,
  now: Date,
  signal: AbortSignal,
  operations: AchieveReliabilityAlertOperations,
): Promise<AchieveReliabilityAlertResult> {
  if (snapshot.ok) return { status: 'healthy' }
  const alertFingerprint = await fingerprint(snapshot)
  const claim = await operations.claim(alertFingerprint, notificationHour(now), { signal })
  if (claim === 'duplicate') return { status: 'duplicate' }
  await operations.send(slackPayload(snapshot), { signal })
  return { status: 'sent', issues: snapshot.issues }
}
