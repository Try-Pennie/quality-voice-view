import { useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Printer, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useUserScope, useInsightsReport } from '../hooks/use-queries'
import {
  previousCompleteWeek,
  weekFromParam,
  mondayParam,
  priorWeekOf,
  delta,
  type Delta,
  type InsightsWindow,
  type WatchlistEntry,
  type TopAgent,
  type ModulePressure,
  type ModelAccuracyModule,
  type Insight,
  type ManagerAction,
} from '../lib/insights-queries'
import { PageHero, SupportingStat } from '../components/PageHero'
import { ErrorState } from '@/components/states/ErrorState'
import { CardSkeleton } from '@/components/states/skeletons'
import { RefreshingHint } from '../components/ui/refreshing-hint'

const CARD = 'bg-pennie-white rounded-3xl shadow-resting p-6 break-inside-avoid'

function fmtRate(v: number | null): string {
  return v == null ? '—' : `${v}%`
}

// Latest complete week's Monday, used to disable "next" past the most recent
// reportable window.
function latestMondayParam(): string {
  return mondayParam(previousCompleteWeek())
}

function DeltaPill({
  d,
  good,
  unit = 'pts',
}: {
  d: Delta
  good: 'up' | 'down' | 'neutral'
  unit?: 'pts' | '%'
}) {
  if (d.abs == null || (unit === '%' && d.pct == null)) {
    return <span className="text-[11px] text-muted-foreground">no prior data</span>
  }
  const isGood =
    good === 'neutral' ? null : d.dir === 'flat' ? null : d.dir === good
  const tone =
    isGood == null
      ? 'text-pennie-graphite/70 bg-pennie-beige'
      : isGood
        ? 'text-emerald-700 bg-emerald-50'
        : 'text-pennie-peach-dark bg-pennie-beige'
  const Icon = d.dir === 'up' ? TrendingUp : d.dir === 'down' ? TrendingDown : Minus
  const val = unit === 'pts' ? Math.round(d.abs) : Math.round(d.pct ?? 0)
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${tone}`}
    >
      <Icon className="w-3 h-3" aria-hidden="true" />
      {val > 0 ? '+' : ''}
      {val}
      {unit === 'pts' ? ' pts' : '%'} WoW
    </span>
  )
}

const PRIORITY_STYLE: Record<ManagerAction['priority'], string> = {
  high: 'text-pennie-peach-dark bg-pennie-peach-dark/10',
  medium: 'text-pennie-blue-deeper bg-pennie-blue-dark/10',
  low: 'text-pennie-graphite/70 bg-pennie-beige',
}

function ActionQueue({
  actions,
  onNavigate,
}: {
  actions: ManagerAction[]
  onNavigate: (to: string) => void
}) {
  return (
    <section className={CARD}>
      <h2 className="text-lg font-semibold text-pennie-navy">Weekly action queue</h2>
      <p className="mt-1 text-sm text-pennie-graphite/70">
        What to do this week, highest priority first. Generated from this week’s
        aggregate metrics — AI/QA signals are directional, so validate before coaching.
      </p>
      <ol className="mt-4 space-y-3">
        {actions.map(a => (
          <li
            key={a.id}
            className="border-t border-border/60 pt-3 first:border-t-0 first:pt-0 break-inside-avoid"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PRIORITY_STYLE[a.priority]}`}
                  >
                    {a.priority}
                  </span>
                  <span className="text-[11px] font-medium uppercase tracking-wide text-pennie-graphite/50">
                    {a.category}
                  </span>
                </div>
                <h3 className="mt-1.5 text-sm font-semibold text-pennie-navy">{a.title}</h3>
                <p className="mt-1 text-sm text-pennie-graphite/80">{a.detail}</p>
                <p className="mt-1 text-sm text-pennie-graphite">
                  <span className="font-semibold">Do:</span> {a.action}
                </p>
              </div>
              {a.link && (
                <button
                  type="button"
                  onClick={() => onNavigate(a.link!.to)}
                  className="pennie-focus-ring flex-none rounded-full border border-border px-3 py-1 text-xs font-semibold text-pennie-blue-deeper hover:bg-pennie-beige transition-colors no-print print:hidden"
                >
                  {a.link.label}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function InsightCard({ insight }: { insight: Insight }) {
  const tone =
    insight.tone === 'positive'
      ? 'border-l-emerald-400'
      : insight.tone === 'warning'
        ? 'border-l-pennie-peach-dark'
        : 'border-l-pennie-blue-dark'
  return (
    <div className={`${CARD} border-l-4 ${tone}`}>
      <h3 className="text-base font-semibold text-pennie-navy">{insight.title}</h3>
      <p className="mt-1.5 text-sm text-pennie-graphite/80">{insight.detail}</p>
    </div>
  )
}

function Watchlist({ rows }: { rows: WatchlistEntry[] }) {
  if (rows.length === 0) {
    return (
      <div className={CARD}>
        <h2 className="text-lg font-semibold text-pennie-navy">Coaching watchlist</h2>
        <p className="mt-2 text-sm text-pennie-graphite/70">
          No agents crossed a coaching threshold this week. Nice and quiet.
        </p>
      </div>
    )
  }
  return (
    <div className={CARD}>
      <h2 className="text-lg font-semibold text-pennie-navy">Coaching watchlist</h2>
      <p className="mt-1 text-sm text-pennie-graphite/70">
        Agents (≥5 graded calls) flagged on at least one signal this week. Start here.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-pennie-graphite/60">
              <th className="py-2 pr-4 font-semibold">Agent</th>
              <th className="py-2 pr-4 font-semibold text-right">Calls</th>
              <th className="py-2 pr-4 font-semibold text-right">QA'd</th>
              <th className="py-2 pr-4 font-semibold text-right">Compliance</th>
              <th className="py-2 pr-4 font-semibold text-right">Escalation</th>
              <th className="py-2 pr-4 font-semibold text-right">Open alerts</th>
              <th className="py-2 font-semibold">Why flagged</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.agent_email} className="border-t border-border/60 align-top">
                <td className="py-3 pr-4">
                  <div className="font-medium text-pennie-navy">
                    {r.agent_full_name || r.agent_email}
                  </div>
                  {r.agent_full_name && (
                    <div className="text-xs text-pennie-graphite/60">{r.agent_email}</div>
                  )}
                </td>
                <td className="py-3 pr-4 text-right tabular-nums">{r.call_count}</td>
                <td className="py-3 pr-4 text-right tabular-nums">{r.qa_count}</td>
                <td className="py-3 pr-4 text-right tabular-nums">
                  {r.compliance_pass_rate}%
                  {r.compliance_delta_pts != null && r.compliance_delta_pts <= -10 && (
                    <span className="ml-1 text-xs text-pennie-peach-dark">
                      ▼{Math.abs(r.compliance_delta_pts)}
                    </span>
                  )}
                </td>
                <td className="py-3 pr-4 text-right tabular-nums">{r.escalation_rate}%</td>
                <td className="py-3 pr-4 text-right tabular-nums">
                  {r.unreviewed_alerts || '—'}
                </td>
                <td className="py-3 text-pennie-graphite/80">{r.reasons.join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TopAgents({
  rows,
  onSelect,
}: {
  rows: TopAgent[]
  onSelect: (email: string) => void
}) {
  return (
    <div className={CARD}>
      <h2 className="text-lg font-semibold text-pennie-navy">Top performers</h2>
      <p className="mt-1 text-sm text-pennie-graphite/70">
        Highest compliance among agents with ≥5 graded calls this week.
      </p>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-pennie-graphite/70">
          Not enough graded volume this week to rank agents.
        </p>
      ) : (
        <ol className="mt-4 space-y-2">
          {rows.map((r, i) => (
            <li key={r.agent_email}>
              <button
                type="button"
                onClick={() => onSelect(r.agent_email)}
                className="pennie-focus-ring flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left hover:bg-pennie-beige transition-colors print:hover:bg-transparent"
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span className="flex-none w-5 text-pennie-graphite/50 tabular-nums">
                    {i + 1}
                  </span>
                  <span className="truncate font-medium text-pennie-navy">
                    {r.agent_full_name || r.agent_email}
                  </span>
                </span>
                <span className="flex-none text-sm tabular-nums text-pennie-graphite/80">
                  {r.compliance_pass_rate}% comp · {r.csat_high_rate}% CSAT · {r.qa_count} QA'd / {r.call_count} calls
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function ModulePressureCard({ rows }: { rows: ModulePressure[] }) {
  return (
    <div className={CARD}>
      <h2 className="text-lg font-semibold text-pennie-navy">Alert &amp; module pressure</h2>
      <p className="mt-1 text-sm text-pennie-graphite/70">
        Violations by module this week vs the trailing-month weekly average. AI
        alerts are directional — confirm in the alert queue before acting.
      </p>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-pennie-graphite/70">No alerts fired this week.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-pennie-graphite/60">
                <th className="py-2 pr-4 font-semibold">Module</th>
                <th className="py-2 pr-4 font-semibold text-right">This week</th>
                <th className="py-2 pr-4 font-semibold text-right">Unreviewed</th>
                <th className="py-2 pr-4 font-semibold text-right">Trailing avg/wk</th>
                <th className="py-2 font-semibold">Trend</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.module} className="border-t border-border/60">
                  <td className="py-3 pr-4 font-medium text-pennie-navy">{r.label}</td>
                  <td className="py-3 pr-4 text-right tabular-nums">{r.total}</td>
                  <td className="py-3 pr-4 text-right tabular-nums">{r.unreviewed || '—'}</td>
                  <td className="py-3 pr-4 text-right tabular-nums text-pennie-graphite/70">
                    {r.baselineWeeklyAvg}
                  </td>
                  <td className="py-3">
                    {r.rising ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-pennie-peach-dark">
                        <TrendingUp className="w-3 h-3" aria-hidden="true" /> Rising
                      </span>
                    ) : (
                      <span className="text-xs text-pennie-graphite/50">Steady</span>
                    )}
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

function ModelAccuracyCard({ rows }: { rows: ModelAccuracyModule[] }) {
  return (
    <div className={CARD}>
      <h2 className="text-lg font-semibold text-pennie-navy">Where the QA model is getting it wrong</h2>
      <p className="mt-1 text-sm text-pennie-graphite/70">
        False-positive alerts managers overturned, grouped by reason — the
        signal for tuning the QA prompts. Trailing ~5 weeks.
      </p>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-pennie-graphite/70">
          No alerts have been marked inaccurate in this window — nothing to tune.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-pennie-graphite/60">
                <th className="py-2 pr-4 font-semibold">Module</th>
                <th className="py-2 pr-4 font-semibold text-right">Overturned</th>
                <th className="py-2 font-semibold">Why the model was wrong</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.module} className="border-t border-border/60 align-top">
                  <td className="py-3 pr-4 font-medium text-pennie-navy">{r.label}</td>
                  <td className="py-3 pr-4 text-right tabular-nums">{r.total}</td>
                  <td className="py-3 text-pennie-graphite/70">
                    {r.reasons
                      .map(reason => `${reason.count} ${reason.label}`)
                      .join(', ')}
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

export default function SalesFloorInsightsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // Selected week comes from ?week=YYYY-MM-DD (the Monday); defaults to the
  // previous complete Mon–Sun business week in ET.
  const week: InsightsWindow = useMemo(
    () => weekFromParam(searchParams.get('week')) ?? previousCompleteWeek(),
    [searchParams],
  )
  const prior = useMemo(() => priorWeekOf(week), [week])
  const latestParam = latestMondayParam()
  const isLatest = mondayParam(week) >= latestParam

  const setWeek = (w: InsightsWindow) => {
    const params = new URLSearchParams(searchParams)
    if (mondayParam(w) >= latestParam) params.delete('week')
    else params.set('week', mondayParam(w))
    setSearchParams(params, { replace: true })
  }

  const { data: scope, isError: scopeError, refetch: refetchScope } = useUserScope(user?.email)
  const {
    data: report,
    isPending,
    isFetching,
    isError,
    refetch,
  } = useInsightsReport(scope, week)

  const loading = isPending && !report
  const refreshing = isFetching && !loading
  const noAgents = scope && !scope.isGodMode && scope.managedAgents.length === 0

  const t = report?.team
  const compWoW = t ? delta(t.current.compliancePassRate, t.prior.compliancePassRate) : null
  const csatWoW = t ? delta(t.current.csatHighRate, t.prior.csatHighRate) : null
  const escWoW = t ? delta(t.current.escalationRate, t.prior.escalationRate) : null
  const callsWoW = t ? delta(t.current.callCount, t.prior.callCount, 1) : null

  const goToAgent = (email: string) =>
    navigate(`/dashboard/team/${encodeURIComponent(email)}`)

  return (
    <div className="space-y-6 sm:space-y-8 animate-pennie-rise">
      {/* Controls — hidden in print/PDF output. */}
      <div className="flex flex-wrap items-center justify-between gap-3 no-print print:hidden">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeek(prior)}
            className="pennie-focus-ring inline-flex items-center gap-1 min-h-[40px] px-3 rounded-full bg-pennie-white border border-border text-sm font-semibold text-pennie-graphite hover:bg-pennie-beige transition-colors"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" /> Previous week
          </button>
          <button
            type="button"
            disabled={isLatest}
            onClick={() => setWeek(nextWeekOf(week))}
            className="pennie-focus-ring inline-flex items-center gap-1 min-h-[40px] px-3 rounded-full bg-pennie-white border border-border text-sm font-semibold text-pennie-graphite hover:bg-pennie-beige transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next week <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
          {!isLatest && (
            <button
              type="button"
              onClick={() => setWeek(previousCompleteWeek())}
              className="pennie-focus-ring min-h-[40px] px-3 rounded-full text-sm font-semibold text-pennie-blue-deeper hover:underline underline-offset-4"
            >
              Jump to latest
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <RefreshingHint active={refreshing} />
          <button
            type="button"
            onClick={() => window.print()}
            className="pennie-focus-ring inline-flex items-center gap-2 min-h-[40px] px-4 rounded-full bg-pennie-navy text-sm font-semibold text-pennie-white hover:bg-pennie-navy/90 transition-colors"
          >
            <Printer className="w-4 h-4" aria-hidden="true" /> Print / PDF
          </button>
        </div>
      </div>

      {scopeError ? (
        <ErrorState
          title="Couldn't load your access"
          message="We couldn't determine which agents you manage. Retry to reload."
          onRetry={() => refetchScope()}
        />
      ) : noAgents ? (
        <div className="text-center py-12 bg-pennie-white rounded-3xl shadow-resting">
          <p className="text-pennie-graphite font-medium">No agents are assigned to you yet.</p>
          <p className="text-sm text-pennie-graphite/70 mt-2">
            Talk to an admin to set up your team mapping.
          </p>
        </div>
      ) : isError ? (
        <ErrorState
          title="Couldn't build the insights report"
          message="We hit an error assembling this week's report. Retry to reload."
          onRetry={() => refetch()}
        />
      ) : (
        <>
          <PageHero
            label={`Sales floor insights · ${week.label}${scope?.isGodMode ? ' · all teams' : ''}`}
            headline={
              loading ? 'Loading…' : <>Weekly management report</>
            }
            description="Where the floor stands this week, how it moved week over week and against the trailing month, and who to coach next. All figures are aggregate and Eastern-time."
            statsCols="grid-cols-2 sm:grid-cols-4"
            stats={
              t ? (
                <>
                  <SupportingStat
                    label="Compliance"
                    value={fmtRate(t.current.compliancePassRate)}
                    hint={undefined}
                  />
                  <SupportingStat
                    label="CSAT high"
                    value={fmtRate(t.current.csatHighRate)}
                  />
                  <SupportingStat
                    label="Escalation"
                    value={fmtRate(t.current.escalationRate)}
                  />
                  <SupportingStat label="Calls" value={t.current.callCount} />
                </>
              ) : undefined
            }
          />

          {/* WoW delta strip */}
          {t && (
            <div className="flex flex-wrap gap-2">
              {compWoW && (
                <span className="inline-flex items-center gap-2 text-xs text-pennie-graphite/70">
                  Compliance <DeltaPill d={compWoW} good="up" />
                </span>
              )}
              {csatWoW && (
                <span className="inline-flex items-center gap-2 text-xs text-pennie-graphite/70">
                  CSAT <DeltaPill d={csatWoW} good="up" />
                </span>
              )}
              {escWoW && (
                <span className="inline-flex items-center gap-2 text-xs text-pennie-graphite/70">
                  Escalation <DeltaPill d={escWoW} good="down" />
                </span>
              )}
              {callsWoW && (
                <span className="inline-flex items-center gap-2 text-xs text-pennie-graphite/70">
                  Volume <DeltaPill d={callsWoW} good="neutral" unit="%" />
                </span>
              )}
              <span className="text-xs text-pennie-graphite/50">
                vs {prior.label} · trailing month: {report?.baseline.label}
              </span>
            </div>
          )}

          {loading || !report ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <CardSkeleton lines={3} />
              <CardSkeleton lines={3} />
              <CardSkeleton lines={4} />
              <CardSkeleton lines={4} />
            </div>
          ) : (
            <>
              <ActionQueue actions={report.actionQueue} onNavigate={navigate} />

              <section>
                <h2 className="pennie-label mb-3">Action insights</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {report.insights.map((ins, i) => (
                    <InsightCard key={i} insight={ins} />
                  ))}
                </div>
              </section>

              <Watchlist rows={report.watchlist} />

              <div className="grid gap-4 lg:grid-cols-2">
                <TopAgents rows={report.topAgents} onSelect={goToAgent} />
                <ModulePressureCard rows={report.modulePressure} />
              </div>

              <ModelAccuracyCard rows={report.modelAccuracy} />

              <div className="rounded-3xl bg-pennie-beige/60 p-5 text-xs text-pennie-graphite/70 break-inside-avoid">
                <p className="font-semibold text-pennie-navy mb-1">How to read this report</p>
                <p>
                  Figures cover {report.current.label} (Mon–Sun, ET) for{' '}
                  {scope?.isGodMode ? 'all teams' : 'your team'}. Rates are
                  volume-weighted across graded calls; compliance, CSAT, and
                  escalation show as “—” when no graded calls landed. WoW
                  compares to {report.prior.label}; trailing-month figures use the{' '}
                  {report.baseline.label} window. Compliance/CSAT/escalation
                  signals come from an automated QA model and are directional,
                  not adjudicated truth — confirm in the alert queue and on the
                  call before coaching. Agents need ≥5 graded calls to appear on
                  the watchlist or top-performer list.
                </p>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

// Next week after the given window (its Monday + 7d). Local to the page since
// the lib only needs prior/baseline derivations.
function nextWeekOf(week: InsightsWindow): InsightsWindow {
  const monday = new Date(week.start)
  monday.setDate(monday.getDate() + 7)
  monday.setHours(0, 0, 0, 0)
  return weekFromParam(
    `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`,
  )!
}
