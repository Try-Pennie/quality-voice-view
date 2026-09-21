// Non-delivering HTTP contract check. Only preview, rejected commands, and a
// deliberately stale recovery week; never invoke test/scheduled or a current-week send.
// REPORT_URL=... REPORT_SECRET=... npx tsx supabase/functions/achieve-weekly-report/live.check.ts
// The preview contains enrollment data: retain no MIME or rows in test output.
import assert from 'node:assert/strict'

const url = process.env.REPORT_URL
const secret = process.env.REPORT_SECRET
assert.ok(url && secret, 'REPORT_URL and REPORT_SECRET are required')

async function request(body: unknown, credential = secret) {
  return fetch(url!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-report-secret': credential! },
    body: JSON.stringify(body),
  })
}

assert.equal((await request({ action: 'preview' }, 'incorrect-secret')).status, 401)
for (const body of [
  { action: 'send' },
  { action: 'send', week_ending: 'not-a-date' },
  { action: 'preview', recipients: ['unauthorized@example.test'] },
  { action: 'send', week_ending: '2000-01-02', force: true },
]) {
  assert.equal((await request(body)).status, 400, 'Invalid commands must fail before report loading')
}
const stale = await request({ action: 'send', week_ending: '2000-01-02' })
assert.equal(stale.status, 409, 'A stale recovery must not send the current report')
assert.deepEqual(await stale.json(), { error: 'week_ending_mismatch' })

const preview = await request({ action: 'preview' })
assert.equal(preview.status, 200, 'Preview must build the complete report without Gmail')
assert.equal(preview.headers.get('cache-control'), 'no-store')
const result: unknown = await preview.json()
assert.ok(typeof result === 'object' && result !== null && 'ok' in result && result.ok === true
  && 'mode' in result && result.mode === 'preview'
  && 'week_ending' in result && typeof result.week_ending === 'string'
  && 'raw' in result && typeof result.raw === 'string')
const mime = Buffer.from(result.raw, 'base64url').toString('utf8')
assert.equal((mime.match(/Content-Disposition: attachment;/g) ?? []).length, 3)
assert.ok(mime.includes('Content-Type: text/html; charset="UTF-8"'))
assert.ok(mime.includes('Content-Type: text/plain; charset="UTF-8"'))
assert.ok(mime.includes(`achieve-management-${result.week_ending}.csv`))
assert.ok(mime.includes(`achieve-first-pay-outcomes-${result.week_ending}.csv`))
assert.ok(Buffer.byteLength(mime) < 25 * 1024 * 1024)
console.log(`PASS: authentication, strict commands, stale-week guard, no-send preview, three attachments (${result.week_ending})`)
