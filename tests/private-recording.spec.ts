import { test, expect } from '@playwright/test'
import { alertRow, reviewFixture } from './review-fixture'

const reference = `storage://review-sample-recordings/${'a'.repeat(32)}.mp3`

for (const view of ['alerts', 'calls']) test(`${view} signs a private recording on open using the current session`, async ({ page }) => {
  await reviewFixture(page, [alertRow('private-recording', { recording_link: reference })])
  await page.route('**/rest/v1/eavesly_transcription_qa*', route => route.fulfill({ json: {
    call_id: 'private-recording', recording_link: reference,
  } }))
  let signatures = 0
  await page.route('**/storage/v1/object/sign/review-sample-recordings/*', route => {
    expect(route.request().method()).toBe('POST')
    expect(route.request().headers().authorization).toMatch(/^Bearer /)
    expect(route.request().postDataJSON()).toEqual({ expiresIn: 10800 })
    signatures++
    return route.fulfill({ json: { signedURL: '/object/sign/review-sample-recordings/example.mp3?token=synthetic' } })
  })
  await page.route('**/storage/v1/object/sign/review-sample-recordings/example.mp3?token=synthetic', route => route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.alloc(0) }))
  await page.goto(`/dashboard/${view}/private-recording${view === 'alerts' ? '/full_qa' : ''}`)
  const audio = page.locator('audio')
  await expect(audio).toHaveCount(1)
  await expect(audio).toHaveAttribute('src', /\/storage\/v1\/object\/sign\/review-sample-recordings\/example\.mp3\?token=synthetic$/)
  const link = page.getByRole('region', { name: 'Call recording', exact: true }).getByRole('link', { name: 'Open recording' })
  if (view === 'alerts') await expect(link).toHaveAttribute('href', await audio.getAttribute('src'))
  expect(signatures).toBeGreaterThan(0)
  expect(await audio.evaluate(element => element.paused)).toBe(true)
})

test('private recording authorization failures never fall back to public media or log SDK details', async ({ page }) => {
  await reviewFixture(page, [alertRow('private-denied', { recording_link: reference })])
  const messages: string[] = []
  page.on('console', message => messages.push(message.text()))
  await page.route('**/storage/v1/object/sign/review-sample-recordings/*', route => route.fulfill({
    status: 403, json: { message: 'PRIVATE_TOKEN_SENTINEL', error: 'Access denied' },
  }))
  await page.goto('/dashboard/alerts/private-denied/full_qa')
  await expect(page.getByRole('button', { name: 'Retry recording', exact: true })).toBeVisible()
  await expect(page.getByText("Couldn't load the recording and call details. Your review stays here.", { exact: true })).toBeVisible()
  await expect(page.locator('audio')).toHaveCount(0)
  expect(messages.join('\n')).not.toContain('PRIVATE_TOKEN_SENTINEL')
})
