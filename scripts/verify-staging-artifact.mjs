// Run after `vite build --mode staging`, before deploying this artifact anywhere.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ref = 'xuvveqaizlletsqvwpgx';
const assets = readdirSync(`${root}/dist/assets`).filter((name) => name.endsWith('.js'))
  .map((name) => readFileSync(`${root}/dist/assets/${name}`, 'utf8')).join('\n');
assert.ok(assets.includes(`https://${ref}.supabase.co`), 'Missing isolated staging endpoint');
assert.ok(assets.includes('Preview password'), 'Missing native staging login');
assert.ok(!assets.includes('miikotqnovnixpeqtqnd'), 'Production endpoint leaked into staging');
assert.ok(!assets.includes('Continue with Google'), 'Production login leaked into staging');
const csp = `default-src 'self'; connect-src 'self' https://${ref}.supabase.co wss://${ref}.supabase.co; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src https://${ref}.supabase.co; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'`;
writeFileSync(`${root}/dist/_headers`, `${readFileSync(`${root}/public/_headers`, 'utf8')}\n/*\n  Content-Security-Policy: ${csp}\n  X-Robots-Tag: noindex, nofollow\n  Referrer-Policy: no-referrer\n  Cache-Control: no-store\n`);
writeFileSync(`${root}/dist/robots.txt`, 'User-agent: *\nDisallow: /\n');
console.log('PASS: isolated staging artifact verified; restrictive media/network CSP and privacy headers attached');
