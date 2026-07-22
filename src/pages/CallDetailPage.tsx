import { useCallback, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useCallDetail, useAlertsForCall, useAgentFeedbackForCall, useUserScope } from '../hooks/use-queries'
import { useAuth } from '../hooks/useAuth'
import { agentDisplayName, formatDateTime, formatDuration, formatPhoneNumber, getScoreBadgeColor } from '../lib/utils'
import { HelpHint } from '../components/ui/help-hint'
import { pitchCallRisk, explainPitchRisk, BAND_LABEL } from '../lib/pitch-call-risk'
import { accentForBand, pillClasses } from '../lib/violation-styles'
import { extractEvidence } from '../lib/alert-queries'
import { AudioPlayer } from '../components/call-detail/AudioPlayer'
import { TranscriptView } from '../components/call-detail/TranscriptView'
import { ComplianceScorecard } from '../components/call-detail/ComplianceScorecard'
import { SalesProcessScorecard } from '../components/call-detail/SalesProcessScorecard'
import { ProgramExpectationsScorecard } from '../components/call-detail/ProgramExpectationsScorecard'
import { CustomerExperienceScorecard } from '../components/call-detail/CustomerExperienceScorecard'
import { CoachingRecommendations } from '../components/call-detail/CoachingRecommendations'
import { CallAlertsSection } from '../components/call-detail/CallAlertsSection'
import { PennieAgentFeedbackSection } from '../components/PennieAgentFeedbackSection'
import { ErrorState } from '@/components/states/ErrorState'
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Headphones,
  PhoneIncoming,
  PhoneOutgoing,
} from 'lucide-react'
import { toast } from 'sonner'

export default function CallDetailPage() {
  const { callId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { data: scope } = useUserScope(user?.email)
  const {
    data: call,
    isPending: callPending,
    isError: callError,
    refetch: refetchCall,
  } = useCallDetail(callId)
  const loading = callPending
  const {
    data: alertsData,
    isPending: alertsPending,
    isError: alertsError,
    refetch: refetchAlerts,
  } = useAlertsForCall(callId, scope)
  const alerts = useMemo(() => alertsData ?? [], [alertsData])
  const alertsLoading = alertsPending && !alertsData
  // Pennie agent form feedback about the Achieve welcome-call rep — empty for
  // most calls, so the section simply doesn't render without it.
  const { data: agentFeedback } = useAgentFeedbackForCall(callId)

  // Go back to wherever the user came from (Team drill-down, agent profile,
  // alerts queue, Calls list…). `location.key === 'default'` means this page
  // was the entry point (deep link / new tab), so fall back to the Calls list
  // instead of leaving the app.
  const goBack = useCallback(() => {
    if (location.key !== 'default') {
      navigate(-1)
    } else {
      navigate('/dashboard')
    }
  }, [navigate, location.key])

  // Evidence quotes from this call's fired alerts — used to highlight the
  // flagged passages inside the transcript (text match; no timestamps needed).
  const evidenceQuotes = useMemo(
    () =>
      alerts
        .filter(a => a.has_violation)
        .map(a => extractEvidence(a.violation_type, a.result_json))
        .filter(Boolean),
    [alerts],
  )

  if (loading) {
    return <CallDetailSkeleton />
  }

  if (callError) {
    return (
      <ErrorState
        title="Couldn't load this call"
        message="We hit an error loading the call. Retry to reload."
        onRetry={() => refetchCall()}
      />
    )
  }

  if (!call) {
    return (
      <div className="text-center py-16 bg-pennie-white rounded-3xl shadow-resting">
        <h2 className="text-2xl font-semibold text-pennie-navy mb-3">
          Call not found
        </h2>
        <button
          type="button"
          onClick={goBack}
          className="pennie-focus-ring inline-flex items-center gap-2 min-h-[40px] px-4 py-2 rounded-full text-sm font-semibold text-pennie-blue-deeper hover:bg-pennie-blue-light/50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Go back
        </button>
      </div>
    )
  }

  const qaData = call.qa?.qa_json as any
  const pitch = pitchCallRisk(call)

  const copyTranscript = () => {
    if (call.qa?.original_transcript) {
      navigator.clipboard.writeText(call.qa.original_transcript)
      toast.success('Transcript copied to clipboard')
    }
  }

  const handleExportPDF = async () => {
    if (call) {
      const { exportCallDetailToPDF } = await import('../lib/pdf-export')
      await exportCallDetailToPDF(call)
      toast.success('PDF exported successfully')
    }
  }

  return (
    <div className="space-y-6 animate-pennie-rise">
      {/* Back + actions row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={goBack}
          className="pennie-focus-ring inline-flex items-center gap-2 min-h-[40px] px-4 py-2 -ml-2 rounded-full text-sm font-semibold text-pennie-graphite hover:text-pennie-navy hover:bg-pennie-beige transition-colors"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Back
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportPDF}
            className="pennie-focus-ring inline-flex items-center gap-2 min-h-[40px] px-4 py-2 rounded-full bg-pennie-navy text-pennie-white text-sm font-semibold hover:bg-pennie-navy/90 transition-colors"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            Export PDF
          </button>
          {call.qa?.recording_link && (
            <a
              href={call.qa.recording_link}
              target="_blank"
              rel="noopener noreferrer"
              className="pennie-focus-ring inline-flex items-center gap-2 min-h-[40px] px-4 py-2 rounded-full border border-border bg-pennie-white text-sm font-semibold text-pennie-graphite hover:bg-pennie-beige transition-colors"
            >
              Open recording
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          )}
          {call.qa?.transcription_link && (
            <a
              href={call.qa.transcription_link}
              target="_blank"
              rel="noopener noreferrer"
              className="pennie-focus-ring inline-flex items-center gap-2 min-h-[40px] px-4 py-2 rounded-full border border-border bg-pennie-white text-sm font-semibold text-pennie-graphite hover:bg-pennie-beige transition-colors"
            >
              Transcription
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      </div>

      {/* SECTION 1: Call header */}
      <header className="pennie-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="pennie-label mb-2">Call detail</p>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-[-0.01em] text-pennie-navy">
              {agentDisplayName(call.agent_full_name, call.agent_email)}
            </h1>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-pennie-graphite/60 pt-0.5">
                Agent
              </dt>
              <dd className="text-pennie-graphite font-medium break-all">
                {call.agent_email || '—'}
              </dd>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-pennie-graphite/60 pt-0.5">
                When
              </dt>
              <dd className="text-pennie-graphite tabular-nums">
                {formatDateTime(call.started_at)} – {formatDateTime(call.ended_at)}
              </dd>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-pennie-graphite/60 pt-0.5">
                Contact
              </dt>
              <dd className="text-pennie-graphite tabular-nums">
                {formatPhoneNumber(call.contact_phone)}
              </dd>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-pennie-graphite/60 pt-0.5">
                Direction
              </dt>
              <dd className="text-pennie-graphite inline-flex items-center gap-1.5">
                {call.direction === 'inbound' ? (
                  <>
                    <PhoneIncoming
                      className="w-4 h-4 text-pennie-blue-deeper"
                      aria-hidden="true"
                    />
                    Inbound
                  </>
                ) : (
                  <>
                    <PhoneOutgoing
                      className="w-4 h-4 text-pennie-green-dark"
                      aria-hidden="true"
                    />
                    Outbound
                  </>
                )}
              </dd>
              {call.campaign_name && (
                <>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-pennie-graphite/60 pt-0.5">
                    Campaign
                  </dt>
                  <dd className="text-pennie-graphite">{call.campaign_name}</dd>
                </>
              )}
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-pennie-graphite/60 pt-0.5">
                Call&nbsp;ID
              </dt>
              <dd>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(call.call_id)
                    toast.success('Call ID copied')
                  }}
                  title={`Copy call ID: ${call.call_id}`}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-border bg-pennie-beige/60 text-[11px] font-mono text-pennie-graphite hover:bg-pennie-beige transition-colors"
                >
                  <span className="tracking-tight">{call.call_id}</span>
                  <Copy className="w-3 h-3 text-pennie-graphite/60" aria-hidden="true" />
                </button>
              </dd>
            </dl>
          </div>

          {call.qa?.manager_escalation && (
            <span className="pennie-pill bg-pennie-peach-light text-pennie-peach-deeper inline-flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
              Manager escalation
            </span>
          )}
        </div>
      </header>

      {/* SECTION 1.5: Alerts fired for this call */}
      {alertsError ? (
        <ErrorState compact message="Couldn't load alerts for this call." onRetry={() => refetchAlerts()} />
      ) : (
        <CallAlertsSection alerts={alerts} loading={alertsLoading} />
      )}

      {/* SECTION 1.6: Pennie agent feedback about the Achieve welcome-call rep */}
      <PennieAgentFeedbackSection feedback={agentFeedback} />

      {/* SECTION 2: Audio player */}
      <section className="pennie-card">
        <h2 className="pennie-label mb-4 inline-flex items-center gap-1.5">
          <Headphones className="w-3.5 h-3.5" aria-hidden="true" />
          Recording
        </h2>
        <AudioPlayer recordingUrl={call.qa?.recording_link} />
      </section>

      {/* SECTION 3: Call metrics */}
      <section className="pennie-card">
        <h2 className="pennie-label mb-5 inline-flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5" aria-hidden="true" />
          Call metrics
        </h2>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <dt className="pennie-label inline-flex items-center gap-1">
              Talk time
              <HelpHint id="metric.call_talk_time" />
            </dt>
            <dd className="mt-1 text-xl font-semibold text-pennie-navy tabular-nums">
              {formatDuration(call.talk_time)}
            </dd>
          </div>
          <div>
            <dt className="pennie-label inline-flex items-center gap-1">
              Handle time
              <HelpHint id="metric.call_handle_time" />
            </dt>
            <dd className="mt-1 text-xl font-semibold text-pennie-navy tabular-nums">
              {formatDuration(call.handle_time)}
            </dd>
          </div>
          <div>
            <dt className="pennie-label inline-flex items-center gap-1">
              Wrapup time
              <HelpHint id="metric.call_wrapup_time" />
            </dt>
            <dd className="mt-1 text-xl font-semibold text-pennie-navy tabular-nums">
              {formatDuration(call.wrapup_time)}
            </dd>
          </div>
          <div>
            <dt className="pennie-label inline-flex items-center gap-1">
              Conversation
              <HelpHint id="metric.call_conversation_happened" />
            </dt>
            <dd className="mt-1 text-xl font-semibold text-pennie-navy">
              {call.conversation_happened ? 'Yes' : 'No'}
            </dd>
          </div>
        </dl>

        {/* Pitch-call talk-time risk band (PSAI-178). Only shown for eligible
            pitch cohorts; non-pitch calls keep the generic threshold behavior. */}
        {pitch.isPitch && (
          <div className="mt-5 pt-5 border-t border-border flex flex-wrap items-center gap-3">
            <span className={pillClasses(accentForBand(pitch.band))}>
              {BAND_LABEL[pitch.band]}
            </span>
            <p className="text-sm text-muted-foreground">
              {explainPitchRisk(call)}{' '}
              <span className="text-pennie-graphite/70">
                Pitch bands: under 30 min rushed · 30–40 min watch · 40 min+ on
                target.
              </span>
            </p>
          </div>
        )}

        {call.qa && (
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5 pt-5 border-t border-border">
            <div>
              <dt className="pennie-label mb-1.5 inline-flex items-center gap-1">
                Overall score
                <HelpHint id="metric.call_overall_score" />
              </dt>
              <dd>
                <span className={getScoreBadgeColor(call.qa.overall_score)}>
                  {call.qa.overall_score || 'N/A'}
                </span>
              </dd>
            </div>
            <div>
              <dt className="pennie-label mb-1.5 inline-flex items-center gap-1">
                Compliance
                <HelpHint id="metric.call_compliance" />
              </dt>
              <dd>
                <span className={getScoreBadgeColor(call.qa.compliance_rating)}>
                  {call.qa.compliance_rating || 'N/A'}
                </span>
              </dd>
            </div>
            <div>
              <dt className="pennie-label mb-1.5 inline-flex items-center gap-1">
                Customer satisfaction
                <HelpHint id="metric.call_csat" />
              </dt>
              <dd>
                <span className={getScoreBadgeColor(call.qa.customer_satisfaction_likely)}>
                  {call.qa.customer_satisfaction_likely || 'N/A'}
                </span>
              </dd>
            </div>
          </dl>
        )}
      </section>

      {/* SECTION 4: Call summary */}
      {call.qa?.call_summary && (
        <section className="pennie-card">
          <h2 className="pennie-label mb-4 inline-flex items-center gap-1.5">
            <ClipboardList className="w-3.5 h-3.5" aria-hidden="true" />
            Call summary
          </h2>
          <p className="text-sm text-pennie-graphite leading-relaxed whitespace-pre-wrap">
            {call.qa.call_summary}
          </p>
        </section>
      )}

      {qaData?.call_overview && (
        <section className="pennie-card">
          <h2 className="pennie-label mb-4 inline-flex items-center gap-1.5">
            <ClipboardList className="w-3.5 h-3.5" aria-hidden="true" />
            Call overview
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-pennie-graphite/60 pt-0.5">
              Topic
            </dt>
            <dd className="text-pennie-graphite">{qaData.call_overview.call_topic}</dd>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-pennie-graphite/60 pt-0.5">
              Purpose
            </dt>
            <dd className="text-pennie-graphite">{qaData.call_overview.call_purpose}</dd>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-pennie-graphite/60 pt-0.5">
              Outcome
            </dt>
            <dd className="text-pennie-graphite">{qaData.call_overview.call_outcome}</dd>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-pennie-graphite/60 pt-0.5">
              Tone
            </dt>
            <dd className="text-pennie-graphite">{qaData.call_overview.overall_tone}</dd>
          </dl>

          {qaData.call_overview.manager_review_required && (
            <div className="bg-pennie-yellow-light/60 border border-pennie-yellow-main/50 rounded-2xl p-4 mt-4">
              <p className="font-semibold text-pennie-yellow-dark flex items-center gap-2 text-sm">
                <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                Manager review required
              </p>
              <p className="text-pennie-graphite text-sm mt-1 leading-relaxed">
                {qaData.call_overview.manager_review_reason}
              </p>
            </div>
          )}
        </section>
      )}

      {/* SECTION 5: Compliance scorecard */}
      {qaData?.compliance_scorecard && (
        <ComplianceScorecard data={qaData.compliance_scorecard} />
      )}

      {/* SECTION 6: Sales process scorecard */}
      {qaData?.sales_process_scorecard && (
        <SalesProcessScorecard data={qaData.sales_process_scorecard} />
      )}

      {/* SECTION 6.5: Program expectations — only shown when the call actually
          reached enrollment (not_applicable on ~94% of calls would be noise). */}
      {qaData?.program_expectations_scorecard &&
        qaData.program_expectations_scorecard.section_status !== 'not_applicable' && (
        <ProgramExpectationsScorecard data={qaData.program_expectations_scorecard} />
      )}

      {/* SECTION 7: Customer experience scorecard */}
      {qaData?.customer_experience_scorecard && (
        <CustomerExperienceScorecard data={qaData.customer_experience_scorecard} />
      )}

      {/* SECTION 8: Coaching recommendations */}
      {qaData?.coaching_recommendations && (
        <CoachingRecommendations data={qaData.coaching_recommendations} />
      )}

      {/* SECTION 9: Full transcript */}
      {call.qa?.original_transcript && (
        <section className="pennie-card">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="pennie-label inline-flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" aria-hidden="true" />
              Full transcript
            </h2>
            <button
              type="button"
              onClick={copyTranscript}
              className="pennie-focus-ring inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-full text-xs font-semibold text-pennie-graphite border border-border hover:bg-pennie-beige transition-colors"
            >
              <Copy className="w-3 h-3" aria-hidden="true" />
              Copy
            </button>
          </div>
          <TranscriptView
            transcript={call.qa.original_transcript}
            evidence={evidenceQuotes}
          />
        </section>
      )}
    </div>
  )
}

function CallDetailSkeleton() {
  return (
    <div className="space-y-6 animate-pennie-rise" aria-busy="true">
      <span className="block h-10 w-24 rounded-full bg-pennie-beige animate-pulse" />
      {[56, 20, 32, 24].map((h, i) => (
        <div key={i} className="pennie-card">
          <span className="block h-3 w-24 rounded-full bg-pennie-beige animate-pulse mb-4" />
          <span
            className="block rounded-2xl bg-pennie-beige animate-pulse"
            style={{ height: `${h * 4}px` }}
          />
        </div>
      ))}
      <span className="sr-only">Loading call details</span>
    </div>
  )
}
