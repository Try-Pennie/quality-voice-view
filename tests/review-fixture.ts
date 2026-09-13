import { expect, type Page } from '@playwright/test'
import type { AlertWithFeedback } from '../src/types/database'

export const NOW = new Date('2026-09-07T16:00:00Z')
export const EMAIL = 'manager@example.test'
export const QUOTES = ['Your credit may be affected.', 'You can cancel at any time.']
export const TRANSCRIPT = `[handling agent]: Hello, let us discuss your program.\n[contact]: I have questions about my credit.\n[handling agent]: ${QUOTES[0]} Please consider the implications.\n[contact]: What if I change my mind?\n[handling agent]: ${QUOTES[1]} We can explain the process.\n[contact]: Thank you for explaining.`

/** Synthetic records only; never reads or writes live customer data. */
export function alertRow(id: string, overrides: Partial<AlertWithFeedback> = {}): AlertWithFeedback {
  return {
    module_result_id: 1, alert_sent_at: '2026-09-04T16:00:00Z',
    processing_time_ms: null, assigned_manager_email: EMAIL,
    call_id: id, module_name: 'full_qa', violation_type: 'manager_escalation',
    alert_created_at: '2026-09-04T16:00:00Z', has_violation: true, alert_sent: true,
    agent_email: 'agent@example.test', contact_name: `Example ${id}`, contact_phone: null,
    call_summary: 'Synthetic call for manager review checks.', sfdc_lead_id: null,
    is_reviewed: false, accurate: null, action_taken: null, inaccuracy_reason: null,
    feedback_id: null, feedback_by: null, feedback_comment: null, reviewed_at: null,
    message_count: 0, last_message_at: null, acker_emails: [], recording_link: null,
    transcript_url: null,
    result_json: { call_overview: { manager_review_reason: 'Review both quoted passages in context.', manager_focus_areas: QUOTES.map(quote => ({ quote })) } },
    ...overrides,
  }
}

/** Supabase HTTP contract fixture. Auth/data traffic is intercepted before leaving the browser.
 * It exercises real hooks, queries, pagination requests and mutations, not patched modules.
 * This proves client behavior, not production RLS/SQL execution.
 */
export async function reviewFixture(page: Page, rows: AlertWithFeedback[], options: { god?: boolean; noAgents?: boolean; managedAgents?: string[]; managerNames?: Record<string, string>; dailyMetrics?: unknown[] } = {}) {
  const state = {
    rows, writes: [] as unknown[], requests: [] as URL[], transcript: TRANSCRIPT as string | null,
    failFeedback: false, failTranscript: false, failQueueOffset: -1, failBreakdown: false,
    transcriptGate: Promise.resolve(), ackGate: Promise.resolve(),
    failedAckIds: new Set<string>(), ackInFlight: 0, maxAckInFlight: 0,
  }
  await page.clock.setFixedTime(NOW)
  await page.addInitScript(({ email }) => {
    localStorage.setItem('sb-miikotqnovnixpeqtqnd-auth-token', JSON.stringify({
      access_token: 'synthetic-test-token', refresh_token: 'synthetic-refresh-token',
      token_type: 'bearer', expires_at: 4102444800,
      user: { id: '00000000-0000-4000-8000-000000000001', email, app_metadata: {}, user_metadata: {}, aud: 'authenticated' },
    }))
  }, { email: EMAIL })
  await page.routeWebSocket(/.*/, socket => socket.close())
  await page.route(url => url.protocol === 'https:', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (!url.hostname.endsWith('.supabase.co')) {
      await route.abort()
      return
    }
    state.requests.push(url)
    const table = url.pathname.split('/').pop()
    const respond = (data: unknown, status = 200) => route.fulfill({ status, json: data })
    if (table === 'agent_manager_mapping') return respond(options.noAgents ? [] : (options.managedAgents ?? ['agent@example.test']).map(agent_email => ({ agent_email })))
    if (table === 'manager_coaching_prompts') return respond({ is_god_mode: options.god ?? false })
    if (table === 'agent_directory') {
      return respond(Object.entries(options.managerNames ?? {}).map(([agent_email, agent_full_name]) => ({ agent_email, agent_full_name })))
    }
    if (table === 'team_daily_metrics') return respond(options.dailyMetrics ?? [])
    if (table === 'agent_daily_metrics') {
      const email = url.searchParams.get('p_agent_email')?.replace(/^eq\./, '')
      return respond((options.dailyMetrics ?? []).filter(row => !email || (row && typeof row === 'object' && 'agent_email' in row && row.agent_email === email)))
    }
    if (table === 'eavesly_alerts_with_feedback') {
      const params = url.searchParams
      let selected = [...state.rows]
      for (const [key, value] of params) {
        if (key === 'call_id' && value.startsWith('eq.')) selected = selected.filter(row => row.call_id === value.slice(3))
        if (key === 'module_name' && value.startsWith('eq.')) selected = selected.filter(row => row.module_name === value.slice(3))
        if (key === 'module_name' && value.startsWith('neq.')) selected = selected.filter(row => row.module_name !== value.slice(4))
        if (key === 'module_name' && value.startsWith('in.')) selected = selected.filter(row => value.includes(row.module_name))
        if (key === 'alert_sent' && value === 'eq.true') selected = selected.filter(row => row.alert_sent === true)
        if (key === 'agent_email' && value.startsWith('in.')) selected = selected.filter(row => value.includes(row.agent_email ?? 'no-agent'))
        if (key === 'alert_created_at' && value.startsWith('gte.')) selected = selected.filter(row => row.alert_created_at >= value.slice(4))
        if (key === 'alert_created_at' && value.startsWith('lte.')) selected = selected.filter(row => row.alert_created_at <= value.slice(4))
      }
      if (request.headers().accept?.includes('vnd.pgrst.object')) return respond(selected[0] ?? null)
      selected.sort((a, b) => b.alert_created_at.localeCompare(a.alert_created_at) || a.call_id.localeCompare(b.call_id) || a.module_name.localeCompare(b.module_name))
      const offset = Number(params.get('offset') ?? 0)
      const projection = params.get('select') ?? ''
      const list = projection.includes('feedback_comment')
      const breakdown = projection.includes('feedback_by') && projection.includes('has_violation') && !list
      if (list && offset === state.failQueueOffset) return respond({ message: 'Synthetic queue failure' }, 500)
      if (breakdown && state.failBreakdown) return respond({ message: 'Synthetic breakdown failure' }, 500)
      const pageRows = selected.slice(offset, offset + Math.min(Number(params.get('limit') ?? 1000), 1000))
      if (list) {
        // Real list projection deliberately omits heavy fields.
        return respond(pageRows.map(({ result_json: _result, recording_link: _recording, transcript_url: _transcript, ...row }) => row))
      }
      return respond(pageRows)
    }
    if (table === 'eavesly_alert_feedback' && request.method() === 'POST') {
      const input: unknown = request.postDataJSON()
      state.writes.push(input)
      if (state.failFeedback) return respond({ message: 'Synthetic save failure' }, 500)
      if (!input || typeof input !== 'object' || !('call_id' in input)) return respond({}, 400)
      const row = state.rows.find(row => row.call_id === input.call_id)
      if (!row || !('accurate' in input) || typeof input.accurate !== 'boolean') return respond({}, 400)
      row.is_reviewed = true
      row.accurate = input.accurate
      row.feedback_by = EMAIL
      row.feedback_id = 1
      row.reviewed_at = NOW.toISOString()
      if ('comment' in input) {
        if (typeof input.comment === 'string') row.feedback_comment = input.comment
        else if (input.comment === null) row.feedback_comment = null
      }
      if ('action_taken' in input) {
        if (input.action_taken === 'coached' || input.action_taken === 'escalated' || input.action_taken === 'follow_up_later' || input.action_taken === 'no_action_needed') row.action_taken = input.action_taken
        else if (input.action_taken === null) row.action_taken = null
      }
      return respond(null)
    }
    if (table === 'eavesly_alert_messages' && request.method() === 'POST') {
      state.writes.push(request.postDataJSON())
      return respond({ id: 1, call_id: rows[0]?.call_id, module_name: 'full_qa', author_email: EMAIL, body: 'A synthetic discussion message.', posted_at: NOW.toISOString(), parent_message_id: null, requires_acknowledgment: false, deleted_at: null })
    }
    if (table === 'eavesly_alert_acks' && request.method() === 'POST') {
      const input: unknown = request.postDataJSON()
      state.writes.push(input)
      state.ackInFlight++
      state.maxAckInFlight = Math.max(state.maxAckInFlight, state.ackInFlight)
      await state.ackGate
      state.ackInFlight--
      if (input && typeof input === 'object' && 'call_id' in input && typeof input.call_id === 'string') {
        if (state.failedAckIds.has(input.call_id)) return respond({ message: 'Synthetic approval failure' }, 500)
        const row = state.rows.find(row => row.call_id === input.call_id)
        if (row) row.acker_emails = [...row.acker_emails, EMAIL]
      }
      return respond(null)
    }
    if (table === 'eavesly_calls') {
      if (url.searchParams.get('select') !== '*' || !url.searchParams.get('call_id')?.startsWith('eq.')) return respond([])
      await state.transcriptGate
      if (state.failTranscript) return respond({ message: 'Synthetic transcript failure' }, 500)
      return respond({ call_id: url.searchParams.get('call_id')?.slice(3), agent_email: 'agent@example.test', started_at: NOW.toISOString(), ended_at: NOW.toISOString(), direction: 'inbound', conversation_happened: true })
    }
    if (table === 'eavesly_transcription_qa') return respond({ original_transcript: state.transcript, recording_link: null })
    if (request.method() !== 'GET' && !url.pathname.includes('/rpc/')) {
      throw new Error(`Unexpected mutation in browser fixture: ${url.pathname}`)
    }
    return respond([])
  })
  return state
}

/** Open a visible row by its synthetic contact name. */
export async function openAlert(page: Page, id: string) {
  await page.getByRole('button', { name: `Review Manager escalation alert for Example ${id}`, exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('Review both quoted passages in context.')).toBeVisible()
}
