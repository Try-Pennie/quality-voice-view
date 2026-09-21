import {
  achieveReportWeekEnding,
  isAchieveReportDeliveryHour,
  type AchieveManagementReport,
  type AchieveManagementReportResult,
} from '../_shared/achieve-management-report.ts'

/** Authenticated weekly-report command accepted by the HTTP boundary. */
export type AchieveWeeklyReportCommand =
  | { readonly action: 'scheduled' | 'test' | 'preview' | 'preview_test' }
  | { readonly action: 'send'; readonly week_ending: string }

/** Prepared MIME returned by the existing report/email adapters. */
export type PreparedAchieveWeeklyEmail = { readonly raw: string }

/** Explicit I/O seam for weekly report orchestration and behavior checks. */
export type AchieveWeeklyReportOperations = {
  readonly loadReport: (now: Date, options: { readonly signal: AbortSignal }) => Promise<AchieveManagementReportResult>
  readonly prepareEmail: (
    report: AchieveManagementReport,
    internalOnly: boolean,
    options: { readonly signal: AbortSignal },
  ) => Promise<PreparedAchieveWeeklyEmail>
  readonly accessToken: (options: { readonly signal: AbortSignal }) => Promise<string>
  readonly claimDelivery: (
    weekEnding: string,
    options: { readonly signal: AbortSignal },
  ) => Promise<'claimed' | 'exists'>
  readonly sendEmail: (
    raw: string,
    accessToken: string,
    options: { readonly signal: AbortSignal },
  ) => Promise<string>
  readonly markSent: (
    weekEnding: string,
    messageId: string,
    options: { readonly signal: AbortSignal },
  ) => Promise<void>
}

/** Observable outcome translated to HTTP by the Edge Function entrypoint. */
export type AchieveWeeklyReportRunResult =
  | { readonly ok: true; readonly skipped: 'outside_delivery_hour' | 'already_sent_or_sending' }
  | { readonly ok: true; readonly mode: AchieveWeeklyReportCommand['action']; readonly weekEnding: string; readonly raw?: string; readonly messageId?: string }
  | { readonly ok: false; readonly status: 409; readonly error: 'week_ending_mismatch' }
  | { readonly ok: false; readonly status: 500; readonly error: string; readonly stage: string; readonly claimRetained: boolean }

/**
 * Run one report command under a caller-owned deadline.
 * A claimed send is never deleted automatically because provider acceptance can
 * be ambiguous after cancellation or a lost response.
 */
export async function runAchieveWeeklyReport(
  command: AchieveWeeklyReportCommand,
  now: Date,
  signal: AbortSignal,
  operations: AchieveWeeklyReportOperations,
): Promise<AchieveWeeklyReportRunResult> {
  if (command.action === 'scheduled' && !isAchieveReportDeliveryHour(now)) {
    return { ok: true, skipped: 'outside_delivery_hour' }
  }

  let stage = 'report_load'
  let claimed = false
  try {
    const loaded = await operations.loadReport(now, { signal })
    if (!loaded.ok) {
      return { ok: false, status: 500, error: loaded.reason, stage, claimRetained: false }
    }
    const weekEnding = achieveReportWeekEnding(loaded.report)
    if (command.action === 'send' && command.week_ending !== weekEnding) {
      return { ok: false, status: 409, error: 'week_ending_mismatch' }
    }

    stage = 'email_prepare'
    const prepared = await operations.prepareEmail(
      loaded.report,
      command.action === 'test' || command.action === 'preview_test',
      { signal },
    )
    if (command.action === 'preview' || command.action === 'preview_test') {
      return { ok: true, mode: command.action, weekEnding, raw: prepared.raw }
    }

    stage = 'google_token'
    const accessToken = await operations.accessToken({ signal })
    if (command.action === 'scheduled' || command.action === 'send') {
      stage = 'delivery_claim'
      const claim = await operations.claimDelivery(weekEnding, { signal })
      if (claim === 'exists') return { ok: true, skipped: 'already_sent_or_sending' }
      claimed = true
    }

    stage = 'gmail_send'
    const messageId = await operations.sendEmail(prepared.raw, accessToken, { signal })
    if (claimed) {
      stage = 'delivery_record'
      await operations.markSent(weekEnding, messageId, { signal })
    }
    return { ok: true, mode: command.action, weekEnding, messageId }
  } catch {
    return { ok: false, status: 500, error: 'weekly_report_failed', stage, claimRetained: claimed }
  }
}
