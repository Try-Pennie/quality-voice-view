import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = mkdtempSync(path.join(tmpdir(), 'staging-deploy-check-'));
try {
  const log = path.join(directory, 'commands.jsonl');
  for (const command of ['git', 'npm', 'cfp']) {
    writeFileSync(path.join(directory, command), `#!${process.execPath}
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.TEST_COMMAND_LOG, JSON.stringify({ command: '${command}', args: process.argv.slice(2) })+'\\n');
if ('${command}' === 'git') {
  if (process.argv[2] === 'branch') console.log(process.env.TEST_BRANCH);
  if (process.argv[2] === 'status') console.log(process.env.TEST_DIRTY || '');
  if (process.argv[2] === 'rev-parse') console.log('a'.repeat(40));
}
if ('${command}' === 'npm' && process.env.TEST_FAIL_BUILD) process.exit(1);
`, { mode: 0o700 });
  }
  const run = (overrides = {}, args = []) => {
    writeFileSync(log, '');
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./deploy-staging.mjs', import.meta.url)), ...args], {
      encoding: 'utf8', env: { ...process.env, PATH: directory, TEST_COMMAND_LOG: log, TEST_BRANCH: 'review/audit-fixes', ...overrides },
    });
    return { result, commands: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((row) => JSON.parse(row)) };
  };
  for (const branch of ['main', 'master', '']) {
    const { result, commands } = run({ TEST_BRANCH: branch });
    assert.notEqual(result.status, 0);
    assert.ok(commands.every((entry) => entry.command === 'git'));
  }
  for (const overrides of [{ TEST_DIRTY: ' M src/App.tsx' }, { TEST_FAIL_BUILD: '1' }]) {
    const { result, commands } = run(overrides);
    assert.notEqual(result.status, 0);
    assert.ok(commands.every((entry) => entry.command !== 'cfp'));
  }
  const rejected = run({}, ['--branch=main']);
  assert.notEqual(rejected.result.status, 0);
  assert.deepEqual(rejected.commands, []);
  const success = run();
  assert.equal(success.result.status, 0, success.result.stderr);
  assert.deepEqual(success.commands.slice(-2), [
    { command: 'npm', args: ['run', 'build:staging'] },
    { command: 'cfp', args: ['wrangler', 'pennie', '--', 'pages', 'deploy', 'dist', '--project-name=eavesly', '--branch=rubric-staging', `--commit-hash=${'a'.repeat(40)}`] },
  ]);
  console.log('PASS: staging deploy refuses main/detached/dirty/override/build failures and always builds before the fixed staging destination');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
