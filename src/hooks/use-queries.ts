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
  fetchPitchRiskCounts,
} from '../lib/team-queries'
import {
  fetchDashboardData,
  fetchUniqueAgents,
  fetchCallDetail,
} from '../lib/queries'
import { fetchRecentNotifications } from '../lib/notification-queries'
import {
  fetchInsightsReport,
  priorWeekOf,
  baselineFor,
  type InsightsWindow,
} from '../lib/insights-queries'
import { filterSuppressedAlertRows, isSuppressedAlertModule } from '../lib/suppressed-alerts'
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

export function useAlerts(
  filters: AlertFilters,
  scope: UserScope | null | undefined,
) {
  return useQuery({
    queryKey: ['alerts', scopeKey(scope), alertFiltersKey(filters)],
    queryFn: () => fetchAlerts(filters, scope!),
    enabled: !!scope,
    placeholderData: keepPreviousData,
    select: rows => filterSuppressedAlertRows(rows, scope),
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
    queryFn: () => fetchPitchRiskCounts(scope!, startDate, endDate),
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

export function useDashboardData(
  startDate: Date,
  endDate: Date,
  selectedAgents: string[],
) {
  return useQuery({
    queryKey: [
      'dashboardData',
      dateKey(startDate),
      dateKey(endDate),
      [...selectedAgents].sort(),
    ],
    queryFn: () => fetchDashboardData(startDate, endDate, selectedAgents),
    placeholderData: keepPreviousData,
  })
}

export function useUniqueAgents() {
  return useQuery({
    queryKey: ['uniqueAgents'],
    queryFn: fetchUniqueAgents,
    // Active-agents list is built off the last 30 days — refresh sparingly.
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

export function useAlertThread(
  callId: string | null | undefined,
  moduleName: string | null | undefined,
  scope?: UserScope | null,
) {
  return useQuery({
    queryKey: ['alertThread', callId, moduleName, scopeKey(scope)],
    queryFn: () => fetchAlertThread(callId!, moduleName!, scope),
    enabled: !!callId && !!moduleName && !isSuppressedAlertModule(moduleName, scope),
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
