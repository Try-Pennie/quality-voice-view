import {
  achieveFirstPayOutcomeSignal,
  achieveFirstPayOutcomesCsv,
  achieveManagementReportCsv,
  achieveReportWeekEnding,
  type AchieveManagementReport,
  type AchieveManagementRepresentative,
} from '../_shared/achieve-management-report.ts'

/** Fully encoded Gmail API message plus human-readable metadata. */
export type AchieveWeeklyEmail = {
  readonly raw: string
  readonly subject: string
  readonly attachmentFilename: string
  readonly outcomeAttachmentFilename: string
}

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

function ranksByEmail(report: AchieveManagementReport): ReadonlyMap<string, Readonly<Record<2 | 4 | 6, number>>> {
  const periodRanks = new Map(report.periods.map(period => [
    period.weeks,
    new Map(period.representatives.flatMap(representative => (
      representative.riskRank === null ? [] : [[representative.agentEmail, representative.riskRank] as const]
    ))),
  ]))
  return new Map(report.persistentAgentEmails.flatMap(email => {
    const two = periodRanks.get(2)?.get(email)
    const four = periodRanks.get(4)?.get(email)
    const six = periodRanks.get(6)?.get(email)
    return two === undefined || four === undefined || six === undefined
      ? []
      : [[email, { 2: two, 4: four, 6: six }] as const]
  }))
}

function persistentSixWeekRepresentatives(report: AchieveManagementReport): ReadonlyArray<AchieveManagementRepresentative> {
  const persistent = new Set(report.persistentAgentEmails)
  const sixWeek = report.periods.find(period => period.weeks === 6)
  return (sixWeek?.representatives ?? [])
    .filter(representative => persistent.has(representative.agentEmail))
    .sort((left, right) => (left.riskRank ?? Number.MAX_SAFE_INTEGER) - (right.riskRank ?? Number.MAX_SAFE_INTEGER))
}

function bottomFiveTwoWeekRepresentatives(report: AchieveManagementReport): ReadonlyArray<AchieveManagementRepresentative> {
  const twoWeek = report.periods.find(period => period.weeks === 2)
  return (twoWeek?.representatives ?? [])
    .filter(representative => representative.riskRank !== null && representative.riskRank <= 5)
    .sort((left, right) => (left.riskRank ?? Number.MAX_SAFE_INTEGER) - (right.riskRank ?? Number.MAX_SAFE_INTEGER))
}

function emailBody(
  report: AchieveManagementReport,
  previousReport: AchieveManagementReport,
  portalUrl: string,
): { readonly text: string; readonly html: string } {
  const representatives = persistentSixWeekRepresentatives(report)
  const bottomFiveRepresentatives = bottomFiveTwoWeekRepresentatives(report)
  const previousRepresentatives = persistentSixWeekRepresentatives(previousReport)
  const currentEmails = new Set(report.persistentAgentEmails)
  const previousEmails = new Set(previousReport.persistentAgentEmails)
  const newRepresentatives = representatives.filter(representative => !previousEmails.has(representative.agentEmail))
  const removedRepresentatives = previousRepresentatives.filter(representative => !currentEmails.has(representative.agentEmail))
  const newEmails = new Set(newRepresentatives.map(representative => representative.agentEmail))
  const ranks = ranksByEmail(report)
  const ending = new Date(Date.parse(report.completedThrough) - 1)
  const endingLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric',
  }).format(ending)
  const summary = representatives.length === 0
    ? 'No representative ranked in the Form-feedback top 10 across all three completed periods.'
    : `${representatives.length} representative${representatives.length === 1 ? '' : 's'} ranked in the Form-feedback top 10 across all three completed periods.`
  const timestamp = (value: string) => new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(value))
  const reportDate = (value: string) => new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
  }).format(new Date(value))
  const terminationText = report.terminations.length === 0
    ? 'No effective terminations to monitor.'
    : report.terminations.map(termination => (
      `${termination.agentName} — Effective ${timestamp(termination.terminatedAt)} — Activity: ${termination.activity ? 'Yes' : 'No'}`
      + (termination.latestActivityOn ? ` — Listed ${reportDate(termination.latestActivityOn)}` : '')
    )).join('\n')
  const terminationRows = report.terminations.map(termination => {
    const color = termination.activity ? '#b42318' : '#166534'
    return `<tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;line-height:1.5;color:#334155">
      <strong style="color:#0f172a">${html(termination.agentName)}</strong>
      <span style="color:#64748b"> — Effective ${html(timestamp(termination.terminatedAt))} — </span>
      <strong style="color:${color}">Activity: ${termination.activity ? 'Yes' : 'No'}</strong>
      ${termination.latestActivityOn ? `<span style="color:#64748b"> — Listed ${html(reportDate(termination.latestActivityOn))}</span>` : ''}
    </td></tr>`
  }).join('')
  const terminationTable = report.terminations.length === 0
    ? '<p style="color:#64748b">No effective terminations to monitor.</p>'
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin-top:12px;border:1px solid #e2e8f0;border-collapse:collapse">${terminationRows}</table>`
  const names = (values: ReadonlyArray<AchieveManagementRepresentative>) => (
    values.length === 0 ? 'None' : values.map(representative => representative.agentName).join(', ')
  )
  const changes = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:20px 0;border-collapse:collapse">
    <tr><td style="padding:12px;border:1px solid #bbf7d0;background:#f0fdf4"><strong style="color:#166534">New since last Monday (${newRepresentatives.length})</strong><br><span style="color:#334155;font-size:13px">${html(names(newRepresentatives))}</span></td></tr>
    <tr><td height="8" style="height:8px;font-size:0;line-height:0">&nbsp;</td></tr>
    <tr><td style="padding:12px;border:1px solid #e2e8f0;background:#f8fafc"><strong style="color:#475569">Removed since last Monday (${removedRepresentatives.length})</strong><br><span style="color:#334155;font-size:13px">${html(names(removedRepresentatives))}</span></td></tr>
  </table>`
  const row = (representative: AchieveManagementRepresentative, badge: string, status = '') => {
    const latest = representative.latestSubmittedAt === null ? 'No Form activity' : `Latest ${new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
    }).format(new Date(representative.latestSubmittedAt))} UTC`
    const terminationStatus = representative.terminatedAt === null
      ? ''
      : ` <span style="display:inline-block;padding:3px 7px;border-radius:999px;background:#0f172a;color:#fff;font-size:10px;font-weight:700">Terminated · ${html(timestamp(representative.terminatedAt))}</span>`
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;border:1px solid #e2e8f0;border-collapse:separate;background:#ffffff"><tr><td style="padding:16px;font-size:13px;line-height:1.5">
      <strong style="font-size:16px;color:#0f172a">${html(representative.agentName)}</strong>${status}${terminationStatus}<br>
      <span style="color:#64748b">${html(representative.agentEmail)}</span><br>
      <span style="color:#64748b;font-size:12px">${latest}</span><br>
      <span style="display:inline-block;margin-top:8px;padding:4px 8px;background:#fef3c7;color:#92400e;font-size:11px;font-weight:700">${badge}</span>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin-top:14px;border-collapse:collapse"><tr>
        <td width="50%" valign="top" style="width:50%;padding:10px;border:1px solid #e2e8f0;background:#f8fafc"><span style="color:#64748b;font-size:11px;text-transform:uppercase">Form</span><br><strong style="font-size:18px;color:#0f172a">${representative.totalSubmissions}</strong> sample<br><strong style="color:#b45309">${representative.fairPoorRate.toFixed(1)}%</strong> Fair/Poor</td>
        <td width="50%" valign="top" style="width:50%;padding:10px;border:1px solid #bfdbfe;background:#eff6ff"><span style="color:#1d4ed8;font-size:11px;text-transform:uppercase">AI QA</span><br><strong style="font-size:18px;color:#0f172a">${representative.aiTotal}</strong> sample<br><strong style="color:#b42318">${representative.aiFlagged}</strong> flagged</td>
      </tr></table>
      <p style="margin:12px 0 0;color:#334155">Form: ${representative.good} Good · ${representative.fair} Fair · ${representative.poor} Poor · ${representative.other} Other</p>
      <p style="margin:6px 0 0;color:#334155">Reported conditions: Noise ${representative.backgroundNoise} · Accent ${representative.accent} · Connection ${representative.connectionIssues}</p>
      <p style="margin:6px 0 0;color:#64748b;font-size:12px">Alignment (${representative.overlapCalls} overlap): ${representative.bothClear} Both clear · ${representative.bothConcern} Both concern · ${representative.humanOnly} Human only · ${representative.aiOnly} AI only</p>
    </td></tr></table>`
  }
  const persistentRows = representatives.map(representative => {
    const periodRanks = ranks.get(representative.agentEmail)
    const badge = `Persistent high risk${periodRanks ? ` · 2w #${periodRanks[2]} · 4w #${periodRanks[4]} · 6w #${periodRanks[6]}` : ''}`
    const status = newEmails.has(representative.agentEmail)
      ? ' <span style="display:inline-block;padding:3px 7px;border-radius:999px;background:#dcfce7;color:#166534;font-size:10px;font-weight:700">New</span>'
      : ''
    return row(representative, badge, status)
  }).join('')
  const bottomFiveRows = bottomFiveRepresentatives.map(representative => row(
    representative,
    `Bottom 5 · 2w #${representative.riskRank}${currentEmails.has(representative.agentEmail) ? ' · Also persistent' : ''}`,
  )).join('')
  const matureSixWeek = report.outcomes.periods.find(period => period.key === 'mature_6_weeks')
  const outcomeFlags = (matureSixWeek?.agents ?? [])
    .filter(agent => agent.sampleQualified && agent.z !== null && agent.z >= 1.5)
    .sort((left, right) => (right.z ?? 0) - (left.z ?? 0) || right.n - left.n)
  const outcomeNames = outcomeFlags.length === 0
    ? 'No sample-qualified Watch, Flag, or Extreme signals.'
    : outcomeFlags.map(agent => `${agent.agentName} (${achieveFirstPayOutcomeSignal(agent)}, z ${agent.z?.toFixed(2)})`).join(', ')
  const outcomeRows = outcomeFlags.map(agent => `<div style="margin:10px 0;padding:14px;border:1px solid #e2e8f0;border-radius:10px;background:#fff">
    <strong>${html(agent.agentName)}</strong> <span style="display:inline-block;margin-left:4px;padding:3px 7px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:11px;font-weight:700">${html(achieveFirstPayOutcomeSignal(agent))} · z ${agent.z?.toFixed(2) ?? '—'}</span><br>
    <span style="color:#64748b;font-size:12px;overflow-wrap:anywhere">${html(agent.agentEmail)}</span>
    <p style="margin:10px 0 0;color:#334155;font-size:13px;line-height:1.6"><strong>${agent.failures} no deposit (${agent.failureRate.toFixed(1)}%)</strong> of ${agent.n} mature · roster expected ${agent.expectedFailures?.toFixed(1) ?? '—'} (${agent.expectedRate?.toFixed(1) ?? '—'}%) · delta ${agent.deltaPp !== null && agent.deltaPp > 0 ? '+' : ''}${agent.deltaPp?.toFixed(1) ?? '—'} pp<br>Rescinded ${agent.rescinded} · never paid ${agent.neverPaid}</p>
  </div>`).join('')
  const outcomeSection = `<h2 style="margin:32px 0 4px;font-size:20px">Mature 6-week first-pay screening</h2><p style="margin:0;color:#64748b;font-size:13px">Original scheduled first drafts through ${html(report.outcomes.maturityCutoff)}; leave-one-agent-out roster expectation for the same active cohort weeks. This is a screening signal, not causal proof. Source as of ${html(report.outcomes.sourceAsOf)}.</p><p style="color:#334155;font-size:13px"><strong>Review:</strong> ${html(outcomeNames)}</p>${outcomeRows === '' ? `<p style="color:#64748b">${html(outcomeNames)}</p>` : outcomeRows}`
  const cards = (rows: string) => rows === '' ? '' : rows
  return {
    text: `Achieve weekly management report — week ending ${endingLabel}

Mature 6-week first-pay screening: ${outcomeNames}
Source as of ${report.outcomes.sourceAsOf}; screening signal, not causal proof.

Bottom 5 — last 2 completed weeks: ${names(bottomFiveRepresentatives)}

${summary}

New since last Monday: ${names(newRepresentatives)}
Removed since last Monday: ${names(removedRepresentatives)}

Form feedback drives the risk ranking. AI QA is supporting context only.

Termination follow-through
${terminationText}

Open the Achieve portal: ${portalUrl}

The full management and all-time/4-week/6-week mature outcome exports are attached.`,
    html: `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f8fafc" style="width:100%;border-collapse:collapse"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="680" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:100%;max-width:680px;border:1px solid #e2e8f0;border-collapse:separate"><tr><td style="padding:24px"><p style="margin:0;color:#1d4ed8;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Achieve / FDR</p><h1 style="margin:8px 0 4px;font-size:24px">WC Agent Summary by representative</h1><p style="margin:0;color:#64748b">Completed 2/4/6-week management report through ${html(endingLabel)}</p>${outcomeSection}<p style="margin:20px 0 0">${html(summary)}</p>${changes}<h2 style="margin:28px 0 4px;font-size:20px">Bottom 5 — Last 2 Completed Weeks</h2><p style="margin:0;color:#64748b;font-size:13px">Highest sample-adjusted Form Fair/Poor scores in the completed two-week window. AI QA remains supporting context only.</p>${bottomFiveRows === '' ? '<p style="color:#64748b">No representatives had eligible Form feedback.</p>' : cards(bottomFiveRows)}<h2 style="margin:32px 0 4px;font-size:20px">Persistent High Risk</h2><p style="margin:0;color:#64748b;font-size:13px">Representatives ranked in the Form-feedback top 10 across all completed 2-, 4-, and 6-week periods.</p>${cards(persistentRows)}<p style="color:#475569;font-size:13px">Form feedback drives the risk ranking. AI QA is supporting context only.</p><h2 style="margin:32px 0 4px;font-size:20px">Termination follow-through</h2><p style="margin:0;color:#64748b;font-size:13px">Activity means the representative appeared in the Achieve daily report on or after the effective date.</p>${terminationTable}<p style="margin:24px 0 0"><a href="${html(portalUrl)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;border-radius:999px;padding:11px 18px;font-weight:700">Open Achieve portal</a></p><p style="margin:20px 0 0;color:#64748b;font-size:12px">The full management and all-time/4-week/6-week mature outcome exports are attached.</p></td></tr></table></td></tr></table></body></html>`,
  }
}

/** Build the HTML summary plus management and all-period mature-outcome CSV attachments. */
export function buildAchieveWeeklyEmail(
  report: AchieveManagementReport,
  previousReport: AchieveManagementReport,
  sender: string,
  recipients: ReadonlyArray<string>,
  ccRecipients: ReadonlyArray<string>,
  portalUrl: string,
): AchieveWeeklyEmail {
  const completedDate = achieveReportWeekEnding(report)
  const subject = `Achieve weekly management report - week ending ${completedDate}`
  const attachmentFilename = `achieve-management-${completedDate}.csv`
  const outcomeAttachmentFilename = `achieve-first-pay-outcomes-${completedDate}.csv`
  const mixedBoundary = `achieve_mixed_${completedDate.replaceAll('-', '')}`
  const alternativeBoundary = `achieve_alt_${completedDate.replaceAll('-', '')}`
  const body = emailBody(report, previousReport, portalUrl)
  const csv = achieveManagementReportCsv(report)
  const outcomeCsv = achieveFirstPayOutcomesCsv(report.outcomes)
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
    encodeMimeBody(csv),
    '',
    `--${mixedBoundary}`,
    `Content-Type: text/csv; charset="UTF-8"; name="${outcomeAttachmentFilename}"`,
    `Content-Disposition: attachment; filename="${outcomeAttachmentFilename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    encodeMimeBody(outcomeCsv),
    '',
    `--${mixedBoundary}--`,
    '',
  ].join('\r\n')
  return { raw: base64url(message), subject, attachmentFilename, outcomeAttachmentFilename }
}
