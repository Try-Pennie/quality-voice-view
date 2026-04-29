import { useQuery, keepPreviousData } from '@tanstack/react-query'
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
  fetchAgentManagerMapping,
  fetchManagerNames,
} from '../lib/team-queries'
import {
  fetchDashboardData,
  fetchUniqueAgents,
  fetchCallDetail,
} from '../lib/queries'

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

export function useAgentManagerMapping(enabled: boolean) {
  return useQuery({
    queryKey: ['agentManagerMapping'],
    queryFn: fetchAgentManagerMapping,
    enabled,
    // Mapping changes only when ops edits agent_manager_mapping.
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

export function useAlertsForCall(callId: string | null | undefined) {
  return useQuery({
    queryKey: ['alertsForCall', callId],
    queryFn: () => fetchAlertsForCall(callId!),
    enabled: !!callId,
  })
}

export function useAlertThread(
  callId: string | null | undefined,
  moduleName: string | null | undefined,
) {
  return useQuery({
    queryKey: ['alertThread', callId, moduleName],
    queryFn: () => fetchAlertThread(callId!, moduleName!),
    enabled: !!callId && !!moduleName,
  })
}
