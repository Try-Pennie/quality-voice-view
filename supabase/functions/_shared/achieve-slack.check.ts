import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { parseAchieveSlackConfig, postAchieveSlackAlert } from './achieve-slack.ts'

const env: Record<string, string> = {
  ACHIEVE_SLACK_ALERTS_ENABLED: 'true',
  ACHIEVE_SLACK_BOT_TOKEN: 'xoxb-synthetic-test-only',
  ACHIEVE_SLACK_CHANNEL_ID: 'C12345678',
}
const config = parseAchieveSlackConfig(name => env[name])
assert(config)
for (const override of [
  { ACHIEVE_SLACK_ALERTS_ENABLED: 'false' },
  { ACHIEVE_SLACK_BOT_TOKEN: 'xoxp-not-a-bot' },
  { ACHIEVE_SLACK_BOT_TOKEN: 'xoxb-invalid\nheader' },
  { ACHIEVE_SLACK_CHANNEL_ID: 'someone-else' },
]) assert.equal(parseAchieveSlackConfig(name => ({ ...env, ...override })[name]), null)

let status = 200
let reply = JSON.stringify({ ok: true, channel: config.channel })
let requests = 0
const server = createServer(async (request, response) => {
  requests++
  assert.equal(request.method, 'POST')
  assert.equal(request.headers.authorization, `Bearer ${config.token}`)
  let raw = ''
  for await (const chunk of request) raw += chunk
  assert.deepEqual(JSON.parse(raw), {
    channel: config.channel, text: 'synthetic alert', unfurl_links: false, unfurl_media: false,
  })
  response.writeHead(status, { 'Content-Type': 'application/json' }).end(reply)
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
assert(address && typeof address !== 'string')
const transport: typeof fetch = (input, init) => {
  assert.equal(input, 'https://slack.com/api/chat.postMessage')
  assert.equal(init?.redirect, 'manual')
  return fetch(`http://127.0.0.1:${address.port}`, init)
}
try {
  const send = () => postAchieveSlackAlert(config, 'synthetic alert', { signal: AbortSignal.timeout(2_000) }, transport)
  assert.equal(await send(), 'sent')
  for (const body of [{ ok: false, error: 'not_in_channel' }, { ok: true, channel: 'COTHER123' }, {}, null, []]) {
    reply = JSON.stringify(body)
    assert.equal(await send(), 'failed')
  }
  reply = 'not json'
  assert.equal(await send(), 'failed')
  status = 429
  assert.equal(await send(), 'failed')
  status = 302
  assert.equal(await send(), 'failed')
  const before = requests
  assert.equal(await postAchieveSlackAlert(config, 'synthetic alert', { signal: AbortSignal.abort() }, transport), 'cancelled')
  assert.equal(requests, before)
} finally {
  server.closeAllConnections()
  server.close()
}
console.log('achieve-slack.check.ts: all assertions passed')
