import { useState, useEffect } from 'react'
import { FileText, Lock } from 'lucide-react'
import { useModulePrompts } from '@/hooks/use-queries'
import { MODULE_LABELS } from '@/lib/alert-queries'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EmptyState } from '@/components/states/EmptyState'
import { ErrorState } from '@/components/states/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'

// Turn a canonical snake_case module name into a readable label. Prefers the
// shared MODULE_LABELS map, falls back to Title Casing the raw name (the label
// map doesn't cover all deployed modules).
function humanizeModule(name: string): string {
  if (MODULE_LABELS[name]) return MODULE_LABELS[name]
  return name
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatDeployedAt(iso: string): string {
  if (!iso) return 'unknown date'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'unknown date'
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function ModulePromptViewer() {
  const { data, isPending, isError, refetch } = useModulePrompts()
  const prompts = data ?? []
  const [selected, setSelected] = useState<string | null>(null)

  // Default the selection to the first prompt once they load.
  useEffect(() => {
    if (!selected && prompts.length > 0) {
      setSelected(prompts[0].moduleName)
    }
  }, [prompts, selected])

  const active = prompts.find(p => p.moduleName === selected) ?? null

  return (
    <section className="space-y-4">
      <div className="pennie-card space-y-6">
        <div className="flex items-start gap-4">
          <div className="pennie-icon-chip bg-pennie-beige flex-none">
            <FileText className="w-5 h-5 text-pennie-navy" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-pennie-navy">
              Module prompts
            </h2>
            <p className="text-sm text-pennie-graphite/70 mt-1 max-w-prose">
              The exact prompt text deployed for each QA module. Read-only.
            </p>
          </div>
        </div>

        {/* Read-only banner — prompts live in the backend repo. */}
        <div
          role="note"
          className="flex items-start gap-3 rounded-2xl bg-pennie-blue-light px-4 py-3"
        >
          <Lock
            className="w-4 h-4 text-pennie-blue-deeper flex-none mt-0.5"
            aria-hidden="true"
          />
          <p className="text-sm text-pennie-navy">
            Prompts are maintained in the eavesly backend repo and sync
            automatically on deploy. To change one, open a backend PR.
          </p>
        </div>

        {isError ? (
          <ErrorState
            title="Couldn't load module prompts"
            message="We hit an error fetching the deployed prompts. Retry to reload."
            onRetry={() => refetch()}
          />
        ) : isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full rounded-2xl" />
            <Skeleton className="h-64 w-full rounded-2xl" />
          </div>
        ) : prompts.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No prompts synced yet"
            message="Module prompts appear here once the eavesly backend deploys and syncs them."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
            {/* Module picker */}
            <div
              role="tablist"
              aria-label="Modules"
              className="flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-visible"
            >
              {prompts.map(p => {
                const isActive = p.moduleName === selected
                return (
                  <button
                    key={p.moduleName}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setSelected(p.moduleName)}
                    className={`pennie-focus-ring text-left whitespace-nowrap md:whitespace-normal px-4 py-2.5 rounded-2xl text-sm font-semibold transition-colors ${
                      isActive
                        ? 'bg-pennie-navy text-pennie-white'
                        : 'text-pennie-graphite hover:bg-pennie-beige'
                    }`}
                  >
                    {humanizeModule(p.moduleName)}
                  </button>
                )
              })}
            </div>

            {/* Prompt body */}
            <div className="min-w-0">
              {active && (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                    <h3 className="text-sm font-semibold text-pennie-navy">
                      {humanizeModule(active.moduleName)}
                    </h3>
                    <span className="text-xs text-pennie-graphite/60">
                      Deployed {formatDeployedAt(active.deployedAt)}
                    </span>
                  </div>
                  <ScrollArea className="h-[420px] rounded-2xl border border-border bg-pennie-beige/40">
                    <pre className="whitespace-pre-wrap break-words select-text p-4 text-[13px] leading-relaxed font-mono text-pennie-graphite">
                      {active.promptText || '(empty prompt)'}
                    </pre>
                  </ScrollArea>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
