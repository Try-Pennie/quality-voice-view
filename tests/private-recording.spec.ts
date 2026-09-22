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

test('failed private-media signing degrades only audio and recovers on alert and call details', async ({ page }) => {
  await reviewFixture(page, [alertRow('private-denied', { recording_link: reference })])
  await page.route('**/rest/v1/eavesly_transcription_qa*', route => route.fulfill({ json: {
    call_id: 'private-denied', recording_link: reference,
    original_transcript: 'Synthetic transcript survives signing failure.',
  } }))
  const messages: string[] = []
  page.on('console', message => messages.push(message.text()))
  let denied = true
  await page.route('**/storage/v1/object/sign/review-sample-recordings/*', route => denied
    ? route.fulfill({ status: 403, json: { message: 'PRIVATE_TOKEN_SENTINEL', error: 'Access denied' } })
    : route.fulfill({ json: { signedURL: '/object/sign/review-sample-recordings/example.mp3?token=recovered' } }))
  await page.route('**/storage/v1/object/sign/review-sample-recordings/example.mp3?token=recovered', route => route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.alloc(0) }))

  await page.goto('/dashboard/alerts/private-denied/full_qa')
  await expect(page.getByText('Recording unavailable. Call details and review evidence are still available.', { exact: true })).toBeVisible()
  await expect(page.getByRole('form', { name: 'Full QA rubric review' })).toBeVisible()
  await expect(page.locator('audio')).toHaveCount(0)
  denied = false
  await page.getByRole('button', { name: 'Retry recording', exact: true }).click()
  await expect(page.locator('audio')).toHaveAttribute('src', /token=recovered$/)

  denied = true
  await page.goto('/dashboard/calls/private-denied')
  await expect(page.getByText('Recording unavailable. Call details, QA, and transcript are still available.', { exact: true })).toBeVisible()
  await expect(page.getByText('Call detail', { exact: true })).toBeVisible()
  await expect(page.getByText('Synthetic transcript survives signing failure.', { exact: true })).toBeVisible()
  await expect(page.locator('audio')).toHaveCount(0)
  denied = false
  await page.getByRole('button', { name: 'Retry recording', exact: true }).click()
  await expect(page.locator('audio')).toHaveAttribute('src', /token=recovered$/)

  expect(messages.join('\n')).not.toContain('PRIVATE_TOKEN_SENTINEL')
})
