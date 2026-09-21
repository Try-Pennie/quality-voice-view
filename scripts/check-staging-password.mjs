// Native hosted Auth/browser check. Supply a private JSON file; never a password argv/env value.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { chromium, expect } from '@playwright/test'

process.umask(0o077)
let browser
let step = 'read private configuration'
try {
  const config = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const origin = new URL(config.origin).origin
  assert.match(origin, /^https:\/\/[a-z0-9-]+\.eavesly\.pages\.dev$/)
  assert.equal(config.ref, 'xuvveqaizlletsqvwpgx')
  assert.equal(typeof config.password, 'string')
  assert(config.password.length >= 32)
  assert.match(config.output, /^\/root\/\.private\//)
  mkdirSync(config.output, { recursive: true, mode: 0o700 })
  const api = `https://${config.ref}.supabase.co`
  const errors = []
  let logins = 0
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (![origin, api].includes(url.origin)) { errors.push('unexpected origin'); return route.abort() }
    if (request.url().includes(config.password)) { errors.push('password in URL'); return route.abort() }
    if (request.postData()?.includes(config.password) && !(url.origin === api && url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password')) {
      errors.push('password outside native Auth'); return route.abort()
    }
    return route.continue()
  })
  const page = await context.newPage()
  page.on('pageerror', () => errors.push('page error'))
  page.on('response', response => {
    const url = new URL(response.url())
    const expectedDenial = url.pathname === '/auth/v1/token' && response.status() === 400
    if (response.status() >= 400 && !expectedDenial) errors.push(`unexpected HTTP ${response.status()}`)
  })
  step = 'login screen'
  await page.goto(`${origin}/login`)
  await expect(page.getByRole('form', { name: 'Staging sign in' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open preview', exact: true })).toBeDisabled()
  await expect(page.getByText('Continue with Google')).toHaveCount(0)
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    for (const control of [page.getByLabel('View to test'), page.getByLabel('Preview password'), page.getByRole('button', { name: 'Open preview', exact: true })]) {
      await expect(control).toBeInViewport()
      assert((await control.boundingBox()).height >= 44)
    }
    await page.screenshot({ path: `${config.output}/login-${width}.png` })
  }
  step = 'wrong password'
  await page.getByLabel('Preview password').fill('deliberately-wrong-synthetic-password')
  await page.getByLabel('Preview password').press('Enter')
  await expect(page.getByRole('alert')).toHaveText('That password was not recognized. Please try again.')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  for (const role of ['manager', 'kris', 'manager']) {
    step = `${role} password login ${logins + 1}`
    await page.getByLabel('View to test').selectOption(role)
    await page.getByLabel('Preview password').fill(config.password)
    await page.getByLabel('Preview password').press('Enter')
    const call = role === 'kris' ? 'DEMO-APPROVAL-001' : 'REAL-REVIEW-021'
    await page.waitForURL(url => url.pathname === `/dashboard/alerts/${call}/full_qa`, { timeout: 30000 })
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30000 })
    await expect(page.getByRole('heading', { name: 'Why Eavesly requested review', exact: true })).toBeVisible({ timeout: 30000 })
    await expect(page.getByText('Loading recording…', { exact: true })).toHaveCount(0)
    const email = await page.evaluate(ref => JSON.parse(localStorage.getItem(`sb-${ref}-auth-token`)).user.email, config.ref)
    assert.equal(email, `eavesly-staging-${role}-xuvveqaiz@trypennie.com`)
    if (role === 'kris') {
      await expect(page.getByRole('button', { name: 'Approve review', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Save review', exact: true })).toHaveCount(0)
    } else {
      await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Approve review', exact: true })).toHaveCount(0)
      const audio = page.locator('audio')
      await expect(audio).toHaveCount(1)
      await page.getByRole('region', { name: 'Call recording', exact: true }).getByRole('button', { name: 'Play', exact: true }).click()
      await expect.poll(() => audio.evaluate(element => element.currentTime), { timeout: 20000 }).toBeGreaterThan(0.1)
      await page.getByRole('region', { name: 'Call recording', exact: true }).getByRole('button', { name: 'Pause', exact: true }).click()
    }
    assert.equal(await page.evaluate(password => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes(password)), config.password), false)
    assert.equal(new URL(page.url()).hash, '')
    await page.screenshot({ path: `${config.output}/${role}-${logins + 1}.png` })
    logins++
    await page.getByRole('button', { name: 'Close (Esc)', exact: true }).click()
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page.getByRole('form', { name: 'Staging sign in' })).toBeVisible({ timeout: 15000 })
  }
  step = 'fresh browser login'
  const fresh = await browser.newContext()
  const freshPage = await fresh.newPage()
  await freshPage.goto(`${origin}/login`)
  await freshPage.getByLabel('View to test').selectOption('kris')
  await freshPage.getByLabel('Preview password').fill(config.password)
  await freshPage.getByRole('button', { name: 'Open preview', exact: true }).click()
  await expect(freshPage.getByRole('button', { name: 'Approve review', exact: true })).toBeVisible({ timeout: 30000 })
  await expect(freshPage.getByRole('heading', { name: 'Why Eavesly requested review', exact: true })).toBeVisible({ timeout: 30000 })
  logins++
  assert.deepEqual(errors, [])
  const report = { native_password_logins: logins, wrong_password: 'denied', roles_and_switching: 'passed', playback: 'passed', errors: 0 }
  writeFileSync(`${config.output}/verification.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} catch {
  // Playwright/JSON diagnostics may contain input values. Print only our categorical step.
  console.error(`Staging password check failed at: ${step}`)
  process.exitCode = 1
} finally {
  await browser?.close()
}
