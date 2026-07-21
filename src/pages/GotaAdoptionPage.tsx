import { useMemo, useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { CheckCircle2, XCircle, Info } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useUserScope, useGotaEvaluations } from '../hooks/use-queries'
import {
  GOTA_PACKET_LABELS,
  aggregateGotaByAgent,
  aggregateGotaDaily,
  aggregateGotaSummary,
  type GotaEvaluation,
  type GotaPacket,
} from '../lib/gota-stats'
import { parseDateParam, formatDateParam } from '../lib/url-filters'
import { ymdInBusinessTZ } from '../lib/time-zone'
import { pillClasses } from '../lib/violation-styles'
import { PageHero, SupportingStat } from '../components/PageHero'
import { DateRangePicker } from '../components/dashboard/DateRangePicker'
import { ChartCard } from '../components/team/ChartCard'
import { ErrorState } from '@/components/states/ErrorState'
import { CardSkeleton, TableSkeleton } from '@/components/states/skeletons'
import { RefreshingHint } from '../components/ui/refreshing-hint'

const CARD = 'bg-pennie-white rounded-3xl shadow-resting p-6'

const PENNIE_NAVY = '#0a1f3d'
const PENNIE_BLUE_DARK = '#1e3a8a'
const PENNIE_GREEN_DARK = '#2f7a4f'
const PENNIE_BEIGE = '#e8e1d4'

function fmtRate(v: number | null): string {
  return v == null ? '—' : `${v}%`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function ConductedPill({ conducted }: { conducted: boolean }) {
  return conducted ? (
    <span className={pillClasses('green')}>Walkthrough</span>
  ) : (
    <span className={pillClasses('peach')}>Skipped</span>
  )
}

function PacketPill({ packet }: { packet: GotaPacket }) {
  const accent =
    packet === 'turnbull_red' ? 'peach' : packet === 'fdr_green' ? 'green' : 'navy'
  return <span className={pillClasses(accent)}>{GOTA_PACKET_LABELS[packet]}</span>
}

function AdoptionTrendCard({
  rows,
  loading,
}: {
  rows: GotaEvaluation[]
  loading: boolean
}) {
  const points = useMemo(() => aggregateGotaDaily(rows), [rows])
  const hasData = points.some(p => p.signings > 0)
  return (
    <ChartCard
      title="Adoption trend"
      subtitle="Daily signings vs guided walkthroughs, with the adoption rate"
      loading={loading}
    >
      {!hasData ? (
        <div className="h-[240px] flex items-center justify-center text-sm text-pennie-graphite/50">
          No signed Achieve enrollments in this window — only Achieve-assigned
          agents' calls are graded
        </div>
      ) : (
        <div
          role="img"
          aria-label="GOTA adoption rate and signing volume over time"
          className="h-[240px]"
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid stroke={PENNIE_BEIGE} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                stroke={PENNIE_NAVY}
                tick={{ fontSize: 11, fill: PENNIE_NAVY }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                yAxisId="count"
                stroke={PENNIE_NAVY}
                tick={{ fontSize: 11, fill: PENNIE_NAVY }}
                tickLine={false}
                axisLine={false}
                width={28}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="rate"
                orientation="right"
                domain={[0, 100]}
                stroke={PENNIE_NAVY}
                tick={{ fontSize: 11, fill: PENNIE_NAVY }}
                tickLine={false}
                axisLine={false}
                width={36}
                tickFormatter={v => `${v}%`}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: 'none',
                  boxShadow: '0 4px 16px rgba(10,31,61,0.12)',
                  fontSize: 12,
                }}
                formatter={(value: number, name: string) =>
                  name === 'Adoption %' ? [`${value}%`, name] : [value, name]
                }
              />
              <Bar
                yAxisId="count"
                dataKey="signings"
                name="Signings"
                fill={PENNIE_BLUE_DARK}
                radius={[4, 4, 0, 0]}
              />
              <Bar
                yAxisId="count"
                dataKey="conducted"
                name="Walkthroughs"
                fill={PENNIE_GREEN_DARK}
                radius={[4, 4, 0, 0]}
              />
              <Line
                yAxisId="rate"
                type="monotone"
                dataKey="adoptionRate"
                name="Adoption %"
                stroke={PENNIE_NAVY}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}

function BeatCoverageCard({
  rows,
  loading,
}: {
  rows: GotaEvaluation[]
  loading: boolean
}) {
  const summary = useMemo(() => aggregateGotaSummary(rows), [rows])
  return (
    <div className={CARD}>
      <p className="pennie-label">Walkthrough beat coverage</p>
      <p className="text-xs text-pennie-graphite/60 mt-1">
        How often each section is covered in conducted walkthroughs. Lowest bars
        are coaching targets.
      </p>
      {loading ? (
        <div className="mt-4 space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-6 rounded-full bg-pennie-beige/60 animate-pulse" />
          ))}
        </div>
      ) : summary.conducted === 0 ? (
        <p className="mt-4 text-sm text-pennie-graphite/60">
          No conducted walkthroughs in this window yet.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {summary.beatCoverage.map(beat => (
            <li key={beat.key}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-pennie-navy font-medium">{beat.label}</span>
                <span className="tabular-nums text-pennie-graphite/80">
                  {beat.rate}%{' '}
                  <span className="text-pennie-graphite/50">
                    ({beat.covered}/{summary.conducted})
                  </span>
                </span>
              </div>
              <div
                className="mt-1 h-2 rounded-full bg-pennie-beige overflow-hidden"
                role="progressbar"
                aria-valuenow={beat.rate}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${beat.label} covered on ${beat.rate}% of walkthroughs`}
              >
                <div
                  className={`h-full rounded-full ${
                    beat.rate >= 80
                      ? 'bg-pennie-green-dark'
                      : beat.rate >= 50
                        ? 'bg-pennie-yellow-dark'
                        : 'bg-pennie-peach-dark'
                  }`}
                  style={{ width: `${beat.rate}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PacketMixCard({
  rows,
  loading,
}: {
  rows: GotaEvaluation[]
  loading: boolean
}) {
  const summary = useMemo(() => aggregateGotaSummary(rows), [rows])
  const mix = summary.packetMix
  const entries: { packet: GotaPacket; count: number }[] = [
    { packet: 'fdr_green', count: mix.fdr_green },
    { packet: 'turnbull_red', count: mix.turnbull_red },
    { packet: 'unknown', count: mix.unknown },
  ]
  return (
    <div className={CARD}>
      <p className="pennie-label">Agreement packets</p>
      <p className="text-xs text-pennie-graphite/60 mt-1">
        Signed enrollments by agreement type.
      </p>
      {loading ? (
        <div className="mt-4 h-24 rounded-2xl bg-pennie-beige/60 animate-pulse" />
      ) : (
        <>
          <ul className="mt-4 space-y-2">
            {entries.map(({ packet, count }) => (
              <li key={packet} className="flex items-center justify-between">
                <PacketPill packet={packet} />
                <span className="tabular-nums text-sm text-pennie-graphite/80">{count}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-pennie-graphite/70 border-t border-border/60 pt-3">
            Welcome-call transfer on the signing call:{' '}
            <span className="font-semibold text-pennie-navy tabular-nums">
              {fmtRate(summary.wcTransferRate)}
            </span>
          </p>
        </>
      )}
    </div>
  )
}

function AgentAdoptionTable({
  rows,
  loading,
}: {
  rows: GotaEvaluation[]
  loading: boolean
}) {
  const agents = useMemo(() => aggregateGotaByAgent(rows), [rows])
  return (
    <div className={CARD}>
      <p className="pennie-label">Adoption by agent</p>
      <p className="text-xs text-pennie-graphite/60 mt-1">
        Coaching order: signed-without-GOTA first, then lowest adoption.
      </p>
      {loading ? (
        <div className="mt-4">
          <TableSkeleton rows={4} cols={6} />
        </div>
      ) : agents.length === 0 ? (
        <p className="mt-4 text-sm text-pennie-graphite/60">
          No Achieve GOTA evaluations in this window. Only enrollment calls by
          Achieve-assigned agents are graded — Beyond teams won't appear here.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-pennie-graphite/60">
                <th className="py-2 pr-4 font-semibold">Agent</th>
                <th className="py-2 pr-4 font-semibold text-right">Signings</th>
                <th className="py-2 pr-4 font-semibold text-right">Walkthroughs</th>
                <th className="py-2 pr-4 font-semibold text-right">Adoption</th>
                <th className="py-2 pr-4 font-semibold text-right">Signed w/o GOTA</th>
                <th className="py-2 pr-4 font-semibold text-right">Avg missed beats</th>
                <th className="py-2 font-semibold text-right">Last call</th>
              </tr>
            </thead>
            <tbody>
              {agents.map(a => (
                <tr key={a.agent_email} className="border-t border-border/60">
                  <td className="py-3 pr-4">
                    <Link
                      to={`/dashboard/team/${encodeURIComponent(a.agent_email)}`}
                      className="pennie-focus-ring font-medium text-pennie-navy hover:underline underline-offset-4"
                    >
                      {a.agent_email}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums">{a.signings}</td>
                  <td className="py-3 pr-4 text-right tabular-nums">{a.conducted}</td>
                  <td className="py-3 pr-4 text-right tabular-nums font-semibold">
                    {fmtRate(a.adoptionRate)}
                  </td>
                  <td
                    className={`py-3 pr-4 text-right tabular-nums ${
                      a.violations > 0 ? 'font-semibold text-pennie-peach-dark' : ''
                    }`}
                  >
                    {a.violations || '—'}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums">
                    {a.avgMissedBeats == null ? '—' : a.avgMissedBeats}
                  </td>
                  <td className="py-3 text-right text-pennie-graphite/70 whitespace-nowrap">
                    {fmtDate(a.lastCallAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RecentEvaluationsTable({
  rows,
  loading,
}: {
  rows: GotaEvaluation[]
  loading: boolean
}) {
  const recent = rows.slice(0, 25)
  return (
    <div className={CARD}>
      <p className="pennie-label">Recent evaluations</p>
      <p className="text-xs text-pennie-graphite/60 mt-1">
        Every graded enrollment call, newest first.
      </p>
      {loading ? (
        <div className="mt-4">
          <TableSkeleton rows={5} cols={5} />
        </div>
      ) : recent.length === 0 ? (
        <p className="mt-4 text-sm text-pennie-graphite/60">
          No evaluations in this window — only Achieve-assigned agents' calls
          are graded.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-pennie-graphite/60">
                <th className="py-2 pr-4 font-semibold">When</th>
                <th className="py-2 pr-4 font-semibold">Agent</th>
                <th className="py-2 pr-4 font-semibold">Walkthrough</th>
                <th className="py-2 pr-4 font-semibold">Packet</th>
                <th className="py-2 font-semibold">Missed beats</th>
              </tr>
            </thead>
            <tbody>
              {recent.map(r => {
                const target = r.has_violation
                  ? `/dashboard/alerts/${encodeURIComponent(r.call_id)}/gota_check`
                  : `/dashboard/calls/${encodeURIComponent(r.call_id)}`
                return (
                  <tr key={r.call_id} className="border-t border-border/60 align-top">
                    <td className="py-3 pr-4 whitespace-nowrap">
                      <Link
                        to={target}
                        className="pennie-focus-ring text-pennie-blue-deeper hover:underline underline-offset-4"
                      >
                        {fmtDate(r.evaluated_at)}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-pennie-graphite/90">
                      {r.agent_email ?? '—'}
                    </td>
                    <td className="py-3 pr-4">
                      {r.result.enrollment_completed ? (
                        <span className="inline-flex items-center gap-1.5">
                          {r.result.gota_conducted ? (
                            <CheckCircle2
                              className="w-4 h-4 text-pennie-green-dark"
                              aria-hidden="true"
                            />
                          ) : (
                            <XCircle
                              className="w-4 h-4 text-pennie-peach-dark"
                              aria-hidden="true"
                            />
                          )}
                          <ConductedPill conducted={r.result.gota_conducted} />
                        </span>
                      ) : (
                        <span className="text-pennie-graphite/50">No signing</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {r.result.enrollment_completed ? (
                        <PacketPill packet={r.result.gota_type} />
                      ) : (
                        <span className="text-pennie-graphite/50">—</span>
                      )}
                    </td>
                    <td className="py-3 text-pennie-graphite/70">
                      {r.result.gota_conducted
                        ? r.result.missing_beats.length === 0
                          ? 'None'
                          : r.result.missing_beats.join(', ')
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function GotaAdoptionPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  // Same ?start=&end= contract as Calls / Team / Alerts (ET business days).
  // Default window: the last 14 days — long enough to show the rollout trend
  // while the process is new.
  const [startDate, setStartDate] = useState<Date>(() =>
    parseDateParam(searchParams.get('start'), (() => {
      const [y, m, d] = ymdInBusinessTZ(new Date()).split('-').map(Number)
      const local = new Date(y, m - 1, d)
      local.setDate(local.getDate() - 13) // last 14 days inclusive
      local.setHours(0, 0, 0, 0)
      return local
    })()),
  )
  const [endDate, setEndDate] = useState<Date>(() =>
    parseDateParam(
      searchParams.get('end'),
      (() => {
        const [y, m, d] = ymdInBusinessTZ(new Date()).split('-').map(Number)
        const local = new Date(y, m - 1, d)
        local.setHours(23, 59, 59, 999)
        return local
      })(),
      true,
    ),
  )

  useEffect(() => {
    const params = new URLSearchParams(searchParams)
    params.set('start', formatDateParam(startDate))
    params.set('end', formatDateParam(endDate))
    setSearchParams(params, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate])

  const {
    data: scope,
    isError: scopeError,
    refetch: refetchScope,
  } = useUserScope(user?.email)
  const {
    data: rows,
    isPending,
    isFetching,
    isError,
    refetch,
  } = useGotaEvaluations(scope, startDate, endDate)

  const loading = isPending && !rows
  const refreshing = isFetching && !loading
  const noAgents = scope && !scope.isGodMode && scope.managedAgents.length === 0
  const summary = useMemo(() => aggregateGotaSummary(rows ?? []), [rows])

  return (
    <div className="space-y-6 sm:space-y-8 animate-pennie-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
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

      {scopeError ? (
        <ErrorState
          title="Couldn't load your access"
          message="We couldn't determine which agents you manage. Retry to reload."
          onRetry={() => refetchScope()}
        />
      ) : noAgents ? (
        <div className="text-center py-12 bg-pennie-white rounded-3xl shadow-resting">
          <p className="text-pennie-graphite font-medium">
            No agents are assigned to you yet.
          </p>
          <p className="text-sm text-pennie-graphite/70 mt-2">
            Talk to an admin to set up your team mapping.
          </p>
        </div>
      ) : isError ? (
        <ErrorState
          title="Couldn't load GOTA evaluations"
          message="We hit an error loading the Achieve GOTA data. Retry to reload."
          onRetry={() => refetch()}
        />
      ) : (
        <>
          <PageHero
            label={`Achieve GOTA${scope?.isGodMode ? ' · all teams' : ''}`}
            headline={
              loading ? (
                'Loading…'
              ) : (
                <>
                  {fmtRate(summary.adoptionRate)}{' '}
                  <span className="text-pennie-graphite/60 text-xl sm:text-2xl font-medium">
                    walkthrough adoption
                  </span>
                </>
              )
            }
            description="Adoption is the share of signed Achieve enrollments where the agent walked the client through the agreement page by page. Achieve only."
            statsCols="grid-cols-2 sm:grid-cols-4"
            stats={
              !loading ? (
                <>
                  <SupportingStat label="Signings" value={summary.signings} />
                  <SupportingStat label="Walkthroughs" value={summary.conducted} />
                  <SupportingStat label="Signed w/o GOTA" value={summary.violations} />
                  <SupportingStat label="Calls graded" value={summary.evaluated} />
                </>
              ) : undefined
            }
          />

          <div className="flex items-start gap-2 rounded-2xl bg-pennie-beige/60 px-4 py-3 text-xs text-pennie-graphite/80">
            <Info className="w-4 h-4 flex-none mt-0.5 text-pennie-blue-deeper" aria-hidden="true" />
            <p>
              In rollout: Slack alerts are paused while accuracy is validated —
              review here and in the alert queue. Grades come from an automated
              QA model, so confirm on the call before coaching.
              {summary.overturned > 0 &&
                ` ${summary.overturned} flagged call${summary.overturned === 1 ? ' has' : 's have'} already been overturned in this window.`}
            </p>
          </div>

          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <CardSkeleton lines={4} />
              <CardSkeleton lines={4} />
            </div>
          ) : (
            <>
              <AdoptionTrendCard rows={rows ?? []} loading={loading} />

              <AgentAdoptionTable rows={rows ?? []} loading={loading} />

              <div className="grid gap-4 lg:grid-cols-2">
                <BeatCoverageCard rows={rows ?? []} loading={loading} />
                <PacketMixCard rows={rows ?? []} loading={loading} />
              </div>

              <RecentEvaluationsTable rows={rows ?? []} loading={loading} />
            </>
          )}
        </>
      )}
    </div>
  )
}
