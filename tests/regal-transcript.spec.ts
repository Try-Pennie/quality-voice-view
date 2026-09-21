import { test, expect } from '@playwright/test'
import { alertRow, reviewFixture, TRANSCRIPT } from './review-fixture'

const REGAL_URL = 'https://app.regalvoice.com/transcripts/synthetic-task/synthetic-recording/+15555550100'

for (const surface of ['review', 'standalone review', 'call detail', 'disposition audit'] as const) {
  for (const hasTranscript of [true, false]) {
    test(`${surface}: Regal transcript button ${hasTranscript ? 'opens the saved URL' : 'is absent without a URL'}`, async ({ page, context }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      const transcriptUrl = hasTranscript ? REGAL_URL : null
      const row = alertRow('regal', { transcript_url: transcriptUrl,
        ...(surface === 'standalone review' ? { module_name: 'warm_transfer', violation_type: 'warm_transfer' } : {}),
      })
      const state = await reviewFixture(page, [row])
      await page.route('**/rest/v1/eavesly_transcription_qa?*', route => route.fulfill({ json: {
        original_transcript: TRANSCRIPT, recording_link: null, transcription_link: transcriptUrl,
      } }))
      await page.route('**/rest/v1/eavesly_disposition_audit?*', route => {
        const detail = { ...row, module_name: 'disposition_review', audit_category: 'ended_live_lead',
          current_disposition: 'Not Interested', suggested_disposition: 'Follow Up', talk_time: 180,
          model_conversation_happened: 'yes', model_confidence: 0.9 }
        const isDetail = new URL(route.request().url()).searchParams.get('select') === '*'
        return route.fulfill({ json: isDetail ? detail : [{ ...detail, result_json: undefined, transcript_url: undefined, model_confidence: null }] })
      })

      if (surface === 'review' || surface === 'standalone review') {
        await page.goto('/dashboard/alerts')
        await page.getByRole('button', { name: /Review .* alert for Example regal/ }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
        await expect(page.getByRole('region', { name: 'Call recording', exact: true })).toContainText('Recording not available')
      } else if (surface === 'call detail') {
        await page.goto('/dashboard/calls/regal')
        await expect(page.getByText('Recording not available', { exact: true })).toBeVisible()
      } else {
        await page.goto('/dashboard/disposition-audit')
        await page.getByRole('button', { name: /Example regal/ }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
        await expect(page.getByRole('dialog')).toContainText('confidence 90%')
      }

      const link = page.getByRole('link', { name: 'View Regal transcript (opens in a new tab)' })
      if (hasTranscript) {
        await expect(link).toBeVisible()
        await expect(link).toHaveAttribute('href', REGAL_URL)
        await expect(link).toHaveAttribute('target', '_blank')
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
        await expect(link).toBeInViewport()
        const bounds = await link.boundingBox()
        expect(bounds?.height).toBeGreaterThanOrEqual(44)
        expect((bounds?.x ?? -1)).toBeGreaterThanOrEqual(0)
        expect((bounds?.x ?? 390) + (bounds?.width ?? 1)).toBeLessThanOrEqual(390)
        await link.focus()
        await expect(link).toBeFocused()
        await page.screenshot({ path: testInfo.outputPath('regal-transcript-mobile.png') })
        // Synthetic destination: no Regal auth or customer data is used.
        await context.route(REGAL_URL, route => route.fulfill({ contentType: 'text/html', body: '<h1>Synthetic Regal transcript</h1>' }))
        const popupPromise = page.waitForEvent('popup')
        await link.press('Enter')
        const popup = await popupPromise
        await expect(popup).toHaveURL(REGAL_URL)
        await expect(popup.getByRole('heading')).toHaveText('Synthetic Regal transcript')
        await popup.close()
        await expect(link).toBeVisible()
        await page.setViewportSize({ width: 1440, height: 1000 })
        await expect(link).toBeInViewport()
        await page.screenshot({ path: testInfo.outputPath('regal-transcript-desktop.png') })
      } else {
        await expect(link).toHaveCount(0)
      }
      expect(state.writes).toEqual([])
      expect(errors).toEqual([])
    })
  }
}
