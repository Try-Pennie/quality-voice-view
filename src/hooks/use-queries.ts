import { useQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase } from '../integrations/supabase/client'
import {
  fetchUserScope,
  fetchAlerts,
  fetchAlertBreakdown,
  fetchAlertsForCall,
  fetchAlertThread,
  type UserScope,
  type AlertFilters,
} from '../lib/alert-queries'
import {
  fetchTeamRollup,
  fetchAgentProfile,
  fetchTeamCoachingThemes,
  fetchCohortCoachingThemes,
  fetchAgentManagerMapping,
  fetchAgentManagerMappingAt,
  fetchManagerNames,
} from '../lib/team-queries'
import { fetchCallDetail } from '../lib/queries'
import {
  fetchCallsPage,
  fetchCallsSummary,
  fetchActiveCallAgents,
  fetchTeamPitchRisk,
  callsQueryValue,
  type CallsFilters,
  type CallsSort,
} from '../lib/calls-queries'
import { fetchRecentNotifications } from '../lib/notification-queries'
import { fetchGotaEvaluations } from '../lib/gota-queries'
import {
  fetchInsightsReport,
  priorWeekOf,
  baselineFor,
  type InsightsWindow,
} from '../lib/insights-queries'
import { filterAlertWorkloadRows, filterSuppressedAlertRows, isSuppressedAlertModule, type AlertWorkload } from '../lib/suppressed-alerts'
import { fetchAgentFeedbackForCall } from '../lib/agent-feedback-queries'
import {
  fetchResolverPolicyHistory,
  fetchModulePrompts,
  fetchDispositionOptions,
} from '../lib/admin-queries'
import {
  fetchDispositionAudit,
  type AuditFilters,
} from '../lib/disposition-audit-queries'

// React Query hashes queryKeys via stable JSON serialization, so primitives are
// preferable to live Date / UserScope references — both are reconstructed on
// each render in some places and would otherwise miss the cache.
const dateKey = (d: Date) => d.getTime()
const scopeKey = (scope: UserScope | null | undefined) =>
  scope
    ? {
        email: scope.email,
        god: scope.isGodMode,
        // Sort so the key is order-insensitive — the underlying SELECT has no
        // ORDER BY, so row order across fetches isn't guaranteed.
        agents: [...scope.managedAgents].sort(),
      }
    : null

// Server-side filters (date + module) form the cache identity for the alerts
// list. Status / search are applied client-side and don't belong in the key.
const alertFiltersKey = (f: AlertFilters) => ({
  start: dateKey(f.startDate),
  end: dateKey(f.endDate),
  modules: f.modules ? [...f.modules].sort() : null,
  status: f.status ?? 'all',
  accuracy: f.accuracy ?? 'all',
  workload: f.workload ?? 'internal',
})

export function useUserScope(email: string | null | undefined) {
  return useQuery({
    queryKey: ['userScope', email],
    queryFn: () => fetchUserScope(email!),
    enabled: !!email,
    // Manager → agent mapping rarely changes within a session.
    staleTime: 5 * 60_000,
  })
}

export function useGotaEvaluations(
  scope: UserScope | null | undefined,
  startDate: Date,
  endDate: Date,
) {
  return useQuery({
    queryKey: ['gotaEvaluations', scopeKey(scope), dateKey(startDate), dateKey(endDate)],
    queryFn: () => fetchGotaEvaluations(scope!, startDate, endDate),
    enabled: !!scope,
    placeholderData: keepPreviousData,
  })
}

export function useAlerts(
  filters: AlertFilters,
  scope: UserScope | null | undefined,
) {
  return useQuery({
    queryKey: ['alerts', scopeKey(scope), alertFiltersKey(filters)],
    queryFn: () => fetchAlerts(filters, scope!),
    enabled: !!scope,
    placeholderData: keepPreviousData,
    select: rows => filterAlertWorkloadRows(rows, scope, filters.workload ?? 'internal'),
  })
}

export function useDispositionAudit(
  filters: AuditFilters,
  scope: UserScope | null | undefined,
) {
  return useQuery({
    queryKey: [
      'dispositionAudit',
      scopeKey(scope),
      {
        start: dateKey(filters.startDate),
        end: dateKey(filters.endDate),
        category: filters.category ?? 'all',
      },
    ],
    queryFn: () => fetchDispositionAudit(filters, scope!),
    enabled: !!scope,
    placeholderData: keepPreviousData,
  })
}

export function usePitchRiskCounts(
  scope: UserScope | null | undefined,
  startDate: Date,
  endDate: Date,
) {
  return useQuery({
    queryKey: [
      'pitchRiskCounts',
      scopeKey(scope),
      dateKey(startDate),
      dateKey(endDate),
    ],
    queryFn: async ({ signal }) => callsQueryValue(await fetchTeamPitchRisk(startDate, endDate, { signal })),
    enabled: !!scope,
    placeholderData: keepPreviousData,
  })
}

export function useAlertBreakdown(
  scope: UserScope | null | undefined,
  startDate: Date,
  endDate: Date,
) {
  return useQuery({
    queryKey: [
      'alertBreakdown',
      scopeKey(scope),
      dateKey(startDate),
      dateKey(endDate),
    ],
    queryFn: () => fetchAlertBreakdown(scope!, startDate, endDate),
    enabled: !!scope,
    placeholderData: keepPreviousData,
  })
}

export function useTeamRollup(
  scope: UserScope | null | undefined,
  startDate: Date,
  endDate: Date,
) {
  return useQuery({
    queryKey: [
      'teamRollup',
      scopeKey(scope),
      dateKey(startDate),
      dateKey(endDate),
    ],
    queryFn: () => fetchTeamRollup(scope!, startDate, endDate),
    enabled: !!scope,
    placeholderData: keepPreviousData,
  })
}

export function useTeamCoachingThemes(
  scope: UserScope | null | undefined,
  startDate: Date,
  endDate: Date,
) {
  return useQuery({
    queryKey: [
      'teamCoachingThemes',
      scopeKey(scope),
      dateKey(startDate),
      dateKey(endDate),
    ],
    queryFn: () => fetchTeamCoachingThemes(scope!, startDate, endDate),
    enabled: !!scope,
    placeholderData: keepPreviousData,
  })
}

// Top/bottom cohort coaching-theme comparison (PSAI-177). Cohort membership is
// computed client-side from the already-scoped team rollup, so the email lists
// themselves carry scope — both lists form the cache key.
export function useCohortCoachingThemes(
  topAgents: string[],
  bottomAgents: string[],
  startDate: Date,
  endDate: Date,
) {
  return useQuery({
    queryKey: [
      'cohortCoachingThemes',
      [...topAgents].sort(),
      [...bottomAgents].sort(),
      dateKey(startDate),
      dateKey(endDate),
    ],
    queryFn: () =>
      fetchCohortCoachingThemes(topAgents, bottomAgents, startDate, endDate),
    enabled: topAgents.length > 0 && bottomAgents.length > 0,
    placeholderData: keepPreviousData,
  })
}

export function useAgentManagerMapping(enabled: boolean) {
  return useQuery({
    queryKey: ['agentManagerMapping'],
    queryFn: fetchAgentManagerMapping,
    enabled,
    // Mapping changes only when ops edits agent_manager_mapping.
    staleTime: 5 * 60_000,
  })
}

// Date-aware mapping (issue #15). Used by god-mode breakdown so historical
// date ranges resolve "who was on Bobby's team in February" instead of "who
// is on Bobby's team today". Falls back transparently to the live snapshot
// when the migration hasn't been applied yet.
export function useAgentManagerMappingAt(asOfDate: Date, enabled: boolean) {
  return useQuery({
    queryKey: ['agentManagerMappingAt', dateKey(asOfDate)],
    queryFn: () => fetchAgentManagerMappingAt(asOfDate),
    enabled,
    staleTime: 5 * 60_000,
  })
}

export function useManagerNames(emails: string[]) {
  return useQuery({
    queryKey: ['managerNames', [...emails].sort()],
    queryFn: () => fetchManagerNames(emails),
    enabled: emails.length > 0,
    staleTime: 5 * 60_000,
  })
}

export function useAgentProfile(
  agentEmail: string | null | undefined,
  startDate: Date,
  endDate: Date,
  enabled = true,
) {
  return useQuery({
    queryKey: [
      'agentProfile',
      agentEmail,
      dateKey(startDate),
      dateKey(endDate),
    ],
    queryFn: () => fetchAgentProfile(agentEmail!, startDate, endDate),
    enabled: enabled && !!agentEmail,
    placeholderData: keepPreviousData,
  })
}

// Weekly management-insights report. Derives the prior week + trailing-month
// baseline from the selected week, then fetches all aggregate-safe windows in
// one query so the page has a single loading/error surface.
export function useInsightsReport(
  scope: UserScope | null | undefined,
  week: InsightsWindow,
) {
  const prior = priorWeekOf(week)
  const baseline = baselineFor(week)
  return useQuery({
    queryKey: [
      'insightsReport',
      scopeKey(scope),
      dateKey(week.start),
      dateKey(week.end),
    ],
    queryFn: () => fetchInsightsReport(scope!, week, prior, baseline),
    enabled: !!scope,
    placeholderData: keepPreviousData,
  })
}

/** Filters are the server query identity; page and summary never reuse different-filter rows. */
function callsFiltersKey(filters: CallsFilters) {
  return { ...filters, startDate: dateKey(filters.startDate), endDate: dateKey(filters.endDate),
    agents: [...filters.agents].sort(), dispositions: [...filters.dispositions].sort() }
}

function callsPageQuery(filters: CallsFilters, sort: CallsSort, page: number) {
  return {
    queryKey: ['callsPage', callsFiltersKey(filters), sort, page] as const,
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      callsQueryValue(
        await fetchCallsPage(filters, sort, (page - 1) * 25, 25, { signal }),
      ),
  }
}

/** The first usable page does not wait for whole-window KPIs. */
export function useCallsPage(filters: CallsFilters, sort: CallsSort, page: number) {
  return useQuery(callsPageQuery(filters, sort, page))
}

/** Prefetch only the immediate next Calls page after explicit pagination intent. */
export function usePrefetchNextCallsPage(
  filters: CallsFilters,
  sort: CallsSort,
  page: number,
  enabled: boolean,
) {
  const queryClient = useQueryClient()
  return () => {
    if (!enabled) return
    // React Query owns deduplication and cancellation through this exact query.
    void queryClient.prefetchQuery({
      ...callsPageQuery(filters, sort, page + 1),
      retry: false,
    })
  }
}

/** Counts/options load independently; changing pages or sort does not recompute them. */
export function useCallsSummary(filters: CallsFilters) {
  return useQuery({
    queryKey: ['callsSummary', callsFiltersKey(filters)],
    queryFn: async ({ signal }) => callsQueryValue(await fetchCallsSummary(filters, { signal })),
  })
}

/** Small active-agent result, cached for five minutes like the previous dropdown. */
export function useUniqueAgents() {
  return useQuery({
    queryKey: ['uniqueAgents'],
    queryFn: async ({ signal }) => {
      const since = new Date()
      since.setDate(since.getDate() - 30)
      return callsQueryValue(await fetchActiveCallAgents(since, { signal }))
    },
    staleTime: 5 * 60_000,
  })
}

export function useCallDetail(callId: string | null | undefined) {
  return useQuery({
    queryKey: ['callDetail', callId],
    queryFn: () => fetchCallDetail(callId!),
    enabled: !!callId,
  })
}

export function useAlertsForCall(
  callId: string | null | undefined,
  scope?: UserScope | null,
) {
  return useQuery({
    queryKey: ['alertsForCall', callId, scopeKey(scope)],
    queryFn: () => fetchAlertsForCall(callId!, scope),
    enabled: !!callId,
    select: rows => filterSuppressedAlertRows(rows, scope),
  })
}

// Pennie agent form feedback about the Achieve welcome-call rep, matched to
// this call (see agent-feedback-queries.ts). Empty for most calls — only
// Achieve transfers where the Pennie agent submitted the feedback form.
export function useAgentFeedbackForCall(
  callId: string | null | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ['agentFeedbackForCall', callId],
    queryFn: () => fetchAgentFeedbackForCall(callId!),
    enabled: !!callId && enabled,
    staleTime: 60_000,
  })
}

export function useAlertThread(
  callId: string | null | undefined,
  moduleName: string | null | undefined,
  scope?: UserScope | null,
  workload: AlertWorkload = 'internal',
) {
  return useQuery({
    queryKey: ['alertThread', callId, moduleName, scopeKey(scope), workload],
    queryFn: () => fetchAlertThread(callId!, moduleName!, scope, workload),
    enabled: !!callId && !!moduleName && !isSuppressedAlertModule(moduleName, scope, workload),
  })
}

// ---- admin config (PSAI-203) ----

// Resolver policy version history, latest-first. Element 0 is the active
// policy. No server-side filters, so no filter parts in the key.
export function useResolverPolicyHistory() {
  return useQuery({
    queryKey: ['admin', 'resolver-policy-history'],
    queryFn: () => fetchResolverPolicyHistory(),
  })
}

// Read-only deployed module prompts, synced from the eavesly backend on deploy.
export function useModulePrompts() {
  return useQuery({
    queryKey: ['admin', 'module-prompts'],
    queryFn: fetchModulePrompts,
    staleTime: 5 * 60_000,
  })
}

// Active CRM dispositions for the enrollment-disposition dropdown.
export function useDispositionOptions() {
  return useQuery({
    queryKey: ['admin', 'disposition-options'],
    queryFn: fetchDispositionOptions,
    staleTime: 5 * 60_000,
  })
}

// Bell dropdown feed. Realtime (useNotificationsRealtime) drives freshness;
// this slow poll is just a safety net for any socket events we miss.
export function useNotifications(email: string | null | undefined) {
  return useQuery({
    queryKey: ['notifications', email],
    queryFn: () => fetchRecentNotifications(email!),
    enabled: !!email,
    select: filterSuppressedAlertRows,
    refetchInterval: 300_000,
    refetchOnWindowFocus: false,
  })
}

// Live-updates the bell: a postgres_changes subscription on the caller's
// own notification rows invalidates the cached fetch. RLS scopes delivery
// to recipient_email; the client filter narrows the channel further.
export function useNotificationsRealtime(email: string | null | undefined) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!email) return
    const lower = email.toLowerCase()
    const channel = supabase
      .channel(`notifications:${lower}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'eavesly_notifications',
          filter: `recipient_email=eq.${lower}`,
        },
        payload => {
          const row = (payload.new ?? payload.old) as { module_name?: string | null } | null
          if (isSuppressedAlertModule(row?.module_name)) return
          queryClient.invalidateQueries({ queryKey: ['notifications', email] })
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [email, queryClient])
}
