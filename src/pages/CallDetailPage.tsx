import { useParams, useNavigate } from 'react-router-dom'
import { useCallDetail, useAlertsForCall } from '../hooks/use-queries'
import { formatDateTime, formatDuration, formatPhoneNumber, getScoreBadgeColor } from '../lib/utils'
import { HelpHint } from '../components/ui/help-hint'
import { AudioPlayer } from '../components/call-detail/AudioPlayer'
import { ComplianceScorecard } from '../components/call-detail/ComplianceScorecard'
import { SalesProcessScorecard } from '../components/call-detail/SalesProcessScorecard'
import { CustomerExperienceScorecard } from '../components/call-detail/CustomerExperienceScorecard'
import { CoachingRecommendations } from '../components/call-detail/CoachingRecommendations'
import { CallAlertsSection } from '../components/call-detail/CallAlertsSection'
import { ErrorState } from '@/components/states/ErrorState'
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  ClipboardList,
  Download,
  ExternalLink,
  FileText,
  Link as LinkIcon,
  PhoneIncoming,
  PhoneOutgoing,
  Volume2,
} from 'lucide-react'
import { toast } from 'sonner'

export default function CallDetailPage() {
  const { callId } = useParams()
  const navigate = useNavigate()
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
  } = useAlertsForCall(callId)
  const alerts = alertsData ?? []
  const alertsLoading = alertsPending && !alertsData

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-lg text-muted-foreground">Loading call details...</div>
      </div>
    )
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
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold text-foreground mb-4">Call not found</h2>
        <button
          onClick={() => navigate('/dashboard')}
          className="inline-flex items-center gap-2 text-primary hover:text-primary/80 font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
      </div>
    )
  }

  const qaData = call.qa?.qa_json as any

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
    <div className="space-y-6">
      {/* Back Button */}
      <button
        onClick={() => navigate('/dashboard')}
        className="inline-flex items-center gap-2 text-primary hover:text-primary/80 font-medium"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </button>

      {/* SECTION 1: Call Header */}
      <div className="bg-card rounded-lg shadow p-6 border border-border">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Call #{call.call_id}</h1>
            <div className="mt-2 space-y-1 text-sm text-muted-foreground">
              <div><strong className="text-foreground">Agent:</strong> {call.agent_full_name} ({call.agent_email})</div>
              <div><strong className="text-foreground">Date:</strong> {formatDateTime(call.started_at)} - {formatDateTime(call.ended_at)}</div>
              <div><strong className="text-foreground">Contact:</strong> {formatPhoneNumber(call.contact_phone)}</div>
              <div className="flex items-center gap-1.5">
                <strong className="text-foreground">Direction:</strong>
                {call.direction === 'inbound' ? (
                  <span className="inline-flex items-center gap-1">
                    <PhoneIncoming className="w-4 h-4 text-blue-600" /> Inbound
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <PhoneOutgoing className="w-4 h-4 text-emerald-600" /> Outbound
                  </span>
                )}
              </div>
              {call.campaign_name && <div><strong className="text-foreground">Campaign:</strong> {call.campaign_name}</div>}
            </div>
          </div>

          {call.qa?.manager_escalation && (
            <div className="bg-red-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              MANAGER ESCALATION
            </div>
          )}
        </div>
      </div>

      {/* SECTION 1.5: Alerts fired for this call */}
      {alertsError ? (
        <ErrorState compact message="Couldn't load alerts for this call." onRetry={() => refetchAlerts()} />
      ) : (
        <CallAlertsSection alerts={alerts} loading={alertsLoading} />
      )}

      {/* SECTION 2: Audio Player */}
      <div className="bg-card rounded-lg shadow p-6 border border-border">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <Volume2 className="w-5 h-5 text-blue-600" />
          Recording
        </h2>
        <AudioPlayer recordingUrl={call.qa?.recording_link} />
      </div>

      {/* SECTION 3: Call Metrics */}
      <div className="bg-card rounded-lg shadow p-6 border border-border">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-indigo-600" />
          Call Metrics
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-sm text-muted-foreground inline-flex items-center gap-1">
              Talk Time
              <HelpHint id="metric.call_talk_time" />
            </div>
            <div className="text-xl font-bold text-foreground">{formatDuration(call.talk_time)}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground inline-flex items-center gap-1">
              Handle Time
              <HelpHint id="metric.call_handle_time" />
            </div>
            <div className="text-xl font-bold text-foreground">{formatDuration(call.handle_time)}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground inline-flex items-center gap-1">
              Wrapup Time
              <HelpHint id="metric.call_wrapup_time" />
            </div>
            <div className="text-xl font-bold text-foreground">{formatDuration(call.wrapup_time)}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground inline-flex items-center gap-1">
              Conversation
              <HelpHint id="metric.call_conversation_happened" />
            </div>
            <div className="text-xl font-bold text-foreground">{call.conversation_happened ? 'Yes' : 'No'}</div>
          </div>
        </div>

        {call.qa && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-border">
            <div>
              <div className="text-sm text-muted-foreground mb-1 inline-flex items-center gap-1">
                Overall Score
                <HelpHint id="metric.call_overall_score" />
              </div>
              <span className={`inline-flex px-3 py-1 rounded-full text-sm font-semibold ${getScoreBadgeColor(call.qa.overall_score)}`}>
                {call.qa.overall_score || 'N/A'}
              </span>
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-1 inline-flex items-center gap-1">
                Compliance
                <HelpHint id="metric.call_compliance" />
              </div>
              <span className={`inline-flex px-3 py-1 rounded-full text-sm font-semibold ${getScoreBadgeColor(call.qa.compliance_rating)}`}>
                {call.qa.compliance_rating || 'N/A'}
              </span>
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-1 inline-flex items-center gap-1">
                Customer Satisfaction
                <HelpHint id="metric.call_csat" />
              </div>
              <span className={`inline-flex px-3 py-1 rounded-full text-sm font-semibold ${getScoreBadgeColor(call.qa.customer_satisfaction_likely)}`}>
                {call.qa.customer_satisfaction_likely || 'N/A'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 4: Call Summary */}
      {call.qa?.call_summary && (
        <div className="bg-card rounded-lg shadow p-6 border border-border">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-slate-600" />
            Call Summary
          </h2>
          <p className="text-sm text-foreground whitespace-pre-wrap">{call.qa.call_summary}</p>
        </div>
      )}

      {qaData?.call_overview && (
        <div className="bg-card rounded-lg shadow p-6 border border-border">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-slate-600" />
            Call Overview
          </h2>
          <div className="space-y-3 text-sm">
            <div><strong className="text-foreground">Topic:</strong> <span className="text-muted-foreground">{qaData.call_overview.call_topic}</span></div>
            <div><strong className="text-foreground">Purpose:</strong> <span className="text-muted-foreground">{qaData.call_overview.call_purpose}</span></div>
            <div><strong className="text-foreground">Outcome:</strong> <span className="text-muted-foreground">{qaData.call_overview.call_outcome}</span></div>
            <div><strong className="text-foreground">Tone:</strong> <span className="text-muted-foreground">{qaData.call_overview.overall_tone}</span></div>

            {qaData.call_overview.manager_review_required && (
              <div className="bg-yellow-50 border border-yellow-300 rounded p-3 mt-4">
                <div className="font-semibold text-yellow-900 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Manager Review Required
                </div>
                <div className="text-yellow-800 text-sm mt-1">{qaData.call_overview.manager_review_reason}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION 5: Compliance Scorecard */}
      {qaData?.compliance_scorecard && (
        <ComplianceScorecard data={qaData.compliance_scorecard} />
      )}

      {/* SECTION 6: Sales Process Scorecard */}
      {qaData?.sales_process_scorecard && (
        <SalesProcessScorecard data={qaData.sales_process_scorecard} />
      )}

      {/* SECTION 7: Customer Experience Scorecard */}
      {qaData?.customer_experience_scorecard && (
        <CustomerExperienceScorecard data={qaData.customer_experience_scorecard} />
      )}

      {/* SECTION 8: Coaching Recommendations */}
      {qaData?.coaching_recommendations && (
        <CoachingRecommendations data={qaData.coaching_recommendations} />
      )}

      {/* SECTION 9: Full Transcript */}
      {call.qa?.original_transcript && (
        <div className="bg-card rounded-lg shadow p-6 border border-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <FileText className="w-5 h-5 text-slate-600" />
              Full Transcript
            </h2>
            <button
              onClick={copyTranscript}
              className="text-sm text-primary hover:text-primary/80 font-medium"
            >
              Copy
            </button>
          </div>
          <div className="bg-muted rounded p-4 max-h-96 overflow-y-auto">
            <pre className="whitespace-pre-wrap text-sm text-foreground font-sans">
              {call.qa.original_transcript}
            </pre>
          </div>
        </div>
      )}

      {/* SECTION 10: Action Buttons */}
      <div className="flex gap-4 pb-8 flex-wrap">
        <button
          onClick={() => navigate('/dashboard')}
          className="px-6 py-3 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 font-medium inline-flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>

        <button
          onClick={handleExportPDF}
          className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          Export to PDF
        </button>

        {call.qa?.recording_link && (
          <a
            href={call.qa.recording_link}
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium flex items-center gap-2"
          >
            <LinkIcon className="w-4 h-4" />
            Open Recording
            <ExternalLink className="w-4 h-4" />
          </a>
        )}

        {call.qa?.transcription_link && (
          <a
            href={call.qa.transcription_link}
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 bg-accent text-accent-foreground rounded-lg hover:bg-accent/80 font-medium flex items-center gap-2"
          >
            <FileText className="w-4 h-4" />
            View Transcription
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>
    </div>
  )
}
