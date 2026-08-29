import {
  ACHIEVE_FIRST_PAY_BOTTOM_LIST_MIN_ENROLLMENTS,
  achieveFirstPayOutcomesCsv,
  achieveManagementReportCsv,
  achieveReportWeekEnding,
  type AchieveFirstPayOutcomeAgent,
  type AchieveFirstPayOutcomePeriod,
  type AchieveManagementPeriod,
  type AchieveManagementReport,
  type AchieveManagementRepresentative,
} from '../_shared/achieve-management-report.ts'

/** Fully encoded Gmail API message plus human-readable metadata. */
export type AchieveWeeklyEmail = {
  readonly raw: string
  readonly subject: string
  readonly attachmentFilename: string
  readonly outcomeAttachmentFilename: string
  readonly enrollmentAttachmentFilename: string
}

/** Keep test sends internal without changing the scheduled distribution list. */
export function achieveWeeklyEmailEnvelope(
  test: boolean,
  recipients: ReadonlyArray<string>,
  ccRecipients: ReadonlyArray<string>,
  testRecipient: string,
): { readonly recipients: ReadonlyArray<string>; readonly ccRecipients: ReadonlyArray<string> } {
  return test
    ? { recipients: [testRecipient], ccRecipients: [] }
    : { recipients, ccRecipients }
}

const GMAIL_MAX_MESSAGE_BYTES = 25_000_000

const INK = '#23262b'
const MUTED = '#6d7178'
const FAINT = '#9b9fa6'
const HAIR = '#d9dade'
const CELL = 'padding:7px 7px;border-bottom:1px solid #d9dade;text-align:right;white-space:nowrap;font-size:13px;color:#23262b'
const LEFT_CELL = `${CELL};text-align:left`
const HEADER = 'padding:6px 7px;border-bottom:1px solid #bfc1c5;text-align:right;white-space:nowrap;font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:#6d7178;font-weight:600'
const LEFT_HEADER = `${HEADER};text-align:left`

function html(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
  }
  return btoa(binary)
}

function base64url(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join('\r\n') ?? ''
}

function encodeMimeBody(value: string): string {
  return wrapBase64(bytesToBase64(new TextEncoder().encode(value)))
}

function dateLabel(value: string, month: 'short' | 'long' = 'short'): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', month, day: 'numeric', year: 'numeric',
  }).format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value))
}

function rangeLabel(start: string, end: string, exclusiveEnd: boolean): string {
  const endDate = new Date(end.length === 10 ? `${end}T00:00:00Z` : end)
  if (exclusiveEnd) endDate.setUTCDate(endDate.getUTCDate() - 1)
  return `${dateLabel(start)} – ${dateLabel(endDate.toISOString())}`
}

function percentage(count: number, total: number, digits = 1): string {
  return total === 0 ? '—' : `${(count * 100 / total).toFixed(digits)}%`
}

function countRate(count: number, total: number, digits = 0): string {
  return `${percentage(count, total, digits)} (${count.toLocaleString('en-US')}/${total.toLocaleString('en-US')})`
}

function zLabel(agent: AchieveFirstPayOutcomeAgent | undefined): string {
  if (!agent || agent.z === null) return '—'
  const value = agent.z.toFixed(2).replace('-', '−')
  return agent.sampleQualified ? value : `${value} <span style="color:${FAINT}">†</span>`
}

function banner(title: string, color: string, marginTop = 24): string {
  return `<p style="margin:${marginTop}px 0 10px;padding:8px 12px;border-radius:8px;background:${color};color:#ffffff;font-size:11.5px;font-weight:700;letter-spacing:.11em;text-transform:uppercase">${title}</p>`
}

function tile(label: string, value: string, comparison: string, range: string, note: string, background: string): string {
  return `<td width="25%" valign="top" style="width:25%;padding:5px"><div style="min-height:78px;padding:9px 12px;border-radius:9px;background:${background};color:#ffffff;font-variant-numeric:tabular-nums"><p style="margin:0 0 2px;color:#ffffff;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase">${label}</p><p style="margin:0;color:#ffffff;font-size:19px;font-weight:600;line-height:1.15">${value}${comparison ? ` <span style="color:#ffffff;font-size:11.5px;font-weight:600">vs. ${comparison}</span>` : ''}</p><p style="margin:2px 0 0;color:#ffffff;font-size:10.5px">${range}</p><p style="margin:0;color:#ffffff;font-size:10.5px">${note}</p></div></td>`
}

function period(report: AchieveManagementReport, weeks: 2 | 4 | 6): AchieveManagementPeriod {
  const value = report.periods.find(candidate => candidate.weeks === weeks)
  if (!value) throw new Error('missing_achieve_management_period')
  return value
}

function outcomePeriod(report: AchieveManagementReport, key: AchieveFirstPayOutcomePeriod['key']): AchieveFirstPayOutcomePeriod {
  const value = report.outcomes.periods.find(candidate => candidate.key === key)
  if (!value) throw new Error('missing_achieve_outcome_period')
  return value
}

function representativeByEmail(reportPeriod: AchieveManagementPeriod): ReadonlyMap<string, AchieveManagementRepresentative> {
  return new Map(reportPeriod.representatives.map(representative => [representative.agentEmail, representative]))
}

function outcomeByEmail(reportPeriod: AchieveFirstPayOutcomePeriod): ReadonlyMap<string, AchieveFirstPayOutcomeAgent> {
  return new Map(reportPeriod.agents.map(agent => [agent.agentEmail, agent]))
}

function bottomTenOutcomes(reportPeriod: AchieveFirstPayOutcomePeriod): ReadonlyArray<AchieveFirstPayOutcomeAgent> {
  return [...reportPeriod.agents]
    .filter(agent => agent.n >= ACHIEVE_FIRST_PAY_BOTTOM_LIST_MIN_ENROLLMENTS && agent.z !== null)
    .sort((left, right) => (right.z ?? Number.NEGATIVE_INFINITY) - (left.z ?? Number.NEGATIVE_INFINITY)
      || right.failures - left.failures
      || left.agentEmail.localeCompare(right.agentEmail))
    .slice(0, 10)
}

function rosterReview(periodValue: AchieveManagementPeriod): { reviews: number; negative: number; aiTotal: number; aiFlagged: number } {
  return periodValue.representatives.reduce((total, representative) => ({
    reviews: total.reviews + representative.totalSubmissions,
    negative: total.negative + representative.fair + representative.poor,
    aiTotal: total.aiTotal + representative.aiTotal,
    aiFlagged: total.aiFlagged + representative.aiFlagged,
  }), { reviews: 0, negative: 0, aiTotal: 0, aiFlagged: 0 })
}

function performanceTable(
  representatives: ReadonlyArray<AchieveManagementRepresentative>,
  reviewPeriod: AchieveManagementPeriod,
  outcome: AchieveFirstPayOutcomePeriod,
  outcomeHeading: string,
): string {
  const outcomes = outcomeByEmail(outcome)
  const roster = rosterReview(reviewPeriod)
  const rows = representatives.map(representative => {
    const agent = outcomes.get(representative.agentEmail)
    return `<tr><td style="${LEFT_CELL}">${html(representative.agentName)}</td><td style="${CELL}">${zLabel(agent)}</td><td style="${CELL}">${agent ? countRate(agent.failures, agent.n, 1) : '—'}</td><td style="${CELL}">${countRate(representative.fair + representative.poor, representative.totalSubmissions)}</td><td style="${CELL}">${countRate(representative.aiFlagged, representative.aiTotal)}</td></tr>`
  }).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums"><tr><th style="${LEFT_HEADER}">Agent</th><th style="${HEADER}">${outcomeHeading} z</th><th style="${HEADER}">${outcomeHeading} Fail %</th><th style="${HEADER}">Negative Reviews</th><th style="${HEADER}">AI Flags</th></tr>${rows}<tr><td style="${LEFT_CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">Roster</td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0"></td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">${countRate(outcome.n - outcome.paid, outcome.n, 1)}</td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">${countRate(roster.negative, roster.reviews)}</td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">${countRate(roster.aiFlagged, roster.aiTotal)}</td></tr></table>`
}

function emailBody(report: AchieveManagementReport, portalUrl: string): { readonly text: string; readonly html: string } {
  const four = period(report, 4)
  const six = period(report, 6)
  const matureFour = outcomePeriod(report, 'mature_4_weeks')
  const matureSix = outcomePeriod(report, 'mature_6_weeks')
  const sixMonths = outcomePeriod(report, 'mature_6_months')
  const firstPayTiles = (['mature_2_weeks', 'mature_4_weeks', 'mature_6_weeks', 'all_time'] as const).map(key => {
    const outcome = outcomePeriod(report, key)
    const comparison = outcome.previousN === null || outcome.previousN === 0 || outcome.previousPaid === null
      ? '—'
      : percentage(outcome.previousPaid, outcome.previousN)
    return tile(
      key === 'all_time' ? 'All time' : `${key.slice(7, 8)} weeks vs PP`,
      percentage(outcome.paid, outcome.n),
      key === 'all_time' ? '' : comparison,
      outcome.startDate === null ? `Nov 2024 – ${dateLabel(outcome.endDate)}` : rangeLabel(outcome.startDate, outcome.endDate, false),
      `${outcome.paid.toLocaleString('en-US')} of ${outcome.n.toLocaleString('en-US')} paid`,
      '#16395f',
    )
  }).join('')
  const reviewTiles = report.reviewTrends.map(trend => tile(
    `${trend.weeks} weeks vs PP`,
    trend.negativeReviews.toLocaleString('en-US'),
    trend.previousReviews === 0 ? '—' : trend.previousNegativeReviews.toLocaleString('en-US'),
    rangeLabel(trend.startAt, trend.endAt, true),
    `of ${trend.reviews.toLocaleString('en-US')} total reviews`,
    '#1c3352',
  )).join('') + tile(
    'All time',
    report.allTimeNegativeReviews.toLocaleString('en-US'),
    '',
    'since Jul 13, 2026',
    `of ${report.allTimeReviews.toLocaleString('en-US')} total reviews`,
    '#1c3352',
  )
  const fourByEmail = representativeByEmail(four)
  const selectedFourWeek = (emails: ReadonlyArray<string>) => emails.flatMap(email => {
    const representative = fourByEmail.get(email)
    return representative ? [representative] : []
  })
  const highRisk = selectedFourWeek(report.highRiskAgentEmails)
  const bottomTenNegative = selectedFourWeek(report.bottomTenNegativeReviewAgentEmails)
  const bottomTenIntelligibility = selectedFourWeek(report.bottomTenIntelligibilityAgentEmails)
  const matureSixByEmail = outcomeByEmail(matureSix)
  const highRiskRows = highRisk.map(representative => {
    const agent = matureSixByEmail.get(representative.agentEmail)
    const clarity = representative.accent + representative.backgroundNoise + representative.connectionIssues
    return `<tr><td style="${LEFT_CELL}">${html(representative.agentName)}</td><td style="${CELL}">${zLabel(agent)}</td><td style="${CELL}">${agent ? countRate(agent.failures, agent.n, 1) : '—'}</td><td style="${CELL}">${countRate(representative.fair + representative.poor, representative.totalSubmissions)}</td><td style="${CELL}">${countRate(clarity, representative.totalSubmissions)}</td><td style="${CELL}">${countRate(representative.aiFlagged, representative.aiTotal)}</td></tr>`
  }).join('')
  const intelligibilityRows = bottomTenIntelligibility.map(representative => `<tr><td style="${LEFT_CELL}">${html(representative.agentName)}</td><td style="${CELL};font-weight:600">${representative.accent}</td><td style="${CELL}">${representative.backgroundNoise}</td><td style="${CELL}">${representative.connectionIssues}</td><td style="${CELL}">${countRate(representative.fair + representative.poor, representative.totalSubmissions)}</td></tr>`).join('')
  const matureTopTen = report.bottomTenFirstPayAgentEmails.flatMap(email => {
    const agent = matureSixByEmail.get(email)
    return agent ? [agent] : []
  })
  const sixByEmail = representativeByEmail(six)
  const matureRows = matureTopTen.map(agent => {
    const representative = sixByEmail.get(agent.agentEmail)
    return `<tr><td style="${LEFT_CELL}">${html(agent.agentName)}</td><td style="${CELL};${(agent.z ?? 0) >= 2 ? 'color:#b3452c;font-weight:600' : ''}">${zLabel(agent)}</td><td style="${CELL}">${countRate(agent.failures, agent.n, 1)}</td><td style="${CELL}">${representative ? countRate(representative.fair + representative.poor, representative.totalSubmissions) : '—'}</td><td style="${CELL}">${representative ? countRate(representative.aiFlagged, representative.aiTotal) : '—'}</td></tr>`
  }).join('')
  const sixMonthTopTen = bottomTenOutcomes(sixMonths)
  const sixMonthRows = sixMonthTopTen.map(agent => {
    const representative = sixByEmail.get(agent.agentEmail)
    return `<tr><td style="${LEFT_CELL}">${html(agent.agentName)}</td><td style="${CELL};${(agent.z ?? 0) >= 2 ? 'color:#b3452c;font-weight:600' : ''}">${zLabel(agent)}</td><td style="${CELL}">${countRate(agent.failures, agent.n, 1)}</td><td style="${CELL}">${representative ? countRate(representative.fair + representative.poor, representative.totalSubmissions) : '—'}</td><td style="${CELL}">${representative ? countRate(representative.aiFlagged, representative.aiTotal) : '—'}</td></tr>`
  }).join('')
  const fourRoster = rosterReview(four)
  const clarityRoster = four.representatives.reduce((total, representative) => total + representative.accent + representative.backgroundNoise + representative.connectionIssues, 0)
  const accentRoster = four.representatives.reduce((total, representative) => total + representative.accent, 0)
  const noiseRoster = four.representatives.reduce((total, representative) => total + representative.backgroundNoise, 0)
  const connectionRoster = four.representatives.reduce((total, representative) => total + representative.connectionIssues, 0)
  const sixRoster = rosterReview(six)
  const terminationRows = report.terminations.map(termination => `<tr><td style="${LEFT_CELL}">${html(termination.agentName)}</td><td style="${CELL}">${html(termination.terminatedAt.slice(0, 10))}</td><td style="${CELL}">${termination.lastActivityOn ?? '—'}</td><td style="${CELL};font-weight:600">${termination.activityPostTermination}</td></tr>`).join('')
  const runDate = dateLabel(report.generatedAt, 'long')
  const emptyRow = (columns: number, message: string) => `<tr><td colspan="${columns}" style="padding:10px;color:${MUTED};font-size:13px">${message}</td></tr>`
  const definition = `font-size:12.5px;color:${MUTED};margin:6px 0 0;line-height:1.5`
  const body = `<p style="margin:0 0 10px;padding:8px 12px;border-radius:8px;background:#0e2540;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:.11em;text-transform:uppercase">Achieve WC Agent Performance | Report Run Date = ${html(runDate)}</p><div style="margin:0 0 20px;padding:14px 16px 10px;border-radius:12px;background:#f0f0f1"><p style="margin:0 0 8px;color:${MUTED};font-size:11.5px;font-weight:600;letter-spacing:.11em;text-transform:uppercase">Organizational Trends</p><p style="margin:4px 0 6px;color:${INK};font-size:12.5px;font-weight:600">First Pay Rate by Orig Scheduled Date <span style="font-weight:400;color:${MUTED}">(10 day maturation time)</span></p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse"><tr>${firstPayTiles}</tr></table><p style="margin:14px 0 6px;color:${INK};font-size:12.5px;font-weight:600"># of Negative Reviews <span style="font-weight:400;color:${MUTED}">(through report creation date)</span></p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse"><tr>${reviewTiles}</tr></table><div style="margin:10px 0 0;padding:11px 14px;border-radius:9px;background:#f0efec;color:${FAINT};font-size:13.5px"><strong>First Pay Definition:</strong> Client makes any deposit, regardless of amount.<br><strong>First Pay Window:</strong> 10-day maturation period delay allowed for draft posting.</div></div>${banner('High Risk Triangulation — On 2+ of the 3 Bottom 10 Lists, or First Pay z > 1.5', '#16395f')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse"><tr><th style="${LEFT_HEADER}">Agent</th><th style="${HEADER}">Mature 6 wk z</th><th style="${HEADER}">Mature 6 wk Fail %</th><th style="${HEADER}">Negative Reviews</th><th style="${HEADER}">Clarity Flags</th><th style="${HEADER}">AI Flags</th></tr>${highRiskRows || emptyRow(6, 'No active agents met the triangulation rule.')}<tr><td style="${LEFT_CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">Roster</td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0"></td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">${countRate(matureSix.n - matureSix.paid, matureSix.n, 1)}</td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">${countRate(fourRoster.negative, fourRoster.reviews)}</td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">${countRate(clarityRoster, fourRoster.reviews)}</td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">${countRate(fourRoster.aiFlagged, fourRoster.aiTotal)}</td></tr></table><p style="${definition}">High risk triangulation = active agents appearing on at least 2 of the 3 Bottom 10 lists below, or appearing on mature 6-week first-pay screening with z above 1.5. Sorted by number of lists, then mature 6-week z.</p>${banner('Bottom 10 Agents by Negative Reviews — Last 4 Weeks', '#1c4a7a')}${performanceTable(bottomTenNegative, four, matureFour, 'Mature 4 wk')}<p style="${definition}">Bottom 10 = active agents with at least 3 Form reviews in the latest four weeks, ranked by raw negative-review rate; ties use negative count, then email.</p>${banner('Bottom 10 by Negative Intelligibility Flags — Last 4 Weeks', '#235688')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse"><tr><th style="${LEFT_HEADER}">Agent</th><th style="${HEADER}">Speech Clarity</th><th style="${HEADER}">Background Noise</th><th style="${HEADER}">Connection</th><th style="${HEADER}">Negative Reviews</th></tr>${intelligibilityRows || emptyRow(5, 'No active agents had Speech Clarity flags.')}<tr><td style="${LEFT_CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">Roster</td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">${accentRoster}</td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">${noiseRoster}</td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">${connectionRoster}</td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">${countRate(fourRoster.negative, fourRoster.reviews)}</td></tr></table><p style="${definition}">Bottom 10 by intelligibility flags = active agents with the most Speech Clarity flags in the latest four weeks; ties use negative-review count. Background Noise and Connection are context only. These count flags, not rates.</p>${banner(`Bottom 10 by Mature 6 week first pay screening (through ${html(dateLabel(report.outcomes.maturityCutoff))})`, '#2a6296')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse"><tr><th style="${LEFT_HEADER}">Agent</th><th style="${HEADER}">Mature 6 wk z</th><th style="${HEADER}">Mature 6 wk failure rate</th><th style="${HEADER}">Negative Reviews</th><th style="${HEADER}">AI Flags</th></tr>${matureRows}<tr><td style="${LEFT_CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">Roster</td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0"></td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">${countRate(matureSix.n - matureSix.paid, matureSix.n, 1)}</td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">${countRate(sixRoster.negative, sixRoster.reviews)}</td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">${countRate(sixRoster.aiFlagged, sixRoster.aiTotal)}</td></tr></table>${banner(`Bottom 10 by First Pay Screening — Last 6 Months (through ${html(dateLabel(report.outcomes.maturityCutoff))})`, '#3473a7')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse"><tr><th style="${LEFT_HEADER}">Agent</th><th style="${HEADER}">6-month z</th><th style="${HEADER}">6-month failure rate</th><th style="${HEADER}">6-week Negative Reviews</th><th style="${HEADER}">6-week AI Flags</th></tr>${sixMonthRows || emptyRow(5, 'No agents met the 10-enrollment minimum.')}<tr><td style="${LEFT_CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">Roster</td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0"></td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">${countRate(sixMonths.n - sixMonths.paid, sixMonths.n, 1)}</td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">${countRate(sixRoster.negative, sixRoster.reviews)}</td><td style="${CELL};border-top:1.5px solid #bfc1c5;border-bottom:0;font-weight:700">${countRate(sixRoster.aiFlagged, sixRoster.aiTotal)}</td></tr></table><p style="${definition}">Six-month first-pay screening uses mature enrollments from the trailing six calendar months and requires at least ${ACHIEVE_FIRST_PAY_BOTTOM_LIST_MIN_ENROLLMENTS} enrollments per agent. Review context is the completed six-week period.</p><div style="margin:18px 0 0;padding:12px 15px;border-radius:9px;background:#f0efec;color:${MUTED};font-size:12.5px;line-height:1.55"><strong style="color:${INK}">Z Scores for People Who Hate Statistics</strong><ul style="margin:8px 0 0;padding-left:18px"><li><strong>z = 1 – 1.5 — “could easily be luck.”</strong></li><li><strong>z = 1.5 – 2 — “probably real, not yet proven.”</strong></li><li><strong>z = 2+ — “luck is no longer a credible explanation.”</strong></li></ul><p style="margin:8px 0 0"><strong>†</strong> = sample below qualification (expected failures/successes &lt; 5) — directional only.</p></div>${banner('Termination follow-through', '#3d7bb0')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse"><tr><th style="${LEFT_HEADER}">Agent</th><th style="${HEADER}">Terminated</th><th style="${HEADER}">Last WC Activity</th><th style="${HEADER}">Activity Post Term</th></tr>${terminationRows || emptyRow(4, 'No effective terminations to monitor.')}</table><p style="${definition}">Activity Post Term = distinct client IDs whose assignment first appeared on or after termination. Any value above zero escalates to Achieve to confirm system access is closed.</p><div style="margin-top:20px;padding-top:12px;border-top:1px solid ${HAIR};color:${FAINT};font-size:12px;line-height:1.7">Method: failure = no first client deposit. Cohorts key exclusively on original scheduled first-pay date after 10+ days settled. z uses weekly leave-one-out peer rates. The email body and portal are aggregate only. The enrollment attachment contains AFF Number and WC agent email for approved Achieve follow-through and is not persisted in Eavesly. <a href="${html(portalUrl)}" style="color:#31567f">Open Achieve portal</a>. Questions: nmogil@trypennie.com.</div>`
  return {
    text: `Achieve WC Agent Performance — report run ${runDate}\n\nHigh Risk Triangulation: ${highRisk.map(row => row.agentName).join(', ') || 'None'}\nBottom 10 Negative Reviews: ${bottomTenNegative.map(row => row.agentName).join(', ') || 'None'}\nBottom 10 Intelligibility: ${bottomTenIntelligibility.map(row => row.agentName).join(', ') || 'None'}\nBottom 10 Mature 6-week First Pay: ${matureTopTen.map(row => row.agentName).join(', ') || 'None'}\nBottom 10 Last 6 Months First Pay: ${sixMonthTopTen.map(row => row.agentName).join(', ') || 'None'}\nTermination follow-through: ${report.terminations.map(row => `${row.agentName}: ${row.activityPostTermination} post-term`).join(', ') || 'None'}\n\nOpen the Achieve portal: ${portalUrl}\n\nThree CSVs are attached: management, first-pay outcomes, and the enrollment-level Achieve follow-through export.`,
    html: `<!doctype html><html><body style="margin:0;background:#f2f1ee;color:${INK};font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f2f1ee"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="760" cellpadding="0" cellspacing="0" style="width:100%;max-width:760px;border-collapse:separate;background:#ffffff"><tr><td style="padding:24px 26px 26px">${body}</td></tr></table></td></tr></table></body></html>`,
  }
}

/** Build Geoff's email-safe report plus all three approved CSV attachments. */
export function buildAchieveWeeklyEmail(
  report: AchieveManagementReport,
  sender: string,
  recipients: ReadonlyArray<string>,
  ccRecipients: ReadonlyArray<string>,
  portalUrl: string,
  enrollmentAttachment: { readonly sourceAsOf: string; readonly csv: string },
): AchieveWeeklyEmail {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(enrollmentAttachment.sourceAsOf)) {
    throw new Error('invalid_enrollment_attachment_date')
  }
  const completedDate = achieveReportWeekEnding(report)
  const subject = `Achieve WC agent report - week ending ${completedDate}`
  const attachmentFilename = `achieve-management-${completedDate}.csv`
  const outcomeAttachmentFilename = `achieve-first-pay-outcomes-${completedDate}.csv`
  const enrollmentAttachmentFilename = `Achieve-WC-Agent-FirstPay-Data-${enrollmentAttachment.sourceAsOf}.csv`
  const mixedBoundary = `achieve_mixed_${completedDate.replaceAll('-', '')}`
  const alternativeBoundary = `achieve_alt_${completedDate.replaceAll('-', '')}`
  const body = emailBody(report, portalUrl)
  const message = [
    `From: Eavesly Reports <${sender}>`,
    `To: ${recipients.join(', ')}`,
    ...(ccRecipients.length === 0 ? [] : [`Cc: ${ccRecipients.join(', ')}`]),
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    '',
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodeMimeBody(body.text),
    '',
    `--${alternativeBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodeMimeBody(body.html),
    '',
    `--${alternativeBoundary}--`,
    '',
    `--${mixedBoundary}`,
    `Content-Type: text/csv; charset="UTF-8"; name="${attachmentFilename}"`,
    `Content-Disposition: attachment; filename="${attachmentFilename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    encodeMimeBody(achieveManagementReportCsv(report)),
    '',
    `--${mixedBoundary}`,
    `Content-Type: text/csv; charset="UTF-8"; name="${outcomeAttachmentFilename}"`,
    `Content-Disposition: attachment; filename="${outcomeAttachmentFilename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    encodeMimeBody(achieveFirstPayOutcomesCsv(report.outcomes)),
    '',
    `--${mixedBoundary}`,
    `Content-Type: text/csv; charset="UTF-8"; name="${enrollmentAttachmentFilename}"`,
    `Content-Disposition: attachment; filename="${enrollmentAttachmentFilename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    encodeMimeBody(enrollmentAttachment.csv),
    '',
    `--${mixedBoundary}--`,
    '',
  ].join('\r\n')
  if (new TextEncoder().encode(message).length > GMAIL_MAX_MESSAGE_BYTES) {
    throw new Error('gmail_message_too_large')
  }
  return {
    raw: base64url(message),
    subject,
    attachmentFilename,
    outcomeAttachmentFilename,
    enrollmentAttachmentFilename,
  }
}
