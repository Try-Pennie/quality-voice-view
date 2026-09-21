import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const stagingRef = 'xuvveqaizlletsqvwpgx'
const stagingUrl = `https://${stagingRef}.supabase.co`
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const publicKey = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ ref: stagingRef, role: 'anon' })}.synthetic`

function build(url, key, mode = 'staging') {
  return spawnSync(process.execPath, [vite, 'build', '--mode', mode], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      VITE_STAGING_SUPABASE_URL: url,
      VITE_STAGING_SUPABASE_PUBLISHABLE_KEY: key,
    },
  })
}

function expectFailure(name, url, key, message) {
  const result = build(url, key)
  assert.notEqual(result.status, 0, `${name} unexpectedly built`)
  assert.match(`${result.stdout}${result.stderr}`, new RegExp(message))
}

// Check the normal build first; leave the final check output staging-only.
const production = build('', '', 'production')
assert.equal(production.status, 0, production.stderr || production.stdout)
const productionAssets = readdirSync(`${root}/dist/assets`).filter(file => file.endsWith('.js'))
  .map(file => readFileSync(`${root}/dist/assets/${file}`, 'utf8')).join('\n')
for (const marker of ['Preview password', 'View to test', 'eavesly-staging-manager-xuvveqaiz@trypennie.com', 'eavesly-staging-kris-xuvveqaiz@trypennie.com']) {
  assert.ok(!productionAssets.includes(marker), 'staging password UI leaked into normal build')
}
assert.ok(productionAssets.includes('Continue with Google'), 'normal Google login was changed')
const verifyArtifact = () => spawnSync(process.execPath, [`${root}/scripts/verify-staging-artifact.mjs`], { cwd: root, encoding: 'utf8' })
assert.notEqual(verifyArtifact().status, 0, 'production build must not pass staging artifact validation')

expectFailure('missing config', '', '', 'requires staging-only Supabase')
expectFailure('production URL', 'https://miikotqnovnixpeqtqnd.supabase.co', publicKey, 'must target xuvveqaizlletsqvwpgx')
expectFailure('privileged key', stagingUrl, 'sb_secret_synthetic_build_check', 'must not be privileged')

const success = build(stagingUrl, publicKey)
assert.equal(success.status, 0, success.stderr || success.stdout)

const productionClient = readFileSync(`${root}/src/integrations/supabase/client.ts`, 'utf8')
const productionUrl = productionClient.match(/SUPABASE_URL = "([^"]+)"/)?.[1]
const productionKey = productionClient.match(/SUPABASE_PUBLISHABLE_KEY = "([^"]+)"/)?.[1]
assert.ok(productionUrl && productionKey, 'could not read production client constants')

const assets = readdirSync(`${root}/dist/assets`)
  .filter(file => file.endsWith('.js'))
  .map(file => readFileSync(`${root}/dist/assets/${file}`, 'utf8'))
  .join('\n')

assert.ok(assets.includes(stagingUrl), 'staging URL was not embedded')
assert.ok(assets.includes(publicKey), 'synthetic public key was not embedded')
assert.ok(assets.includes('Restricted staging · Real call samples + synthetic examples · Reviews stay here · Integrations disabled'), 'staging banner was not embedded')
assert.ok(assets.includes('Preview password'), 'staging password form was not embedded')
assert.ok(!assets.includes('No sign-in starts from this page.'), 'obsolete no-login dead end remains')
assert.ok(!assets.includes('Continue with Google'), 'Google sign-in leaked into staging output')
assert.ok(!assets.includes(productionUrl), 'production URL leaked into staging output')
assert.ok(!assets.includes(productionKey), 'production key leaked into staging output')

const verified = verifyArtifact()
assert.equal(verified.status, 0, verified.stderr || verified.stdout)
const headers = readFileSync(`${root}/dist/_headers`, 'utf8')
assert.ok(headers.includes(`connect-src 'self' ${stagingUrl} wss://${stagingRef}.supabase.co`))
assert.ok(headers.includes(`media-src ${stagingUrl}`))
assert.ok(headers.includes('X-Robots-Tag: noindex, nofollow'))
assert.ok(headers.includes('Cache-Control: no-store'))
assert.ok(!headers.includes('miikotqnovnixpeqtqnd'))
assert.equal(readFileSync(`${root}/dist/robots.txt`, 'utf8'), 'User-agent: *\nDisallow: /\n')
console.log('staging build seam rejects unsafe config and contains only the staging Supabase endpoint, with restricted artifact headers')
