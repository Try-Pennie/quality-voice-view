// Behavior check for the email-safe Gmail MIME projection.
// Run: npx tsx supabase/functions/achieve-weekly-report/email.check.ts
import assert from 'node:assert/strict'
import type { AchieveManagementReport, AchieveManagementRepresentative } from '../_shared/achieve-management-report'
import { achieveWeeklyEmailEnvelope, buildAchieveWeeklyEmail } from './email'

function representative(
  agentName: string,
  agentEmail: string,
  fair: number,
  poor: number,
): AchieveManagementRepresentative {
  return {
    agentName,
    agentEmail,
    totalSubmissions: 6,
    good: 6 - fair - poor,
    fair,
    poor,
    other: 0,
    fairPoorRate: ((fair + poor) / 6) * 100,
    adjustedFormRisk: ((fair + poor) / 6) * 100,
    riskRank: 1,
    accent: 2,
    backgroundNoise: 1,
    connectionIssues: 1,
    latestSubmittedAt: '2026-08-15T12:00:00Z',
    aiTotal: 8,
    aiPass: 5,
    aiFlagged: 3,
    latestAiGradedAt: '2026-08-15T12:00:00Z',
    overlapCalls: 0,
    bothClear: 0,
    bothConcern: 0,
    humanOnly: 0,
    aiOnly: 0,
    terminatedAt: null,
  }
}

const persistent = representative('<High Risk & Agent>', 'persistent@example.test', 2, 2)
const twoWeekPersistent = {
  ...persistent,
  totalSubmissions: 3,
  good: 1,
  fair: 2,
  poor: 0,
  fairPoorRate: 200 / 3,
  adjustedFormRisk: 200 / 3,
}
const bottom = representative('Bottom Agent', 'bottom@example.test', 3, 2)
const activity = { ...representative('Intelligibility Agent', 'activity@example.test', 0, 1), accent: 4 }
const report: AchieveManagementReport = {
  generatedAt: '2026-08-27T13:00:00.000Z',
  completedThrough: '2026-08-24T04:00:00.000Z',
  highRiskAgentEmails: [persistent.agentEmail, bottom.agentEmail],
  bottomTenNegativeReviewAgentEmails: [bottom.agentEmail, persistent.agentEmail],
  bottomTenIntelligibilityAgentEmails: [activity.agentEmail, persistent.agentEmail],
  bottomTenFirstPayAgentEmails: [persistent.agentEmail, bottom.agentEmail, activity.agentEmail],
  allTimeReviews: 459,
  allTimeNegativeReviews: 97,
  reviewTrends: ([2, 4, 6] as const).map((weeks, index) => ({
    weeks,
    startAt: ['2026-08-10T04:00:00Z', '2026-07-27T04:00:00Z', '2026-07-13T04:00:00Z'][index] ?? '',
    endAt: '2026-08-24T04:00:00Z',
    reviews: [133, 300, 459][index] ?? 0,
    negativeReviews: [32, 50, 97][index] ?? 0,
    previousStartAt: ['2026-07-27T04:00:00Z', '2026-06-29T04:00:00Z', '2026-06-01T04:00:00Z'][index] ?? '',
    previousEndAt: ['2026-08-10T04:00:00Z', '2026-07-27T04:00:00Z', '2026-07-13T04:00:00Z'][index] ?? '',
    previousReviews: index === 2 ? 0 : 100,
    previousNegativeReviews: index === 0 ? 18 : index === 1 ? 47 : 0,
  })),
  terminations: [{
    agentName: 'Terminated Agent',
    agentEmail: 'terminated@example.test',
    terminatedAt: '2026-08-24T04:00:00Z',
    activitySourceAsOf: '2026-08-27',
    latestPostTermEnrollmentOn: '2026-08-26',
    enrollmentsPostTermination: 1,
  }],
  periods: ([2, 4, 6] as const).map(weeks => ({
    weeks,
    startAt: '2026-07-13T04:00:00Z',
    endAt: '2026-08-24T04:00:00Z',
    dashboard: {},
    representatives: [weeks === 2 ? twoWeekPersistent : persistent, bottom, activity],
  })),
  outcomes: {
    sourceAsOf: '2026-08-27',
    refreshedAt: '2026-08-27T12:00:00Z',
    maturityCutoff: '2026-08-17',
    periods: (['all_time', 'mature_2_weeks', 'mature_4_weeks', 'mature_6_weeks', 'mature_6_months'] as const).map((key, index) => ({
      key,
      startDate: key === 'all_time' ? null : ['2026-08-04', '2026-07-21', '2026-07-07', '2026-02-18'][index - 1] ?? null,
      endDate: '2026-08-17',
      n: [12947, 659, 1335, 1730, 7430][index] ?? 0,
      paid: [10007, 501, 1036, 1346, 5770][index] ?? 0,
      previousStartDate: key === 'all_time' ? null : ['2026-07-21', '2026-06-23', '2026-05-26', '2025-08-18'][index - 1] ?? null,
      previousEndDate: key === 'all_time' ? null : ['2026-08-03', '2026-07-20', '2026-07-06', '2026-02-17'][index - 1] ?? null,
      previousN: key === 'all_time' ? null : index === 3 ? 0 : 100,
      previousPaid: key === 'all_time' ? null : index === 1 ? 79 : index === 2 ? 80 : 0,
      agents: [
        ...[persistent, bottom, activity].map((agent, rank) => ({
          agentName: agent.agentName,
          agentEmail: agent.agentEmail,
          n: 20 + rank,
          failures: 8 - rank,
          failureRate: ((8 - rank) / (20 + rank)) * 100,
          expectedFailures: 5,
          expectedSuccesses: 15 + rank,
          expectedRate: 25,
          deltaPp: 15,
          z: rank === 0 ? 2.5 : rank === 1 ? -0.94 : 1.2,
          rescinded: 3,
          neverPaid: 5 - rank,
          sampleQualified: rank !== 2,
          rank: rank === 2 ? null : rank + 1,
        })),
        ...(key === 'mature_6_months' ? [{
          agentName: 'Tiny Sample', agentEmail: 'tiny@example.test', n: 9, failures: 8,
          failureRate: 800 / 9, expectedFailures: 5, expectedSuccesses: 4, expectedRate: 25,
          deltaPp: 50, z: 99, rescinded: 3, neverPaid: 5, sampleQualified: false, rank: null,
        }] : []),
      ],
    })),
  },
}

assert.deepEqual(
  achieveWeeklyEmailEnvelope(true, ['achieve@example.test'], ['observer@example.test'], 'noah@example.test'),
  { recipients: ['noah@example.test'], ccRecipients: [] },
)
assert.deepEqual(
  achieveWeeklyEmailEnvelope(false, ['achieve@example.test'], ['observer@example.test'], 'noah@example.test'),
  { recipients: ['achieve@example.test'], ccRecipients: ['observer@example.test'] },
)

const email = buildAchieveWeeklyEmail(
  report,
  'reports@example.test',
  ['leader-one@example.test'],
  ['observer@example.test'],
  'https://eavesly.example.test/achieve',
  {
    sourceAsOf: '2026-08-27',
    csv: 'AFF Number,Enrollment Date,Termination Date,Client Deposit Flag,Termination Before First Pay Flag,Original Scheduled First Pay Date,WC Agent Email,Agent Rating,AI Flag\r\n',
  },
)
assert.strictEqual(email.attachmentFilename, 'achieve-management-2026-08-23.csv')
assert.strictEqual(email.outcomeAttachmentFilename, 'achieve-first-pay-outcomes-2026-08-23.csv')
assert.strictEqual(email.enrollmentAttachmentFilename, 'Achieve-WC-Agent-FirstPay-Data-2026-08-27.csv')
const padded = email.raw.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - email.raw.length % 4) % 4)
const decoded = new TextDecoder().decode(Uint8Array.from(atob(padded), character => character.charCodeAt(0)))
const htmlPayload = decoded.match(/Content-Type: text\/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--achieve_alt_/)?.[1]
assert.ok(htmlPayload)
const decodedHtml = new TextDecoder().decode(Uint8Array.from(
  atob(htmlPayload.replaceAll(/\s/g, '')),
  character => character.charCodeAt(0),
))

assert.ok(decoded.includes('To: leader-one@example.test'))
assert.ok(decoded.includes('Cc: observer@example.test'))
assert.strictEqual(decoded.match(/Content-Type: text\/csv/g)?.length, 3)
assert.ok(decoded.includes('filename="Achieve-WC-Agent-FirstPay-Data-2026-08-27.csv"'))
assert.ok(decoded.split('\r\n').every(line => new TextEncoder().encode(line).length <= 998))
assert.ok(decodedHtml.includes('Achieve WC Agent Performance | Report Run Date = August 27, 2026'))
assert.ok(decodedHtml.includes('Organizational Trends'))
assert.ok(decodedHtml.includes('2 weeks vs PP'))
assert.ok(decodedHtml.includes('vs. 79.0%'))
assert.ok(decodedHtml.includes('97 <span'))
assert.ok(decodedHtml.includes('vs. —'))
assert.ok(decodedHtml.includes('High Risk Triangulation'))
const highRiskHtml = decodedHtml.slice(
  decodedHtml.indexOf('High Risk Triangulation'),
  decodedHtml.indexOf('Bottom 10 Agents by Negative Reviews'),
)
assert.ok(highRiskHtml.includes('67% (4/6)'))
assert.ok(!highRiskHtml.includes('(2/3)'))
assert.ok(highRiskHtml.includes('Clarity Flags'))
assert.ok(decodedHtml.includes('Bottom 10 Agents by Negative Reviews — Last 4 Weeks'))
assert.ok(decodedHtml.includes('Bottom 10 by Negative Intelligibility Flags — Last 4 Weeks'))
assert.ok(decodedHtml.includes('Speech Clarity'))
assert.ok(decodedHtml.includes('Background Noise'))
assert.ok(decodedHtml.includes('Connection'))
assert.ok(decodedHtml.includes('Bottom 10 by Mature 6 week first pay screening'))
assert.ok(decodedHtml.includes('Bottom 10 by First Pay Screening — Last 6 Months'))
const matureSection = decodedHtml.indexOf('Bottom 10 by Mature 6 week first pay screening')
const sixMonthSection = decodedHtml.indexOf('Bottom 10 by First Pay Screening — Last 6 Months')
const zExplanation = decodedHtml.indexOf('Z Scores for People Who Hate Statistics')
assert.ok(matureSection < sixMonthSection && sixMonthSection < zExplanation)
const sixMonthHtml = decodedHtml.slice(sixMonthSection, zExplanation)
assert.ok(sixMonthHtml.indexOf('&lt;High Risk &amp; Agent&gt;') < sixMonthHtml.indexOf('Intelligibility Agent'))
assert.ok(sixMonthHtml.indexOf('Intelligibility Agent') < sixMonthHtml.indexOf('Bottom Agent'))
assert.ok(sixMonthHtml.includes('requires at least 10 enrollments per agent'))
assert.ok(!sixMonthHtml.includes('Tiny Sample'))
assert.ok(decodedHtml.includes('AI Flags'))
assert.ok(!decodedHtml.includes('AI QA flagged'))
assert.ok(!decodedHtml.includes('>Accent<'))
assert.ok(decodedHtml.includes('Roster'))
assert.ok(decodedHtml.includes('−0.94'))
assert.ok(decodedHtml.includes('†'))
assert.ok(decodedHtml.includes('Termination follow-through'))
assert.ok(decodedHtml.includes('Latest Post-Term Enrollment'))
assert.ok(decodedHtml.includes('Enrollments After Termination'))
assert.ok(decodedHtml.includes('Enrollment Date is strictly after'))
assert.ok(decodedHtml.includes('2026-08-26'))
assert.ok(decodedHtml.includes('Source as of 2026-08-27'))
assert.ok(decodedHtml.includes('&lt;High Risk &amp; Agent&gt;'))
assert.ok(!decodedHtml.includes('<style'))
assert.ok(!decodedHtml.includes('class='))
assert.ok(!decodedHtml.includes('var(--'))
assert.ok(!decodedHtml.includes('display:grid'))
assert.ok(decodedHtml.includes('style="'))
assert.ok(decodedHtml.includes('not persisted in Eavesly'))
assert.ok(new TextEncoder().encode(decodedHtml).length < 102_400)
assert.ok(new TextEncoder().encode(decoded).length < 25_000_000)

console.log('achieve-weekly-email: all checks passed')
