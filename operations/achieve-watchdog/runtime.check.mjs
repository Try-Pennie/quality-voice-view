// Run with Wrangler 4.90.0 on PATH (CI uses npm exec). No credentials or real I/O.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const wrangler = realpathSync(execFileSync('which', ['wrangler'], { encoding: 'utf8' }).trim());
const require = createRequire(wrangler);
const { Miniflare, createFetchMock } = require('miniflare');
const output = mkdtempSync(join(tmpdir(), 'achieve-watchdog-runtime-'));
let runtime;
try {
  execFileSync('wrangler', ['deploy', '--dry-run', '--outdir', output,
    '--config', 'operations/achieve-watchdog/wrangler.jsonc'], {
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'pipe', timeout: 60_000,
  });
  const network = createFetchMock();
  network.disableNetConnect();
  const probeSecret = 'synthetic-runtime-probe-at-least-32-characters';
  runtime = new Miniflare({
    modules: true, modulesRoot: output, scriptPath: join(output, 'index.js'),
    compatibilityDate: '2026-05-14', fetchMock: network,
    bindings: {
      WATCHDOG_PROBE_SECRET: probeSecret, ACHIEVE_SLACK_ALERTS_ENABLED: 'true',
      ACHIEVE_SLACK_CHANNEL_ID: 'C12345678', ACHIEVE_SLACK_BOT_TOKEN: 'xoxb-synthetic-runtime',
      ACHIEVE_WEEKLY_REPORT_SECRET: 'synthetic-report',
    },
  });
  const url = 'https://watchdog.test/check';
  assert.equal((await runtime.dispatchFetch(url, { method: 'POST' })).status, 404);
  const auth = { method: 'POST', headers: { Authorization: `Bearer ${probeSecret}` } };
  const monitor = network.get('https://miikotqnovnixpeqtqnd.supabase.co');
  const monitorRequest = { path: '/functions/v1/achieve-weekly-report', method: 'POST' };
  monitor.intercept(monitorRequest).reply(200, JSON.stringify({ ok: true, mode: 'monitor' }));
  let response = await runtime.dispatchFetch(url, auth);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'healthy' });
  for (const status of [503, 302]) {
    monitor.intercept(monitorRequest).reply(status, 'private-body-not-for-Slack', {
      headers: { Location: 'https://never-follow.test/' },
    });
    let posted = false;
    network.get('https://slack.com').intercept({ path: '/api/chat.postMessage', method: 'POST' })
      .reply(() => {
        posted = true;
        return { statusCode: 200, data: JSON.stringify({ ok: true, channel: 'C12345678' }) };
      });
    response = await runtime.dispatchFetch(url, auth);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'alerted' });
    assert(posted);
  }
  network.assertNoPendingInterceptors();
  console.log('watchdog workerd: auth, healthy probe, failed probe and redirect -> Slack alert passed; real network disabled');
} finally {
  await runtime?.dispose();
  rmSync(output, { recursive: true, force: true });
}
