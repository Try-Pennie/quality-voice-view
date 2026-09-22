import assert from 'node:assert/strict'
import worker, { runAchieveWatchdog } from './index.ts'

const env = {
  ACHIEVE_SLACK_ALERTS_ENABLED: 'true',
  ACHIEVE_SLACK_BOT_TOKEN: 'xoxb-synthetic-only',
  ACHIEVE_SLACK_CHANNEL_ID: 'C12345678',
  ACHIEVE_WEEKLY_REPORT_SECRET: 'synthetic-report-secret',
  WATCHDOG_PROBE_SECRET: 'synthetic-probe-secret-at-least-32-characters',
}
let monitorResponse = () => Response.json({ ok: true, mode: 'monitor' })
let slackResponse = () => Response.json({ ok: true, channel: env.ACHIEVE_SLACK_CHANNEL_ID })
const alerts: string[] = []
const transport: typeof fetch = async (input, init) => {
  assert.equal(init?.method, 'POST')
  assert.equal(init?.redirect, 'manual')
  assert(init?.signal && !init.signal.aborted)
  if (input === 'https://slack.com/api/chat.postMessage') {
    const payload = JSON.parse(String(init.body))
    assert.equal(payload.channel, env.ACHIEVE_SLACK_CHANNEL_ID)
    alerts.push(payload.text)
    assert(!JSON.stringify(payload).includes('synthetic-report-secret'))
    assert(!JSON.stringify(payload).includes('private-response'))
    return slackResponse()
  }
  assert.equal(input, 'https://miikotqnovnixpeqtqnd.supabase.co/functions/v1/achieve-weekly-report')
  assert.deepEqual(JSON.parse(String(init.body)), { action: 'monitor' })
  assert.equal(new Headers(init.headers).get('x-report-secret'), env.ACHIEVE_WEEKLY_REPORT_SECRET)
  return monitorResponse()
}
assert.deepEqual(await runAchieveWatchdog(env, transport), { status: 'healthy' })
assert.equal(alerts.length, 0)
for (const response of [
  () => new Response('private-response', { status: 503 }),
  () => new Response('private-response', { status: 401 }),
  () => new Response('private-response', { status: 302 }),
  () => Response.json({ ok: false }),
  () => Response.json({ ok: true, mode: 'scheduled' }),
  () => new Response('invalid json'),
  () => { throw new Error('private-response') },
]) {
  monitorResponse = response
  const before = alerts.length
  assert.deepEqual(await runAchieveWatchdog(env, transport), { status: 'alerted' })
  assert.equal(alerts.length, before + 1)
}
slackResponse = () => Response.json({ ok: false, error: 'private-response' })
assert.deepEqual(await runAchieveWatchdog(env, transport), { status: 'alert_failed' })
const noIo: typeof fetch = async () => { throw new Error('unexpected network') }
assert.deepEqual(await runAchieveWatchdog({ ...env, ACHIEVE_SLACK_ALERTS_ENABLED: 'false' }, noIo), { status: 'not_configured' })
assert.deepEqual(await runAchieveWatchdog({ ...env, ACHIEVE_WEEKLY_REPORT_SECRET: '' }, noIo), { status: 'not_configured' })
for (const [method, path, authorization] of [
  ['GET', '/check', `Bearer ${env.WATCHDOG_PROBE_SECRET}`],
  ['POST', '/wrong', `Bearer ${env.WATCHDOG_PROBE_SECRET}`],
  ['POST', '/check', 'Bearer wrong'],
  ['POST', '/check', ''],
]) {
  const response = await worker.fetch(new Request(`https://watchdog.test${path}`, { method, headers: { authorization } }), env)
  assert.equal(response.status, 404)
}
const authorized = await worker.fetch(new Request('https://watchdog.test/check', {
  method: 'POST', headers: { Authorization: `Bearer ${env.WATCHDOG_PROBE_SECRET}` },
}), { ...env, ACHIEVE_SLACK_ALERTS_ENABLED: 'false' })
assert.equal(authorized.status, 503)
assert.deepEqual(await authorized.json(), { status: 'not_configured' })
console.log('watchdog.check.ts: all assertions passed')
