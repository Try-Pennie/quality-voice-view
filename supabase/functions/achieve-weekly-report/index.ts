// Weekly Achieve management email.
//
// pg_cron invokes {"action":"scheduled"} every 15 minutes during the two UTC
// hours that can contain 9 AM Eastern. The handler sends only during Monday's
// 9 AM ET hour and claims the completed week before calling Gmail.
//
// Required function secrets:
//   ACHIEVE_WEEKLY_REPORT_SECRET — shared with Vault for the cron request
//   ACHIEVE_REPORT_RECIPIENTS     — comma-separated fixed To allowlist
//   ACHIEVE_REPORT_CC             — comma-separated fixed Cc allowlist
//   ACHIEVE_PORTAL_URL            — HTTPS URL ending in /achieve
//   GMAIL_SENDER                  — Google Workspace mailbox to impersonate
//   GOOGLE_SA_EMAIL               — domain-delegated Google service account
//   GOOGLE_SA_PRIVATE_KEY         — service-account PKCS8 private key
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  ACHIEVE_REPORT_REPRESENTATIVE_LIMIT,
  achieveReportWeekEnding,
  isAchieveReportDeliveryHour,
  loadAchieveManagementReport,
} from '../_shared/achieve-management-report.ts'
import { googleServiceAccountAccessToken } from '../_shared/google-service-account.ts'
import { buildAchieveWeeklyEmail } from './email.ts'

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'

type RequestAction = 'scheduled' | 'test'
type Config = {
  readonly reportSecret: string
  readonly recipients: ReadonlyArray<string>
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

function parseConfig(): Config | null {
  const reportSecret = Deno.env.get('ACHIEVE_WEEKLY_REPORT_SECRET')?.trim() ?? ''
  const gmailSender = parseEmail(Deno.env.get('GMAIL_SENDER') ?? '')
  const serviceAccountEmail = parseEmail(Deno.env.get('GOOGLE_SA_EMAIL') ?? '')
  const serviceAccountPrivateKey = Deno.env.get('GOOGLE_SA_PRIVATE_KEY')?.trim() ?? ''
  const recipients = parseEmailList(Deno.env.get('ACHIEVE_REPORT_RECIPIENTS') ?? '')
  const ccRecipients = parseEmailList(Deno.env.get('ACHIEVE_REPORT_CC') ?? '')
  let portalUrl: string | null = null
  try {
    const candidate = new URL(Deno.env.get('ACHIEVE_PORTAL_URL') ?? '')
    if (candidate.protocol === 'https:' && candidate.pathname.endsWith('/achieve')) portalUrl = candidate.toString()
  } catch {
    portalUrl = null
  }
  if (
    !reportSecret || gmailSender === null || serviceAccountEmail === null || !serviceAccountPrivateKey
    || recipients === null || ccRecipients === null || recipients.length === 0
    || recipients.length + ccRecipients.length > 20
    || ccRecipients.some(email => recipients.includes(email)) || portalUrl === null
  ) return null
  return {
    reportSecret,
    recipients,
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

function parseAction(value: unknown): RequestAction | null {
  const body = record(value)
  if (!body || Object.keys(body).length !== 1) return null
  return body.action === 'scheduled' || body.action === 'test' ? body.action : null
}

function parseGmailMessageId(value: unknown): string | null {
  const body = record(value)
  return typeof body?.id === 'string' && body.id.length > 0 ? body.id : null
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const config = parseConfig()
  if (!config) return json({ error: 'not_configured' }, 503)
  const suppliedSecret = request.headers.get('x-report-secret') ?? ''
  if (!suppliedSecret || !(await secretsMatch(suppliedSecret, config.reportSecret))) {
    return json({ error: 'unauthorized' }, 401)
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }
  const action = parseAction(rawBody)
  if (!action) return json({ error: 'bad_request' }, 400)

  const now = new Date()
  if (action === 'scheduled' && !isAchieveReportDeliveryHour(now)) {
    return json({ ok: true, skipped: 'outside_delivery_hour' })
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )
  let claimedWeek: string | null = null
  let gmailSent = false

  try {
    const loadReport = (at: Date) => loadAchieveManagementReport(
      async range => admin.rpc('get_achieve_agent_feedback_dashboard', {
        p_start_at: range.startAt,
        p_end_at: range.endAt,
        p_representative_limit: ACHIEVE_REPORT_REPRESENTATIVE_LIMIT,
        p_representative_offset: 0,
      }),
      async () => admin.rpc('get_achieve_first_pay_outcomes'),
      async endAt => admin.rpc('list_achieve_agent_termination_monitoring', { p_end_at: endAt }),
      at,
    )
    const reportResult = await loadReport(now)
    if (!reportResult.ok) {
      console.error('achieve weekly report load failed', { reason: reportResult.reason })
      return json({ error: reportResult.reason }, 500)
    }
    const weekEnding = achieveReportWeekEnding(reportResult.report)
    if (action === 'scheduled') {
      const claim = await admin
        .from('achieve_weekly_report_sends')
        .insert({ week_ending: weekEnding, status: 'sending' })
      if (claim.error?.code === '23505') return json({ ok: true, skipped: 'already_sent_or_sending' })
      if (claim.error) {
        console.error('achieve weekly report claim failed', { code: claim.error.code })
        return json({ error: 'claim_failed' }, 500)
      }
      claimedWeek = weekEnding
    }

    const email = buildAchieveWeeklyEmail(
      reportResult.report,
      config.gmailSender,
      config.recipients,
      config.ccRecipients,
      config.portalUrl,
    )
    const accessToken = await googleServiceAccountAccessToken({
      serviceAccountEmail: config.serviceAccountEmail,
      privateKeyPem: config.serviceAccountPrivateKey,
      scope: GMAIL_SEND_SCOPE,
      subject: config.gmailSender,
    })
    const gmailResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: email.raw }),
    })
    if (!gmailResponse.ok) throw new Error(`gmail_send_failed:${gmailResponse.status}`)
    gmailSent = true
    const messageId = parseGmailMessageId(await gmailResponse.json())
    if (!messageId) throw new Error('gmail_send_response_invalid')

    if (claimedWeek !== null) {
      const delivery = await admin
        .from('achieve_weekly_report_sends')
        .update({ status: 'sent', sent_at: new Date().toISOString(), gmail_message_id: messageId })
        .eq('week_ending', claimedWeek)
        .eq('status', 'sending')
      if (delivery.error) throw new Error(`delivery_record_failed:${delivery.error.code}`)
    }

    return json({ ok: true, mode: action, week_ending: weekEnding, message_id: messageId })
  } catch (cause: unknown) {
    if (claimedWeek !== null && !gmailSent) {
      const release = await admin
        .from('achieve_weekly_report_sends')
        .delete()
        .eq('week_ending', claimedWeek)
        .eq('status', 'sending')
      if (release.error) console.error('achieve weekly report claim release failed', { code: release.error.code })
    }
    console.error('achieve weekly report failed', {
      stage: gmailSent ? 'delivery_record' : 'report_or_gmail',
      reason: cause instanceof Error ? cause.message.split(':')[0] : 'unknown',
    })
    return json({ error: 'weekly_report_failed' }, 500)
  }
})
