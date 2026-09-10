import { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useUserScope, useAgentProfile } from '../hooks/use-queries'
import { DateRangePicker } from '../components/dashboard/DateRangePicker'
import { AgentProfileHeader } from '../components/team/AgentProfileHeader'
import { ScoreTrendChart } from '../components/team/ScoreTrendChart'
import { CSATDistributionChart } from '../components/team/CSATDistributionChart'
import { CallVolumeChart } from '../components/team/CallVolumeChart'
import { CoachingThemesPanel } from '../components/team/CoachingThemesPanel'
import { AgentAlertsPanel } from '../components/team/AgentAlertsPanel'
import { AgentRecentCalls } from '../components/team/AgentRecentCalls'
import { ChevronLeft } from 'lucide-react'
import { formatDateParam, parseDateParam } from '../lib/url-filters'
import { defaultAlertWindow } from '../lib/alert-review-queue'
import { RefreshingHint } from '../components/ui/refreshing-hint'
import { ErrorState } from '@/components/states/ErrorState'

export default function AgentProfilePage() {
  const { agentEmail: rawEmail } = useParams<{ agentEmail: string }>()
  const agentEmail = rawEmail ? decodeURIComponent(rawEmail) : ''
  const navigate = useNavigate()
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  // Agent drilldown shares the Review workspace's 30-day ET default.
  const [defaultDates] = useState(() => defaultAlertWindow(new Date()))
  const [startDate, setStartDate] = useState<Date>(() =>
    parseDateParam(searchParams.get('start'), defaultDates.start),
  )
  const [endDate, setEndDate] = useState<Date>(() =>
    parseDateParam(searchParams.get('end'), defaultDates.end, true),
  )

  useEffect(() => {
    const params = new URLSearchParams(searchParams)
    params.set('start', formatDateParam(startDate))
    params.set('end', formatDateParam(endDate))
    setSearchParams(params, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate])

  const teamPath = `/dashboard/team?start=${formatDateParam(startDate)}&end=${formatDateParam(endDate)}`
  const { data: scope, isError: scopeError, refetch: refetchScope } = useUserScope(user?.email)
  const allowed =
    scope &&
    (scope.isGodMode || scope.managedAgents.includes(agentEmail))

  const { data: profileData, isPending, isFetching, isError, refetch } = useAgentProfile(
    agentEmail,
    startDate,
    endDate,
    !!scope && !!allowed,
  )
  const profile = profileData ?? null
  const loading = isPending && !profileData
  const refreshing = isFetching && !loading

  if (scopeError) {
    return (
      <div className="space-y-6 animate-pennie-rise">
        <ErrorState
          title="Couldn't load your access"
          message="We couldn't determine which agents you manage. Retry to reload."
          onRetry={() => refetchScope()}
        />
      </div>
    )
  }

  if (scope && !allowed) {
    return (
      <div className="space-y-6 animate-pennie-rise">
        <button
          type="button"
          onClick={() => navigate(teamPath)}
          className="inline-flex items-center gap-1 text-sm font-semibold text-pennie-blue-deeper hover:underline underline-offset-4"
        >
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          Back to team
        </button>
        <div className="text-center py-12 bg-pennie-white rounded-3xl shadow-resting">
          <p className="text-pennie-graphite font-medium">
            This agent isn't on your team.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 sm:space-y-8 animate-pennie-rise">
      <button
        type="button"
        onClick={() => navigate(teamPath)}
        className="inline-flex items-center gap-1 text-sm font-semibold text-pennie-blue-deeper hover:underline underline-offset-4"
      >
        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        Back to team
      </button>

      {isError && !loading ? (
        <ErrorState
          title="Couldn't load this agent"
          message="We hit an error loading this profile. Retry to reload."
          onRetry={() => refetch()}
        />
      ) : (
        <>
          <AgentProfileHeader
            agentEmail={agentEmail}
            profile={profile}
            loading={loading}
            startDate={startDate}
            endDate={endDate}
          />

          <div className="flex flex-wrap items-center justify-between gap-4">
            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              onRangeChange={(start, end) => {
                setStartDate(start)
                setEndDate(end)
              }}
            />
            <RefreshingHint active={refreshing} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <ScoreTrendChart points={profile?.trend ?? []} loading={loading} />
            <CSATDistributionChart points={profile?.trend ?? []} loading={loading} />
            <CallVolumeChart points={profile?.trend ?? []} loading={loading} />
          </div>

          <CoachingThemesPanel themes={profile?.coaching_themes ?? null} loading={loading} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AgentAlertsPanel alerts={profile?.alerts ?? []} loading={loading} />
            <AgentRecentCalls
              calls={profile?.recent_calls ?? []}
              loading={loading}
              onSelect={callId => navigate(`/dashboard/calls/${callId}?start=${formatDateParam(startDate)}&end=${formatDateParam(endDate)}`)}
            />
          </div>
        </>
      )}
    </div>
  )
}
