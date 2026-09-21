#!/usr/bin/env node
// Intentionally no project/branch override: this command cannot target production.
import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
function capture(command, args) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} failed; staging deployment stopped`);
  return result.stdout.trim();
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed; staging deployment stopped`);
}

try {
  if (process.argv.length !== 2) throw new Error('Staging deployment accepts no destination overrides');
  const branch = capture('git', ['branch', '--show-current']);
  if (!branch || branch === 'main' || branch === 'master') throw new Error('Use a named review branch, never main or a detached checkout');
  if (capture('git', ['status', '--porcelain'])) throw new Error('Commit all source changes before deploying a pinned staging artifact');
  const commit = capture('git', ['rev-parse', 'HEAD']);
  if (lstatSync(`${cwd}/node_modules`, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Use an isolated dependency directory; do not replace another worktree’s shared node_modules');
  run('npm', ['ci']);
  run('npm', ['run', 'build:staging']);
  run('cfp', ['wrangler', 'pennie', '--', 'pages', 'deploy', 'dist', '--project-name=eavesly', '--branch=rubric-staging', `--commit-hash=${commit}`]);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Staging deployment failed');
  process.exitCode = 1;
}
