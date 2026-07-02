import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { History, Settings2, SlidersHorizontal, X } from 'lucide-react'
import {
  useResolverPolicyHistory,
  useDispositionOptions,
} from '@/hooks/use-queries'
import {
  saveResolverPolicy,
  DEFAULT_RESOLVER_POLICY,
  type ResolverPolicy,
  type ResolverPolicyVersion,
} from '@/lib/admin-queries'
import { ErrorState } from '@/components/states/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

const CUSTOM_DISPOSITION_VALUE = '__custom__'

function formatDateTime(iso: string): string {
  if (!iso) return 'unknown'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'unknown'
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Compare two policies for equality (order-insensitive on the campaign list).
function policiesEqual(a: ResolverPolicy, b: ResolverPolicy): boolean {
  return (
    a.enrollmentDisposition === b.enrollmentDisposition &&
    a.enrollmentMinDurationSeconds === b.enrollmentMinDurationSeconds &&
    a.warmTransferLegalStateValue === b.warmTransferLegalStateValue &&
    a.collectionsMinBalance === b.collectionsMinBalance &&
    a.excludedCampaignFriendlyIds.length === b.excludedCampaignFriendlyIds.length &&
    [...a.excludedCampaignFriendlyIds].sort().join('||') ===
      [...b.excludedCampaignFriendlyIds].sort().join('||')
  )
}

type DiffRow = { label: string; from: string; to: string }

function buildDiff(active: ResolverPolicy, next: ResolverPolicy): DiffRow[] {
  const rows: DiffRow[] = []
  if (active.enrollmentDisposition !== next.enrollmentDisposition) {
    rows.push({
      label: 'Enrollment disposition',
      from: active.enrollmentDisposition || '(none)',
      to: next.enrollmentDisposition || '(none)',
    })
  }
  if (active.enrollmentMinDurationSeconds !== next.enrollmentMinDurationSeconds) {
    rows.push({
      label: 'Minimum call duration',
      from: `${active.enrollmentMinDurationSeconds}s`,
      to: `${next.enrollmentMinDurationSeconds}s`,
    })
  }
  const activeCampaigns = [...active.excludedCampaignFriendlyIds].sort().join(', ')
  const nextCampaigns = [...next.excludedCampaignFriendlyIds].sort().join(', ')
  if (activeCampaigns !== nextCampaigns) {
    rows.push({
      label: 'Excluded campaigns',
      from: activeCampaigns || '(none)',
      to: nextCampaigns || '(none)',
    })
  }
  if (active.warmTransferLegalStateValue !== next.warmTransferLegalStateValue) {
    rows.push({
      label: 'Warm-transfer LegalState gate',
      from: active.warmTransferLegalStateValue || '(none)',
      to: next.warmTransferLegalStateValue || '(none)',
    })
  }
  if (active.collectionsMinBalance !== next.collectionsMinBalance) {
    rows.push({
      label: 'Collections minimum balance',
      from: `${active.collectionsMinBalance}`,
      to: `${next.collectionsMinBalance}`,
    })
  }
  return rows
}

function FieldHelp({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-pennie-graphite/60 mt-1.5">{children}</p>
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="pennie-label block mb-2">
      {children}
    </label>
  )
}

const inputClass =
  'min-h-[40px] w-full px-4 py-2 rounded-full bg-pennie-white border border-border text-sm text-pennie-graphite placeholder:text-pennie-graphite/40 focus:outline-none focus:ring-2 focus:ring-pennie-blue-deeper/40 focus:border-pennie-blue-deeper transition-colors'

export function ResolverPolicyEditor({ userEmail }: { userEmail: string }) {
  const queryClient = useQueryClient()
  const {
    data: history,
    isPending,
    isError,
    refetch,
  } = useResolverPolicyHistory()
  const { data: dispositionOptions } = useDispositionOptions()

  const activeVersion: ResolverPolicyVersion | null = history?.[0] ?? null
  const activePolicy = activeVersion?.policy ?? DEFAULT_RESOLVER_POLICY
  const noSeedRow = !isPending && !isError && (history?.length ?? 0) === 0

  // Form state, initialized from the active policy (or documented defaults).
  // Re-keyed by the active version id so a save/restore resets the form.
  return (
    <PolicyForm
      key={activeVersion?.id ?? 'defaults'}
      userEmail={userEmail}
      history={history ?? []}
      activeVersion={activeVersion}
      activePolicy={activePolicy}
      dispositionOptions={dispositionOptions ?? []}
      isPending={isPending}
      isError={isError}
      noSeedRow={noSeedRow}
      onRetry={() => refetch()}
      onSaved={() =>
        queryClient.invalidateQueries({
          queryKey: ['admin', 'resolver-policy-history'],
        })
      }
    />
  )
}

function PolicyForm({
  userEmail,
  history,
  activeVersion,
  activePolicy,
  dispositionOptions,
  isPending,
  isError,
  noSeedRow,
  onRetry,
  onSaved,
}: {
  userEmail: string
  history: ResolverPolicyVersion[]
  activeVersion: ResolverPolicyVersion | null
  activePolicy: ResolverPolicy
  dispositionOptions: string[]
  isPending: boolean
  isError: boolean
  noSeedRow: boolean
  onRetry: () => void
  onSaved: () => void
}) {
  const [disposition, setDisposition] = useState(activePolicy.enrollmentDisposition)
  const [duration, setDuration] = useState(
    String(activePolicy.enrollmentMinDurationSeconds),
  )
  const [campaigns, setCampaigns] = useState<string[]>(
    activePolicy.excludedCampaignFriendlyIds,
  )
  const [campaignDraft, setCampaignDraft] = useState('')
  const [legalState, setLegalState] = useState(activePolicy.warmTransferLegalStateValue)
  const [collections, setCollections] = useState(
    String(activePolicy.collectionsMinBalance),
  )

  // Whether the disposition is being entered as free text (an exact CRM string
  // that isn't in the active dropdown list, or a deliberate custom value).
  const dispositionInList =
    disposition === '' || dispositionOptions.includes(disposition)
  const [customDisposition, setCustomDisposition] = useState(!dispositionInList)

  const [summary, setSummary] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  // A pending restore holds the version being restored so confirm applies it
  // instead of the edited form.
  const [restoreTarget, setRestoreTarget] = useState<ResolverPolicyVersion | null>(null)

  const durationNum = Number(duration)
  const collectionsNum = Number(collections)

  const draftPolicy: ResolverPolicy = useMemo(
    () => ({
      enrollmentDisposition: disposition.trim(),
      enrollmentMinDurationSeconds: Math.trunc(durationNum),
      excludedCampaignFriendlyIds: campaigns,
      warmTransferLegalStateValue: legalState.trim(),
      collectionsMinBalance: collectionsNum,
    }),
    [disposition, durationNum, campaigns, legalState, collectionsNum],
  )

  const validation = useMemo(() => {
    if (!draftPolicy.enrollmentDisposition) return 'Pick or enter an enrollment disposition.'
    if (!Number.isInteger(durationNum) || durationNum <= 0)
      return 'Minimum call duration must be a whole number greater than 0.'
    if (!draftPolicy.warmTransferLegalStateValue)
      return 'Warm-transfer LegalState gate value is required.'
    if (Number.isNaN(collectionsNum) || collectionsNum < 0)
      return 'Collections minimum balance must be 0 or greater.'
    return null
  }, [draftPolicy, durationNum, collectionsNum])

  const changed = !policiesEqual(activePolicy, draftPolicy)
  const canSave = changed && !validation && !isPending && !isError

  const diff = useMemo(
    () => (restoreTarget ? buildDiff(activePolicy, restoreTarget.policy) : buildDiff(activePolicy, draftPolicy)),
    [activePolicy, draftPolicy, restoreTarget],
  )

  function addCampaign() {
    const v = campaignDraft.trim()
    if (!v) return
    if (!campaigns.includes(v)) setCampaigns([...campaigns, v])
    setCampaignDraft('')
  }

  function openSaveDialog() {
    setRestoreTarget(null)
    setSummary('')
    setConfirmOpen(true)
  }

  function openRestoreDialog(version: ResolverPolicyVersion) {
    setRestoreTarget(version)
    setSummary(`Restore version ${version.id}`)
    setConfirmOpen(true)
  }

  async function handleConfirm() {
    const policyToSave = restoreTarget ? restoreTarget.policy : draftPolicy
    const trimmedSummary = summary.trim()
    if (!trimmedSummary) {
      toast.error('Add a short note describing what changed and why.')
      return
    }
    setSaving(true)
    try {
      await saveResolverPolicy(policyToSave, userEmail, trimmedSummary)
      toast.success(
        restoreTarget
          ? `Restored version ${restoreTarget.id} as the active policy.`
          : 'Saved. New calls use the updated policy.',
      )
      setConfirmOpen(false)
      setRestoreTarget(null)
      onSaved()
    } catch (err: any) {
      const message =
        err?.message?.includes('row-level security') || err?.code === '42501'
          ? "You don't have permission to change the resolver policy."
          : err?.message ||
            'Could not save the policy. The resolver policy table may not exist yet.'
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  if (isError) {
    return (
      <ErrorState
        title="Couldn't load the resolver policy"
        message="We hit an error loading the policy history. If the backend table hasn't been created yet, this is expected — retry once it's applied."
        onRetry={onRetry}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Active policy summary */}
      <section className="pennie-card space-y-5">
        <div className="flex items-start gap-4">
          <div className="pennie-icon-chip bg-pennie-blue-light flex-none">
            <Settings2 className="w-5 h-5 text-pennie-blue-deeper" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-pennie-navy">
              Resolver trigger policy
            </h2>
            <p className="text-sm text-pennie-graphite/70 mt-1 max-w-prose">
              These rules decide which QA modules run on future calls. full_qa
              runs on every transcript and disposition_review on every completed
              call — neither is gated here. The rules below gate the
              enrollment-based modules.
            </p>
          </div>
        </div>

        {isPending ? (
          <Skeleton className="h-16 w-full rounded-2xl" />
        ) : activeVersion ? (
          <div className="rounded-2xl bg-pennie-beige/60 px-5 py-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-sm font-semibold text-pennie-navy">
              Version {activeVersion.id}
            </span>
            <span className="text-xs text-pennie-graphite/70">
              Last changed by {activeVersion.createdBy || 'unknown'} ·{' '}
              {formatDateTime(activeVersion.createdAt)}
            </span>
            {activeVersion.changeSummary && (
              <span className="text-xs text-pennie-graphite/70 w-full mt-1">
                “{activeVersion.changeSummary}”
              </span>
            )}
          </div>
        ) : noSeedRow ? (
          <div
            role="note"
            className="rounded-2xl bg-pennie-yellow-light px-5 py-4 text-sm text-pennie-navy"
          >
            No policy has been saved yet. The form below is pre-filled with the
            documented defaults — the backend seed row hasn't been applied.
            Saving will create the first version.
          </div>
        ) : null}
      </section>

      {/* Edit form */}
      <section className="pennie-card space-y-6">
        <div className="flex items-start gap-4">
          <div className="pennie-icon-chip bg-pennie-beige flex-none">
            <SlidersHorizontal className="w-5 h-5 text-pennie-navy" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-pennie-navy">Edit policy</h3>
            <p className="text-sm text-pennie-graphite/70 mt-1">
              A call counts as an enrollment when the disposition matches exactly,
              the call runs longer than the minimum, and the campaign isn't
              excluded.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Enrollment disposition */}
          <div>
            <Label htmlFor="policy-disposition">Enrollment disposition</Label>
            {customDisposition || dispositionOptions.length === 0 ? (
              <>
                <Input
                  id="policy-disposition"
                  value={disposition}
                  onChange={e => setDisposition(e.target.value)}
                  placeholder="Exact CRM disposition string"
                  className={inputClass}
                />
                {dispositionOptions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomDisposition(false)
                      setDisposition('')
                    }}
                    className="pennie-focus-ring text-xs font-semibold text-pennie-blue-deeper hover:underline underline-offset-4 mt-1.5"
                  >
                    Pick from the disposition list instead
                  </button>
                )}
              </>
            ) : (
              <Select
                value={disposition || undefined}
                onValueChange={v => {
                  if (v === CUSTOM_DISPOSITION_VALUE) {
                    setCustomDisposition(true)
                    setDisposition('')
                  } else {
                    setDisposition(v)
                  }
                }}
              >
                <SelectTrigger id="policy-disposition" className="rounded-full min-h-[40px]">
                  <SelectValue placeholder="Select a disposition" />
                </SelectTrigger>
                <SelectContent>
                  {dispositionOptions.map(opt => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_DISPOSITION_VALUE}>
                    Enter a custom value…
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
            <FieldHelp>
              The exact CRM disposition string that marks an enrollment. Enrolled
              calls trigger the program_expectations module.
            </FieldHelp>
          </div>

          {/* Minimum call duration */}
          <div>
            <Label htmlFor="policy-duration">Minimum call duration (seconds)</Label>
            <Input
              id="policy-duration"
              type="number"
              min={1}
              step={1}
              value={duration}
              onChange={e => setDuration(e.target.value)}
              className={inputClass}
            />
            <FieldHelp>
              Calls must be longer than this to count as an enrollment.
            </FieldHelp>
          </div>

          {/* Warm-transfer LegalState gate */}
          <div>
            <Label htmlFor="policy-legalstate">Warm-transfer LegalState gate value</Label>
            <Input
              id="policy-legalstate"
              value={legalState}
              onChange={e => setLegalState(e.target.value)}
              placeholder='e.g. "No"'
              className={inputClass}
            />
            <FieldHelp>
              warm_transfer runs on enrolled calls when the CRM LegalState field
              equals this value.
            </FieldHelp>
          </div>

          {/* Collections minimum balance */}
          <div>
            <Label htmlFor="policy-collections">Collections minimum balance</Label>
            <Input
              id="policy-collections"
              type="number"
              min={0}
              step={1}
              value={collections}
              onChange={e => setCollections(e.target.value)}
              className={inputClass}
            />
            <FieldHelp>
              litigation_check runs when the customer's collections balance
              exceeds this amount.
            </FieldHelp>
          </div>

          {/* Excluded campaigns — full width */}
          <div className="lg:col-span-2">
            <Label htmlFor="policy-campaign">Excluded campaign friendly IDs</Label>
            <div className="flex gap-2">
              <Input
                id="policy-campaign"
                value={campaignDraft}
                onChange={e => setCampaignDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addCampaign()
                  }
                }}
                placeholder="Type a campaign ID and press Enter"
                className={inputClass}
              />
              <button
                type="button"
                onClick={addCampaign}
                disabled={!campaignDraft.trim()}
                className="pennie-focus-ring flex-none min-h-[40px] px-4 rounded-full bg-pennie-navy text-sm font-semibold text-pennie-white hover:bg-pennie-navy/90 disabled:opacity-40 transition-colors"
              >
                Add
              </button>
            </div>
            {campaigns.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {campaigns.map(id => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-pennie-beige pl-3 pr-1.5 py-1 text-xs font-semibold text-pennie-navy"
                  >
                    {id}
                    <button
                      type="button"
                      onClick={() => setCampaigns(campaigns.filter(c => c !== id))}
                      aria-label={`Remove ${id}`}
                      className="pennie-focus-ring inline-flex items-center justify-center w-5 h-5 rounded-full text-pennie-graphite/60 hover:bg-pennie-navy hover:text-pennie-white transition-colors"
                    >
                      <X className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <FieldHelp>
              Campaigns exempt from enrollment-gated QA — enrolled calls on these
              campaigns skip the enrollment-based modules.
            </FieldHelp>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
          <p className="text-xs text-pennie-graphite/60" role="status" aria-live="polite">
            {validation
              ? validation
              : changed
                ? 'You have unsaved changes.'
                : 'No changes to save.'}
          </p>
          <button
            type="button"
            disabled={!canSave}
            onClick={openSaveDialog}
            className="pennie-focus-ring inline-flex items-center gap-2 min-h-[40px] px-5 rounded-full bg-pennie-navy text-sm font-semibold text-pennie-white hover:bg-pennie-navy/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Save policy
          </button>
        </div>
      </section>

      {/* Version history */}
      <section className="pennie-card-tight space-y-4">
        <div className="flex items-center gap-3">
          <History className="w-4 h-4 text-pennie-graphite/70" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-pennie-navy">Version history</h3>
        </div>
        {isPending ? (
          <Skeleton className="h-24 w-full rounded-2xl" />
        ) : history.length === 0 ? (
          <p className="text-sm text-pennie-graphite/60">
            No versions yet. The first save appears here.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {history.map((v, idx) => (
              <li
                key={v.id}
                className="flex flex-wrap items-start justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-pennie-navy">
                      Version {v.id}
                    </span>
                    {idx === 0 && (
                      <span className="rounded-full bg-pennie-green-light px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-pennie-green-dark">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-pennie-graphite/70 mt-0.5">
                    {v.createdBy || 'unknown'} · {formatDateTime(v.createdAt)}
                  </p>
                  {v.changeSummary && (
                    <p className="text-xs text-pennie-graphite/60 mt-0.5 max-w-prose">
                      {v.changeSummary}
                    </p>
                  )}
                </div>
                {idx !== 0 && (
                  <button
                    type="button"
                    onClick={() => openRestoreDialog(v)}
                    className="pennie-focus-ring flex-none text-xs font-semibold text-pennie-blue-deeper hover:underline underline-offset-4"
                  >
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Confirm dialog (shared by save + restore) */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="rounded-3xl bg-pennie-white border-border max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-pennie-navy">
              {restoreTarget
                ? `Restore version ${restoreTarget.id}?`
                : 'Save resolver policy changes?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-pennie-graphite">
              These rules decide which QA modules run on future calls. Changes
              take effect on the next call processed.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {diff.length > 0 ? (
            <div className="rounded-2xl bg-pennie-beige/60 px-4 py-3 space-y-2 max-h-56 overflow-y-auto">
              {diff.map(row => (
                <div key={row.label} className="text-xs">
                  <span className="font-semibold text-pennie-navy">{row.label}</span>
                  <div className="text-pennie-graphite/80 mt-0.5">
                    <span className="line-through text-pennie-graphite/50">{row.from}</span>
                    {'  →  '}
                    <span className="font-medium text-pennie-navy">{row.to}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-pennie-graphite/60">No field changes.</p>
          )}

          <div>
            <label htmlFor="policy-summary" className="pennie-label block mb-2">
              What changed and why
            </label>
            <Textarea
              id="policy-summary"
              value={summary}
              onChange={e => setSummary(e.target.value)}
              placeholder="A short note recorded with this version"
              className="min-h-[80px] rounded-2xl"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              className="rounded-full"
              disabled={saving}
              onClick={() => setRestoreTarget(null)}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-pennie-navy hover:bg-pennie-navy/90"
              disabled={saving || !summary.trim()}
              onClick={e => {
                // Keep the dialog open on failure so the user can retry.
                e.preventDefault()
                handleConfirm()
              }}
            >
              {saving ? 'Saving…' : restoreTarget ? 'Restore version' : 'Save policy'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
