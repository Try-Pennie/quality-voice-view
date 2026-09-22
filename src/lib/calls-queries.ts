import { supabase } from '@/integrations/supabase/client'
import type { Call, TranscriptionQA } from '../types/database'
import { DEFAULT_THRESHOLDS, type ThresholdSettings } from '../types/settings'
import { startOfBusinessDay, endOfBusinessDay } from './time-zone'

/** Compact, parsed Calls row; no transcript or full QA payload on list reads. */
export type CallListRow = Pick<Call, 'id' | 'call_id' | 'agent_email' | 'agent_full_name' | 'started_at' | 'contact_phone' | 'talk_time' | 'handle_time' | 'disposition' | 'campaign_name'> & {
  qa: Pick<TranscriptionQA, 'call_id' | 'overall_score' | 'compliance_rating' | 'customer_satisfaction_likely' | 'manager_escalation'> | null
}
/** Server-side Calls filters; dates carry the existing ET picker convention. */
export type CallsFilters = {
  startDate: Date
  endDate: Date
  agents: string[]
  dispositions: string[]
  quickFilter: 'all' | 'escalations' | 'compliance' | 'threshold' | 'rushed'
  thresholds: ThresholdSettings
}
/** Every server sort has deterministic timestamp/ID tie-breaking. */
export type CallsSort = { key: 'time' | 'agent' | 'talk' | 'score' | 'compliance' | 'csat'; desc: boolean }
/** Whole-window summary independent of the visible page. */
export type CallsSummary = {
  total_calls: number
  window_calls: number
  calls_requiring_attention: number
  avg_talk_time: number
  avg_handle_time: number
  compliance_pass_rate: number
  high_sat_rate: number
  dispositions: string[]
}
/** Expected read failures stay typed until the React Query/rendering boundary. */
export type CallsResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { _tag: 'Cancelled' | 'Unavailable' | 'InvalidResponse' | 'ExportTooLarge'; message: string } }

type Options = { readonly signal?: AbortSignal }
const invalid = { ok: false, error: { _tag: 'InvalidResponse', message: 'The call service returned an invalid response.' } } as const
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    // SAFETY: typeof plus the null/array exclusions establish a string-keyed record for local boundary parsing.
    ? value as Record<string, unknown> : null
const nullableString = (value: unknown): value is string | null => value === null || typeof value === 'string'
const nullableNumber = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isFinite(value))
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')

/** Parse the single persisted threshold model used by the settings UI and Calls RPCs. */
export function readCallsThresholds(stored: string | null): ThresholdSettings {
  if (!stored) return DEFAULT_THRESHOLDS
  try {
    const value = record(JSON.parse(stored))
    if (!value
      || typeof value.overallScore !== 'string'
      || !['excellent', 'good', 'needs_improvement', 'poor'].includes(value.overallScore)
      || typeof value.compliance !== 'string'
      || !['pass', 'fail'].includes(value.compliance)
      || typeof value.customerSat !== 'string'
      || !['high', 'medium', 'low'].includes(value.customerSat)) return DEFAULT_THRESHOLDS
    // SAFETY: each property passed the matching finite string-union membership check above.
    return {
      overallScore: value.overallScore as ThresholdSettings['overallScore'],
      compliance: value.compliance as ThresholdSettings['compliance'],
      customerSat: value.customerSat as ThresholdSettings['customerSat'],
    }
  } catch {
    return DEFAULT_THRESHOLDS
  }
}

function parseRow(input: unknown): CallListRow | null {
  const row = record(input)
  if (!row || !count(row.id) || typeof row.call_id !== 'string' || typeof row.started_at !== 'string'
    || !Number.isFinite(Date.parse(row.started_at))
    || !nullableString(row.agent_email) || !nullableString(row.agent_full_name)
    || !nullableString(row.contact_phone) || !nullableString(row.disposition) || !nullableString(row.campaign_name)
    || !nullableNumber(row.talk_time) || !nullableNumber(row.handle_time)) return null
  let qa: CallListRow['qa'] = null
  if (row.qa !== null) {
    const value = record(row.qa)
    if (!value || typeof value.call_id !== 'string' || value.call_id !== row.call_id
      || !nullableString(value.overall_score) || !nullableString(value.compliance_rating)
      || !nullableString(value.customer_satisfaction_likely)
      || !(value.manager_escalation === null || typeof value.manager_escalation === 'boolean')) return null
    qa = { call_id: value.call_id, overall_score: value.overall_score, compliance_rating: value.compliance_rating,
      customer_satisfaction_likely: value.customer_satisfaction_likely,
      manager_escalation: typeof value.manager_escalation === 'boolean' ? value.manager_escalation : null }
  }
  return { id: row.id, call_id: row.call_id, agent_email: row.agent_email, agent_full_name: row.agent_full_name,
    started_at: row.started_at, contact_phone: row.contact_phone, talk_time: row.talk_time, handle_time: row.handle_time,
    disposition: row.disposition, campaign_name: row.campaign_name, qa }
}

function filterArgs(filters: CallsFilters) {
  return {
    p_start: startOfBusinessDay(filters.startDate).toISOString(),
    p_end: endOfBusinessDay(filters.endDate).toISOString(),
    p_agents: filters.agents.filter(email => email.trim()),
    p_dispositions: filters.dispositions,
    p_quick_filter: filters.quickFilter,
    p_thresholds: filters.thresholds,
  }
}

async function rpc(name: string, args: Record<string, unknown>, options: Options): Promise<CallsResult<unknown>> {
  try {
    // SAFETY: generated Supabase types lag this migration. Arguments are built here;
    // all RPC responses remain unknown until the concrete parsers below accept them.
    let request = supabase.rpc(name as never, args as never)
    if (options.signal) request = request.abortSignal(options.signal)
    const { data, error } = await request
    if (options.signal?.aborted) return { ok: false, error: { _tag: 'Cancelled', message: 'Loading cancelled.' } }
    if (error) return { ok: false, error: { _tag: 'Unavailable', message: 'Could not load call data. Try again.' } }
    return { ok: true, value: data }
  } catch {
    return options.signal?.aborted
      ? { ok: false, error: { _tag: 'Cancelled', message: 'Loading cancelled.' } }
      : { ok: false, error: { _tag: 'Unavailable', message: 'Could not load call data. Try again.' } }
  }
}

/** Fetch only one sorted page, including QA and a lookahead flag (no total-count dependency). */
export async function fetchCallsPage(filters: CallsFilters, sort: CallsSort, offset: number, limit = 25, options: Options = {}): Promise<CallsResult<{ rows: CallListRow[]; has_more: boolean }>> {
  const response = await rpc('eavesly_calls_page', { ...filterArgs(filters), p_sort: sort.key, p_desc: sort.desc, p_offset: offset, p_limit: limit }, options)
  if (response.ok === false) return response
  const data = record(response.value)
  if (!data || !Array.isArray(data.rows) || data.rows.length > limit || typeof data.has_more !== 'boolean') return invalid
  const rows: CallListRow[] = []
  for (const item of data.rows) {
    const row = parseRow(item)
    if (!row) return invalid
    rows.push(row)
  }
  if (new Set(rows.map(row => row.id)).size !== rows.length || (data.has_more && rows.length !== limit)) return invalid
  return { ok: true, value: { rows, has_more: data.has_more } }
}

/** Fetch filtered KPIs and date/agent-scoped disposition options, separately from rows. */
export async function fetchCallsSummary(filters: CallsFilters, options: Options = {}): Promise<CallsResult<CallsSummary>> {
  const response = await rpc('eavesly_calls_summary', filterArgs(filters), options)
  if (response.ok === false) return response
  const value = record(response.value)
  if (!value || !count(value.total_calls) || !count(value.window_calls) || value.total_calls > value.window_calls
    || !count(value.calls_requiring_attention) || value.calls_requiring_attention > value.total_calls
    || typeof value.avg_talk_time !== 'number' || !Number.isFinite(value.avg_talk_time)
    || typeof value.avg_handle_time !== 'number' || !Number.isFinite(value.avg_handle_time)
    || !count(value.compliance_pass_rate) || value.compliance_pass_rate > 100
    || !count(value.high_sat_rate) || value.high_sat_rate > 100 || !strings(value.dispositions)) return invalid
  return { ok: true, value: { total_calls: value.total_calls, window_calls: value.window_calls,
    calls_requiring_attention: value.calls_requiring_attention, avg_talk_time: value.avg_talk_time,
    avg_handle_time: value.avg_handle_time, compliance_pass_rate: value.compliance_pass_rate,
    high_sat_rate: value.high_sat_rate, dispositions: value.dispositions } }
}

/** Return distinct active agents, not every recent call bearing their names. */
export async function fetchActiveCallAgents(since: Date, options: Options = {}): Promise<CallsResult<{ agent_email: string; agent_full_name: string }[]>> {
  const response = await rpc('eavesly_active_call_agents', { p_since: since.toISOString() }, options)
  if (response.ok === false) return response
  if (!Array.isArray(response.value)) return invalid
  const agents: { agent_email: string; agent_full_name: string }[] = []
  for (const item of response.value) {
    const row = record(item)
    if (!row || typeof row.agent_email !== 'string' || typeof row.agent_full_name !== 'string') return invalid
    agents.push({ agent_email: row.agent_email, agent_full_name: row.agent_full_name })
  }
  return { ok: true, value: agents }
}

/** Aggregate pitch counts using server-resolved caller scope, preserving the existing Map interface. */
export async function fetchTeamPitchRisk(start: Date, end: Date, options: Options = {}): Promise<CallsResult<Map<string, { pitch_call_count: number; rushed_pitch_count: number }>>> {
  const response = await rpc('eavesly_team_pitch_risk', { p_start: startOfBusinessDay(start).toISOString(), p_end: endOfBusinessDay(end).toISOString() }, options)
  if (response.ok === false) return response
  if (!Array.isArray(response.value)) return invalid
  const counts = new Map<string, { pitch_call_count: number; rushed_pitch_count: number }>()
  for (const item of response.value) {
    const row = record(item)
    if (!row || typeof row.agent_email !== 'string' || !count(row.pitch_call_count)
      || !count(row.rushed_pitch_count) || row.rushed_pitch_count > row.pitch_call_count) return invalid
    counts.set(row.agent_email, { pitch_call_count: row.pitch_call_count, rushed_pitch_count: row.rushed_pitch_count })
  }
  return { ok: true, value: counts }
}

/** Read complete filtered rows only on explicit export; never return a silently capped/duplicate export. */
export async function fetchCallsExport(filters: CallsFilters, sort: CallsSort, options: Options = {}): Promise<CallsResult<CallListRow[]>> {
  const rows: CallListRow[] = []
  const ids = new Set<number>()
  // ponytail: bounded offset export, not a database snapshot. Detect duplicates;
  // use a server-side snapshot export if concurrent inserts require exact point-in-time exports.
  while (rows.length < 100_000) {
    const page = await fetchCallsPage(filters, sort, rows.length, 1000, options)
    if (page.ok === false) return page
    for (const row of page.value.rows) {
      if (ids.has(row.id)) return { ok: false, error: { _tag: 'Unavailable', message: 'Calls changed during export. Please try again.' } }
      ids.add(row.id)
      rows.push(row)
    }
    if (!page.value.has_more) return { ok: true, value: rows }
  }
  return { ok: false, error: { _tag: 'ExportTooLarge', message: 'Too many calls to export. Narrow the date range and try again.' } }
}

/** Translate typed read failures only at the React Query boundary. */
export function callsQueryValue<T>(result: CallsResult<T>): T {
  if (result.ok === false) throw new Error(result.error.message)
  return result.value
}
