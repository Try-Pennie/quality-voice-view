import { expect, test, type Locator } from '@playwright/test'
import { alertRow, openAlert, reviewFixture } from './review-fixture'

function deferred() {
  let release = () => {}
  const promise = new Promise<void>(resolve => {
    release = resolve
  })
  return { promise, release }
}

function contrastRatio(locator: Locator): Promise<number> {
  return locator.evaluate(element => {
    const parseRgb = (value: string) =>
      value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) ?? []
    const luminance = (value: string) => {
      const [red = 0, green = 0, blue = 0] = parseRgb(value)
      const linear = [red, green, blue].map(channel => {
        const normalized = channel / 255
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    }
    const style = getComputedStyle(element)
    const foreground = luminance(style.color)
    const background = luminance(style.backgroundColor)
    return (Math.max(foreground, background) + 0.05)
      / (Math.min(foreground, background) + 0.05)
  })
}

test('route loading keeps dashboard navigation usable', async ({ page }) => {
  await reviewFixture(page, [])
  await page.goto('/dashboard?start=2026-08-09&end=2026-09-07')

  const helpChunk = deferred()
  await page.route(url => /\/(?:src\/pages\/HelpPage\.tsx|assets\/HelpPage-[^/]+\.js)$/.test(url.pathname), async route => {
    await helpChunk.promise
    await route.continue()
  })

  await page.getByRole('link', { name: 'Open glossary' }).click()
  await expect(page.getByRole('status', { name: 'Loading page' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Eavesly' })).toBeVisible()

  helpChunk.release()
  await expect(page.getByRole('heading', { name: 'What everything means' })).toBeVisible()
})

test('same-route query updates preserve the active page and focus', async ({ page }) => {
  await reviewFixture(page, [])
  await page.goto('/dashboard?start=2026-08-09&end=2026-09-07')

  const filter = page.getByRole('button', {
    name: 'Compliance failures',
    exact: true,
  })
  await filter.click()

  await expect(page).toHaveURL(/qf=compliance/)
  await expect(filter).toBeFocused()
})

test('a failed route chunk offers an explicit reload without hiding navigation', async ({ page }) => {
  await reviewFixture(page, [])
  await page.goto('/dashboard?start=2026-08-09&end=2026-09-07')
  await page.route(url => /\/(?:src\/pages\/TeamPage\.tsx|assets\/TeamPage-[^/]+\.js)$/.test(url.pathname), route => route.abort(), {
    times: 1,
  })

  await page.getByRole('link', { name: 'Team', exact: true }).click()
  await expect(page.getByRole('heading', { name: "This page couldn't open" })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Eavesly' })).toBeVisible()

  await page.getByRole('link', { name: 'Calls', exact: true }).click()
  await expect(page.getByText('No calls match your filters.', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Team', exact: true }).click()
  await expect(page.getByRole('heading', { name: "This page couldn't open" })).toBeVisible()
  await page.getByRole('button', { name: 'Reload page' }).click()
  await expect(page.getByRole('heading', { name: 'Alerts by representative', exact: true })).toBeVisible()
})

test('public routes stay public and dashboard routes stay protected', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()

  await page.goto('/achieve')
  await expect(page).toHaveURL(/\/achieve$/)
  await expect(page.getByRole('heading', { name: 'Achieve welcome-call review' })).toBeVisible()

  await reviewFixture(page, [])
  await page.goto('/dashboard?start=2026-08-09&end=2026-09-07')
  await expect(page.getByRole('link', { name: 'Calls', exact: true })).toHaveAttribute('aria-current', 'page')
})

test('pages render immediately while control and reduced-motion behavior remain useful', async ({ page }) => {
  await page.goto('/login')
  const panel = page.locator('main > div')
  const signIn = page.getByRole('button', { name: 'Continue with Google' })

  expect(await panel.evaluate(element => getComputedStyle(element).animationName)).toBe('none')
  expect(await signIn.evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).toBeGreaterThan(0)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await signIn.evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(0.00001)
})

test('green and yellow status badges meet normal-text AA contrast', async ({ page }) => {
  await reviewFixture(page, [])
  await page.route('**/rest/v1/rpc/eavesly_*', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop()
    if (name === 'eavesly_calls_page') {
      return route.fulfill({
        json: {
          has_more: false,
          rows: ['good', 'fair'].map((score, index) => ({
            id: index + 1,
            call_id: `contrast-${index}`,
            started_at: '2026-09-04T16:00:00Z',
            agent_email: 'agent@example.test',
            agent_full_name: 'Agent Contrast',
            contact_phone: null,
            talk_time: 300,
            handle_time: null,
            disposition: 'Cal.com Meeting',
            campaign_name: null,
            qa: {
              call_id: `contrast-${index}`,
              overall_score: score,
              compliance_rating: 'pass',
              customer_satisfaction_likely: 'high',
              manager_escalation: false,
            },
          })),
        },
      })
    }
    if (name === 'eavesly_calls_summary') {
      return route.fulfill({
        json: {
          total_calls: 2,
          window_calls: 2,
          calls_requiring_attention: 0,
          avg_talk_time: 300,
          avg_handle_time: 0,
          compliance_pass_rate: 100,
          high_sat_rate: 100,
          dispositions: ['Cal.com Meeting'],
        },
      })
    }
    return route.fulfill({ json: [] })
  })
  await page.goto('/dashboard?start=2026-08-09&end=2026-09-07')

  for (const label of ['fair', 'pass']) {
    const ratio = await page.locator('.pennie-pill', { hasText: label }).first().evaluate(element => {
      const parseRgb = (value: string) => value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) ?? []
      const luminance = (value: string) => {
        const [red = 0, green = 0, blue = 0] = parseRgb(value)
        const linear = [red, green, blue].map(channel => {
          const normalized = channel / 255
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
      }
      const style = getComputedStyle(element)
      const foreground = luminance(style.color)
      const background = luminance(style.backgroundColor)
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
    })
    expect(ratio, label).toBeGreaterThanOrEqual(4.5)
  }
})

test('the licensed Inter fallback is served locally and usable', async ({ page }) => {
  const fontResponse = page.waitForResponse(response =>
    response.url().endsWith('/fonts/InterVariable.woff2'),
  )
  await page.goto('/login')

  expect((await fontResponse).status()).toBe(200)
  expect(await page.evaluate(async () => {
    await document.fonts.load('500 16px Inter')
    return document.fonts.check('500 16px Inter')
  })).toBe(true)
})

test('legacy call-detail score badges retain meaning with AA text contrast', async ({ page }) => {
  await reviewFixture(page, [alertRow('detail')])
  await page.route('**/rest/v1/eavesly_transcription_qa*', route =>
    route.fulfill({
      json: {
        call_id: 'detail',
        overall_score: 'pass',
        compliance_rating: 'fair',
        customer_satisfaction_likely: 'high',
        original_transcript: 'Synthetic transcript.',
        recording_link: null,
      },
    }),
  )
  await page.goto('/dashboard/calls/detail')

  for (const label of ['pass', 'fair']) {
    const badge = page.locator('.pennie-pill', { hasText: label }).first()
    await expect(badge).toBeVisible()
    expect(await contrastRatio(badge), label).toBeGreaterThanOrEqual(4.5)
  }
})

test('review verdict badges use AA text contrast', async ({ page }) => {
  await reviewFixture(page, [
    alertRow('review-contrast', {
      module_name: 'budget_inputs',
      is_reviewed: true,
      accurate: true,
      feedback_id: 1,
      feedback_by: 'prior.manager@example.test',
      review_revision: 1,
    }),
  ])
  await page.goto('/dashboard/alerts?status=reviewed')
  await openAlert(page, 'review-contrast')

  const badge = page.getByRole('region', { name: 'Manager review' }).locator(
    '.rounded-full',
    { hasText: 'Warranted' },
  )
  await expect(badge).toBeVisible()
  expect(await contrastRatio(badge)).toBeGreaterThanOrEqual(4.5)
})
