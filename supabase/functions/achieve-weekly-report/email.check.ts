// Self-check for the weekly Gmail MIME projection.
// Run: npx tsx supabase/functions/achieve-weekly-report/email.check.ts
import assert from 'node:assert/strict'
import type { AchieveManagementReport } from '../_shared/achieve-management-report'
import { buildAchieveWeeklyEmail } from './email'

const representative = {
  agentName: '<Representative & One>',
  agentEmail: 'rep-one@example.test',
  totalSubmissions: 4,
  good: 1,
  fair: 1,
  poor: 2,
  other: 0,
  fairPoorRate: 75,
  adjustedFormRisk: 60,
  riskRank: 1,
  accent: 1,
  backgroundNoise: 2,
  connectionIssues: 0,
  latestSubmittedAt: '2026-08-15T12:00:00Z',
  aiTotal: 5,
  aiPass: 3,
  aiFlagged: 2,
  latestAiGradedAt: '2026-08-15T12:00:00Z',
  overlapCalls: 3,
  bothClear: 1,
  bothConcern: 1,
  humanOnly: 1,
  aiOnly: 0,
  terminatedAt: '2026-08-16T04:00:00Z',
}
const emergingRepresentative = {
  ...representative,
  agentName: 'Emerging Representative',
  agentEmail: 'emerging@example.test',
  riskRank: 2,
  terminatedAt: null,
}
const report: AchieveManagementReport = {
  generatedAt: '2026-08-17T13:00:00.000Z',
  completedThrough: '2026-08-17T04:00:00.000Z',
  persistentAgentEmails: [representative.agentEmail],
  terminations: [{
    agentName: representative.agentName,
    agentEmail: representative.agentEmail,
    terminatedAt: representative.terminatedAt,
    postTerminationFormSubmissions: 2,
    latestPostTerminationFormAt: '2026-08-17T12:00:00Z',
    postTerminationAiCalls: 1,
    latestPostTerminationAiAt: '2026-08-17T11:00:00Z',
  }],
  periods: ([2, 4, 6] as const).map(weeks => ({
    weeks,
    startAt: '2026-07-06T04:00:00.000Z',
    endAt: '2026-08-17T04:00:00.000Z',
    dashboard: {},
    representatives: weeks === 2
      ? [{ ...representative, riskRank: 1 }, emergingRepresentative]
      : [{ ...representative, riskRank: weeks / 2 }],
  })),
}

const previousRepresentative = {
  ...representative,
  agentName: 'Removed Representative',
  agentEmail: 'removed@example.test',
  terminatedAt: null,
}
const previousReport: AchieveManagementReport = {
  ...report,
  completedThrough: '2026-08-10T04:00:00.000Z',
  persistentAgentEmails: [previousRepresentative.agentEmail],
  terminations: [],
  periods: report.periods.map(period => ({
    ...period,
    representatives: [{ ...previousRepresentative, riskRank: period.weeks / 2 }],
  })),
}

const email = buildAchieveWeeklyEmail(
  report,
  previousReport,
  'reports@example.test',
  ['leader-one@example.test', 'leader-two@example.test'],
  ['observer@example.test'],
  'https://eavesly.example.test/achieve',
)
assert.strictEqual(email.attachmentFilename, 'achieve-management-2026-08-16.csv')
assert.ok(email.subject.endsWith('2026-08-16'))
const padded = email.raw.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - email.raw.length % 4) % 4)
const decoded = new TextDecoder().decode(Uint8Array.from(atob(padded), character => character.charCodeAt(0)))
const htmlPayload = decoded.match(
  /Content-Type: text\/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--achieve_alt_/,
)?.[1]
assert.ok(htmlPayload)
const decodedHtml = new TextDecoder().decode(Uint8Array.from(
  atob(htmlPayload.replaceAll(/\s/g, '')),
  character => character.charCodeAt(0),
))
assert.ok(decoded.includes('To: leader-one@example.test, leader-two@example.test'))
assert.ok(decoded.includes('Cc: observer@example.test'))
assert.ok(decoded.includes('Content-Type: text/csv'))
assert.ok(decoded.split('\r\n').every(line => new TextEncoder().encode(line).length <= 998))
assert.ok(decodedHtml.includes('&lt;Representative &amp; One&gt;'))
assert.ok(!decodedHtml.includes('<Representative & One>'))
assert.ok(decodedHtml.includes('WC Agent Summary by representative'))
assert.ok(decodedHtml.includes('width="680"'))
assert.ok(decodedHtml.includes('role="presentation"'))
assert.ok(!decodedHtml.includes('min-width:1420px'))
assert.ok(!decodedHtml.includes('overflow-x:auto'))
assert.ok(new TextEncoder().encode(decodedHtml).length < 102_400)
assert.ok(decodedHtml.includes('Termination follow-through · Activity detected'))
assert.ok(decodedHtml.includes('Forms after'))
assert.ok(decodedHtml.includes('AI calls after'))
assert.ok(decodedHtml.includes('Terminated · Aug 16, 2026'))
assert.ok(decodedHtml.includes('Bottom 5 — Last 2 Completed Weeks'))
assert.ok(decodedHtml.includes('Bottom 5 · 2w #1 · Also persistent'))
assert.ok(decodedHtml.includes('Bottom 5 · 2w #2'))
assert.ok(decodedHtml.includes('Emerging Representative'))
assert.ok(!decodedHtml.includes('Bottom 5 · 2w #2 · Also persistent'))
assert.ok(decodedHtml.includes('Reported conditions'))
assert.ok(decodedHtml.includes('Noise 2 · Accent 1 · Connection 0'))
assert.ok(decodedHtml.includes('2w #1 · 4w #2 · 6w #3'))
assert.ok(decodedHtml.includes('Both concern'))
assert.ok(decodedHtml.includes('New since last Monday (1)'))
assert.ok(decodedHtml.includes('&lt;Representative &amp; One&gt;'))
assert.ok(decodedHtml.includes('Removed since last Monday (1)'))
assert.ok(decodedHtml.includes('Removed Representative'))

console.log('achieve-weekly-email: all checks passed')
