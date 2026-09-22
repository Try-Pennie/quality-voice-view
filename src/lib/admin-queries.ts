import { supabase } from '@/integrations/supabase/client'

// The generated client predates these admin tables. Keep the type escape at
// each table boundary and parse JSON before it reaches the UI.
type ResolverPolicyRow = {
  id: number
  policy_json: unknown
  created_by: string | null
  change_summary: string | null
  created_at: string | null
}
type ModulePromptRow = {
  module_name: string | null
  prompt_text: string | null
  deployed_at: string | null
}
type DispositionRow = { name: string | null }

// Mirror of the backend `ResolverPolicy`. These five rules decide which QA
// modules run on future calls. See the "what the policy controls" copy in the
// editor UI for how each field gates a module.
export type ResolverPolicy = {
  enrollmentDisposition: string
  enrollmentMinDurationSeconds: number
  excludedCampaignFriendlyIds: string[]
  warmTransferLegalStateValue: string
  collectionsMinBalance: number
}

export type ResolverPolicyVersion = {
  id: number
  policy: ResolverPolicy
  createdBy: string
  changeSummary: string
  createdAt: string
}

export type ModulePrompt = {
  moduleName: string
  promptText: string
  deployedAt: string
}

// Documented defaults, used to seed the edit form when the policies table is
// empty (backend seed row not applied yet). warmTransferLegalStateValue is "No"
// per the backend contract.
export const DEFAULT_RESOLVER_POLICY: ResolverPolicy = {
  enrollmentDisposition: '',
  enrollmentMinDurationSeconds: 0,
  excludedCampaignFriendlyIds: [],
  warmTransferLegalStateValue: 'No',
  collectionsMinBalance: 0,
}

// Defensive validator + coercion for a hand-editable JSONB column. A malformed
// row should never crash the admin page, so we validate shape and skip rows we
// can't parse (logging instead of throwing).
function parsePolicyJson(raw: unknown): ResolverPolicy | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const disposition = r.enrollmentDisposition
  const duration = r.enrollmentMinDurationSeconds
  const excluded = r.excludedCampaignFriendlyIds
  const legalState = r.warmTransferLegalStateValue
  const collections = r.collectionsMinBalance

  if (typeof disposition !== 'string') return null
  if (typeof duration !== 'number' || Number.isNaN(duration)) return null
  if (!Array.isArray(excluded) || excluded.some(v => typeof v !== 'string')) return null
  if (typeof legalState !== 'string') return null
  if (typeof collections !== 'number' || Number.isNaN(collections)) return null

  return {
    enrollmentDisposition: disposition,
    enrollmentMinDurationSeconds: duration,
    excludedCampaignFriendlyIds: excluded as string[],
    warmTransferLegalStateValue: legalState,
    collectionsMinBalance: collections,
  }
}

// Latest-first. Element 0 IS the active policy — the table is append-only, so
// the max-id row is authoritative. Rows whose policy_json doesn't match the
// expected shape are skipped rather than crashing the page.
export async function fetchResolverPolicyHistory(
  limit = 50,
): Promise<ResolverPolicyVersion[]> {
  const { data, error } = await supabase
    .from('eavesly_resolver_policies' as never)
    .select('id, policy_json, created_by, change_summary, created_at')
    .order('id', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('Error fetching resolver policy history:', error)
    throw error
  }

  const versions: ResolverPolicyVersion[] = []
  // SAFETY: selected columns are narrowed here; policy_json is parsed below.
  for (const row of (data ?? []) as unknown as ResolverPolicyRow[]) {
    const policy = parsePolicyJson(row.policy_json)
    if (!policy) {
      console.error('Skipping malformed resolver policy row:', row?.id)
      continue
    }
    versions.push({
      id: row.id,
      policy,
      createdBy: row.created_by ?? '',
      changeSummary: row.change_summary ?? '',
      createdAt: row.created_at ?? '',
    })
  }
  return versions
}

// Insert a new version. INSERT is RLS-gated to god-mode managers server-side —
// a non-god-mode caller (or a missing table) surfaces as a thrown Postgres
// error the caller turns into a readable toast. createdBy is the signed-in
// user's email; changeSummary must be non-empty.
export async function saveResolverPolicy(
  policy: ResolverPolicy,
  createdBy: string,
  changeSummary: string,
): Promise<void> {
  const summary = changeSummary.trim()
  if (!summary) throw new Error('A change summary is required.')

  const { error } = await supabase.from('eavesly_resolver_policies' as never).insert({
    policy_json: policy,
    created_by: createdBy,
    change_summary: summary,
  } as never)
  if (error) {
    console.error('Error saving resolver policy:', error)
    throw error
  }
}

// Deployed module prompts, ordered by module name. Read-only — prompts are
// synced from the eavesly backend repo on deploy and are never edited here.
export async function fetchModulePrompts(): Promise<ModulePrompt[]> {
  const { data, error } = await supabase
    .from('eavesly_module_prompts' as never)
    .select('module_name, prompt_text, deployed_at')
    .order('module_name', { ascending: true })
  if (error) {
    console.error('Error fetching module prompts:', error)
    throw error
  }
  // SAFETY: the selected scalar columns match this local boundary type.
  return ((data ?? []) as unknown as ModulePromptRow[]).map(row => ({
    moduleName: row.module_name ?? '',
    promptText: row.prompt_text ?? '',
    deployedAt: row.deployed_at ?? '',
  }))
}

// Active CRM dispositions, used to populate the enrollment-disposition dropdown.
// Mirrors the backend `getActiveDispositions()` (eavesly src/services/database.ts):
// eavesly_dispositions, active = true, ordered by name. Degrades to [] on error
// so the form falls back to a free-text input rather than failing.
export async function fetchDispositionOptions(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('eavesly_dispositions' as never)
      .select('name')
      .eq('active', true)
      .order('name', { ascending: true })
    if (error) {
      console.error('Error fetching dispositions:', error)
      return []
    }
    // SAFETY: the query selects only the nullable name column.
    return ((data ?? []) as unknown as DispositionRow[])
      .map(row => row.name)
      .filter((name: unknown): name is string => typeof name === 'string' && name.length > 0)
  } catch (err) {
    console.error('Error fetching dispositions:', err)
    return []
  }
}
