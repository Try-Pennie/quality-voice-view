import { parseAchieveSlackConfig, postAchieveSlackAlert } from '../../supabase/functions/_shared/achieve-slack.ts'

// Tiny runtime composition boundary: this Worker has string secrets, no bindings.
type Env = Readonly<Record<string, string | undefined>>
type WatchdogResult = { readonly status: 'healthy' | 'alerted' | 'alert_failed' | 'not_configured' }
const MONITOR_URL = 'https://miikotqnovnixpeqtqnd.supabase.co/functions/v1/achieve-weekly-report'

/** Independent of Supabase's scheduler/runtime. Never sends or previews email. */
export async function runAchieveWatchdog(env: Env, transport: typeof fetch = fetch): Promise<WatchdogResult> {
  const slack = parseAchieveSlackConfig(name => env[name])
  const reportSecret = env.ACHIEVE_WEEKLY_REPORT_SECRET
  if (slack === null || !reportSecret) return { status: 'not_configured' }
  let reason: 'http_error' | 'invalid_response' | 'unreachable' = 'unreachable'
  try {
    const response = await transport(MONITOR_URL, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', 'x-report-secret': reportSecret },
      body: JSON.stringify({ action: 'monitor' }),
      signal: AbortSignal.timeout(120_000),
    })
    reason = 'http_error'
    if (response.ok) {
      reason = 'invalid_response'
      const body: unknown = await response.json()
      if (typeof body === 'object' && body !== null && !Array.isArray(body)
        && 'ok' in body && body.ok === true && 'mode' in body && body.mode === 'monitor') {
        return { status: 'healthy' }
      }
    }
  } catch {
    // Never forward response bodies, exceptions, URLs, or headers into Slack.
  }
  // Independent lifetime: probe timeout must not cancel the failure notification.
  const delivered = await postAchieveSlackAlert(slack, [
    ':warning: Eavesly Achieve external watchdog',
    `The production monitor/cron check failed (${reason}). Check function availability, cron health, and configuration.`,
    'No report was sent or resent. No delivery or sync claim was changed.',
  ].join('\n'), { signal: AbortSignal.timeout(10_000) }, transport)
  return { status: delivered === 'sent' ? 'alerted' : 'alert_failed' }
}

async function authorized(request: Request, env: Env): Promise<boolean> {
  const expected = env.WATCHDOG_PROBE_SECRET
  if (!expected || expected.length < 32) return false
  const supplied = request.headers.get('Authorization') ?? ''
  const encoder = new TextEncoder()
  const hashes = await Promise.all([supplied, `Bearer ${expected}`].map(value =>
    crypto.subtle.digest('SHA-256', encoder.encode(value))))
  const left = new Uint8Array(hashes[0])
  const right = new Uint8Array(hashes[1])
  let difference = 0
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index]
  return difference === 0
}

export default {
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const result = await runAchieveWatchdog(env)
    console.info('achieve watchdog completed', result)
    if (result.status === 'alert_failed' || result.status === 'not_configured') {
      throw new Error('achieve_watchdog_unavailable')
    }
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/check'
      || !await authorized(request, env)) return new Response(null, { status: 404 })
    const result = await runAchieveWatchdog(env)
    return Response.json(result, { status: result.status === 'healthy' ? 200 : 503 })
  },
}
