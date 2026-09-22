// Weekly Achieve management email.
//
// pg_cron invokes {"action":"scheduled"} every 15 minutes. The handler runs
// PII-free reliability monitoring each time, but sends only during Monday's
// 9 AM ET hour and claims the completed week immediately before Gmail.
//
// Required function secrets:
//   ACHIEVE_WEEKLY_REPORT_SECRET — shared with Vault for the cron request
//   ACHIEVE_REPORT_RECIPIENTS     — comma-separated fixed To allowlist
//   ACHIEVE_REPORT_CC             — comma-separated fixed Cc allowlist
//   ACHIEVE_REPORT_TEST_RECIPIENT — internal-only recipient for test sends
//   ACHIEVE_PORTAL_URL            — HTTPS URL ending in /achieve
//   GMAIL_SENDER                  — Google Workspace mailbox to impersonate
//   GOOGLE_SA_EMAIL               — domain-delegated Google service account
//   GOOGLE_SA_PRIVATE_KEY         — service-account PKCS8 private key
//   SNOWFLAKE_*                   — the eight shared key-pair SQL API secrets
//   DEPLOYMENT_ENVIRONMENT        — production or staging (staging is inert)
//   ACHIEVE_EXTERNAL_IO_ENABLED   — exact "true" only after production approval
// Optional production monitoring (all required to post):
//   ACHIEVE_SLACK_ALERTS_ENABLED, ACHIEVE_SLACK_BOT_TOKEN, ACHIEVE_SLACK_CHANNEL_ID
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { isAchieveExternalIoAllowed } from '../_shared/achieve-deployment-safety.ts'
import { parseAchieveSlackConfig, postAchieveSlackAlert } from '../_shared/achieve-slack.ts'
import {
  achieveFirstPayEnrollmentCsv,
  parseFirstPayQaRollups,
} from '../_shared/achieve-first-pay-enrollment-export.ts'
import {
  fetchSnowflakeFirstPayEnrollments,
  snowflakeConfigFromEnv,
  type SnowflakeOutcomeConfig,
} from '../_shared/achieve-first-pay-outcomes.ts'
import {
  ACHIEVE_REPORT_REPRESENTATIVE_LIMIT,
  isAchieveReportDeliveryHour,
  loadAchieveManagementReport,
} from '../_shared/achieve-management-report.ts'
import { googleServiceAccountAccessToken } from '../_shared/google-service-account.ts'
import { achieveWeeklyEmailEnvelope, buildAchieveWeeklyEmail } from './email.ts'
import {
  parseAchieveReliabilitySnapshot,
  runAchieveReliabilityAlert,
  type AchieveReliabilityAlertOperations,
} from './monitoring.ts'
import {
  runAchieveWeeklyReport,
  type AchieveWeeklyReportCommand,
  type AchieveWeeklyReportOperations,
} from './orchestration.ts'

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
const HANDLER_DEADLINE_MS = 110_000

type ReportRequest = AchieveWeeklyReportCommand | { readonly action: 'monitor' }
type RuntimeConfig = {
  readonly reportSecret: string
  readonly supabaseUrl: string
  readonly serviceRoleKey: string
  readonly deploymentEnvironment: 'production' | 'staging'
  readonly externalIoEnabled: boolean
}
type Config = {
  readonly snowflake: SnowflakeOutcomeConfig
  readonly recipients: ReadonlyArray<string>
  readonly testRecipient: string
  readonly ccRecipients: ReadonlyArray<string>
  readonly portalUrl: string
  readonly gmailSender: string
  readonly serviceAccountEmail: string
  readonly serviceAccountPrivateKey: string
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  // SAFETY: Runtime checks establish the indexable record invariant; consumed
  // fields are refined separately below.
  return value as Readonly<Record<string, unknown>>
}

function parseEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase()
  if (normalized.length < 3 || normalized.length > 254 || /[\r\n]/.test(normalized)) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null
}

function parseEmailList(value: string): ReadonlyArray<string> | null {
  const values = value.split(',').map(email => email.trim()).filter(Boolean)
  const parsed = values.map(parseEmail)
  return parsed.some(email => email === null)
    ? null
    : [...new Set(parsed.flatMap(email => email === null ? [] : [email]))]
}

function parseRuntimeConfig(): RuntimeConfig | null {
  const reportSecret = Deno.env.get('ACHIEVE_WEEKLY_REPORT_SECRET')?.trim() ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim() ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? ''
  const deploymentEnvironment = Deno.env.get('DEPLOYMENT_ENVIRONMENT')?.trim().toLowerCase()
  if (
    !reportSecret || !supabaseUrl || !serviceRoleKey
    || (deploymentEnvironment !== 'production' && deploymentEnvironment !== 'staging')
  ) return null
  return {
    reportSecret,
    supabaseUrl,
    serviceRoleKey,
    deploymentEnvironment,
    externalIoEnabled: Deno.env.get('ACHIEVE_EXTERNAL_IO_ENABLED') === 'true',
  }
}

function parseExternalConfig(): Config | null {
  const gmailSender = parseEmail(Deno.env.get('GMAIL_SENDER') ?? '')
  const serviceAccountEmail = parseEmail(Deno.env.get('GOOGLE_SA_EMAIL') ?? '')
  const serviceAccountPrivateKey = Deno.env.get('GOOGLE_SA_PRIVATE_KEY')?.trim() ?? ''
  const recipients = parseEmailList(Deno.env.get('ACHIEVE_REPORT_RECIPIENTS') ?? '')
  const testRecipient = parseEmail(Deno.env.get('ACHIEVE_REPORT_TEST_RECIPIENT') ?? '')
  const ccRecipients = parseEmailList(Deno.env.get('ACHIEVE_REPORT_CC') ?? '')
  const snowflake = snowflakeConfigFromEnv(name => Deno.env.get(name))
  let portalUrl: string | null = null
  try {
    const candidate = new URL(Deno.env.get('ACHIEVE_PORTAL_URL') ?? '')
    if (candidate.protocol === 'https:' && candidate.pathname.endsWith('/achieve')) portalUrl = candidate.toString()
  } catch {
    portalUrl = null
  }
  if (
    gmailSender === null || serviceAccountEmail === null || !serviceAccountPrivateKey
    || recipients === null || testRecipient === null || ccRecipients === null || recipients.length === 0
    || recipients.length + ccRecipients.length > 20
    || ccRecipients.some(email => recipients.includes(email)) || portalUrl === null || snowflake === null
  ) return null
  return {
    snowflake,
    recipients,
    testRecipient,
    ccRecipients,
    portalUrl,
    gmailSender,
    serviceAccountEmail,
    serviceAccountPrivateKey,
  }
}

async function secretsMatch(supplied: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [suppliedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  const left = new Uint8Array(suppliedHash)
  const right = new Uint8Array(expectedHash)
  let difference = 0
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index]
  return difference === 0
}

function parseReportRequest(value: unknown): ReportRequest | null {
  const body = record(value)
  if (!body) return null
  if (body.action === 'send' && Object.keys(body).length === 2
    && typeof body.week_ending === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.week_ending)) {
    return { action: 'send', week_ending: body.week_ending }
  }
  if (Object.keys(body).length !== 1) return null
  return body.action === 'scheduled' || body.action === 'test'
    || body.action === 'preview' || body.action === 'preview_test' || body.action === 'monitor'
    ? { action: body.action }
    : null
}

function parseGmailMessageId(value: unknown): string | null {
  const body = record(value)
  return typeof body?.id === 'string' && body.id.length > 0 ? body.id : null
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const runtime = parseRuntimeConfig()
  if (!runtime) return json({ error: 'not_configured' }, 503)
  const suppliedSecret = request.headers.get('x-report-secret') ?? ''
  if (!suppliedSecret || !(await secretsMatch(suppliedSecret, runtime.reportSecret))) {
    return json({ error: 'unauthorized' }, 401)
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }
  const command = parseReportRequest(rawBody)
  if (!command) return json({ error: 'bad_request' }, 400)

  // Staging is deliberately inert. This gate precedes client construction and
  // every Snowflake, Google, Gmail, and delivery-ledger operation.
  if (!isAchieveExternalIoAllowed(runtime)) {
    return json({ error: 'external_io_disabled' }, 503)
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(HANDLER_DEADLINE_MS)])
  const now = new Date()
  const admin = createClient(runtime.supabaseUrl, runtime.serviceRoleKey)

  let monitorError: 'monitor_not_configured' | 'monitor_failed' | 'monitor_cron_unavailable' | null = null
  if (command.action === 'scheduled' || command.action === 'monitor') {
    const slack = parseAchieveSlackConfig(name => Deno.env.get(name))
    if (slack === null) {
      monitorError = 'monitor_not_configured'
    } else {
      try {
        const [snapshotResult, cronResult] = await Promise.all([
          admin.rpc('achieve_report_reliability_snapshot', { p_now: now.toISOString() }).abortSignal(signal),
          admin.rpc('achieve_report_cron_healthy').abortSignal(signal),
        ])
        if (snapshotResult.error || cronResult.error) throw new Error('monitor_snapshot_failed')
        if (cronResult.data !== true) monitorError = 'monitor_cron_unavailable'
        const snapshot = parseAchieveReliabilitySnapshot(snapshotResult.data)
        if (snapshot === null) throw new Error('monitor_snapshot_invalid')
        const alertOperations: AchieveReliabilityAlertOperations = {
          claim: async (fingerprint, notificationHour, options) => {
            const claim = await admin
              .from('achieve_reliability_alert_deliveries')
              .insert({ fingerprint, notification_hour: notificationHour })
              .abortSignal(options.signal)
            if (claim.error?.code === '23505') return 'duplicate'
            if (claim.error) throw new Error('monitor_claim_failed')
            return 'claimed'
          },
          send: async (payload, options) => {
            const slackSignal = AbortSignal.any([options.signal, AbortSignal.timeout(10_000)])
            const delivered = await postAchieveSlackAlert(slack, payload.text, { signal: slackSignal })
            if (delivered !== 'sent') throw new Error('monitor_delivery_failed')
          },
        }
        const monitor = await runAchieveReliabilityAlert(snapshot, now, signal, alertOperations)
        console.info('achieve reliability monitor completed', { status: monitor.status })
      } catch {
        monitorError = 'monitor_failed'
      }
    }
    if (monitorError !== null) {
      console.error('achieve reliability monitor unavailable', { reason: monitorError })
    }
    if (command.action === 'monitor') {
      return monitorError === null
        ? json({ ok: true, mode: 'monitor' })
        : json({ error: monitorError }, 503)
    }
    if (!isAchieveReportDeliveryHour(now)) {
      return monitorError === null
        ? json({ ok: true, skipped: 'outside_delivery_hour' })
        : json({ error: monitorError }, 503)
    }
  }

  const config = parseExternalConfig()
  if (!config) return json({ error: 'not_configured' }, 503)
  const operations: AchieveWeeklyReportOperations = {
    loadReport: (at, options) => loadAchieveManagementReport(
      async range => admin.rpc('get_achieve_agent_feedback_dashboard', {
        p_start_at: range.startAt,
        p_end_at: range.endAt,
        p_representative_limit: ACHIEVE_REPORT_REPRESENTATIVE_LIMIT,
        p_representative_offset: 0,
      }).abortSignal(options.signal),
      async () => admin.rpc('get_achieve_first_pay_outcomes').abortSignal(options.signal),
      async endAt => admin.rpc('get_achieve_termination_monitoring_report', { p_end_at: endAt })
        .abortSignal(options.signal),
      at,
    ),
    prepareEmail: async (report, internalOnly, options) => {
      const [enrollmentPlan, qaResult] = await Promise.all([
        fetchSnowflakeFirstPayEnrollments(config.snowflake, now, { signal: options.signal }),
        admin.rpc('get_achieve_first_pay_export_qa_rollups').abortSignal(options.signal),
      ])
      if (qaResult.error) throw new Error('achieve_first_pay_qa_rollup_query_failed')
      const enrollmentCsv = achieveFirstPayEnrollmentCsv(
        enrollmentPlan,
        parseFirstPayQaRollups(qaResult.data),
      )
      const envelope = achieveWeeklyEmailEnvelope(
        internalOnly,
        config.recipients,
        config.ccRecipients,
        config.testRecipient,
      )
      return buildAchieveWeeklyEmail(
        report,
        config.gmailSender,
        envelope.recipients,
        envelope.ccRecipients,
        config.portalUrl,
        { sourceAsOf: enrollmentPlan.sourceAsOf, csv: enrollmentCsv },
      )
    },
    accessToken: options => googleServiceAccountAccessToken({
      serviceAccountEmail: config.serviceAccountEmail,
      privateKeyPem: config.serviceAccountPrivateKey,
      scope: GMAIL_SEND_SCOPE,
      subject: config.gmailSender,
    }, options),
    claimDelivery: async (weekEnding, options) => {
      const claim = await admin
        .from('achieve_weekly_report_sends')
        .insert({ week_ending: weekEnding, status: 'sending' })
        .abortSignal(options.signal)
      if (claim.error?.code === '23505') return 'exists'
      if (claim.error) throw new Error('claim_failed')
      return 'claimed'
    },
    sendEmail: async (raw, accessToken, options) => {
      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
        signal: options.signal,
      })
      if (!response.ok) throw new Error(`gmail_send_failed:${response.status}`)
      const messageId = parseGmailMessageId(await response.json())
      if (!messageId) throw new Error('gmail_send_response_invalid')
      return messageId
    },
    markSent: async (weekEnding, messageId, options) => {
      const delivery = await admin
        .from('achieve_weekly_report_sends')
        .update({ status: 'sent', sent_at: new Date().toISOString(), gmail_message_id: messageId })
        .eq('week_ending', weekEnding)
        .eq('status', 'sending')
        .abortSignal(options.signal)
        .select('week_ending')
        .maybeSingle()
      if (delivery.error || delivery.data === null) throw new Error('delivery_record_failed')
    },
  }

  const result = await runAchieveWeeklyReport(command, now, signal, operations)
  if (!result.ok) {
    console.error('achieve weekly report failed', {
      stage: 'stage' in result ? result.stage : 'week_validation',
      reason: result.error,
      claimRetained: 'claimRetained' in result ? result.claimRetained : false,
    })
    return json({ error: result.error }, result.status)
  }
  if ('skipped' in result) return json({ ok: true, skipped: result.skipped })
  if (result.raw !== undefined) {
    // The exact MIME includes sensitive enrollment data. Never log or cache it.
    return new Response(JSON.stringify({
      ok: true,
      mode: result.mode,
      week_ending: result.weekEnding,
      raw: result.raw,
    }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  }
  return json({
    ok: true,
    mode: result.mode,
    week_ending: result.weekEnding,
    message_id: result.messageId,
  })
})
