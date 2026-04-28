import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
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

export default function AgentProfilePage() {
  const { agentEmail: rawEmail } = useParams<{ agentEmail: string }>()
  const agentEmail = rawEmail ? decodeURIComponent(rawEmail) : ''
  const navigate = useNavigate()
  const { user } = useAuth()

  const [startDate, setStartDate] = useState<Date>(() => {
    const date = new Date()
    date.setDate(date.getDate() - 7)
    date.setHours(0, 0, 0, 0)
    return date
  })
  const [endDate, setEndDate] = useState<Date>(() => {
    const date = new Date()
    date.setHours(23, 59, 59, 999)
    return date
  })

  const { data: scope } = useUserScope(user?.email)
  const allowed =
    scope &&
    (scope.isGodMode || scope.managedAgents.includes(agentEmail))

  const { data: profileData, isPending } = useAgentProfile(
    agentEmail,
    startDate,
    endDate,
    !!scope && !!allowed,
  )
  const profile = profileData ?? null
  const loading = isPending && !profileData

  if (scope && !allowed) {
    return (
      <div className="space-y-6 animate-pennie-rise">
        <button
          type="button"
          onClick={() => navigate('/dashboard/team')}
          className="inline-flex items-center gap-1 text-sm font-semibold text-pennie-blue-dark hover:underline underline-offset-4"
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
    <div className="space-y-8 animate-pennie-rise">
      <button
        type="button"
        onClick={() => navigate('/dashboard/team')}
        className="inline-flex items-center gap-1 text-sm font-semibold text-pennie-blue-dark hover:underline underline-offset-4"
      >
        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        Back to team
      </button>

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
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
        />
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
          onSelect={callId => navigate(`/dashboard/calls/${callId}`)}
        />
      </div>
    </div>
  )
}
