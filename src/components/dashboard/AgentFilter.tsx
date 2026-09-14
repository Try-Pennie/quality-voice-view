import { useId, useMemo, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { agentDisplayName } from '../../lib/utils'

interface AgentFilterProps {
  availableAgents: Array<{ agent_email: string; agent_full_name: string }>
  selectedAgents: string[]
  onSelectionChange: (agents: string[]) => void
}

/** Searchable, explicit multi-agent filter that preserves selected historical agents. */
export function AgentFilter({
  availableAgents,
  selectedAgents,
  onSelectionChange,
}: AgentFilterProps) {
  const labelId = useId()
  const summaryId = useId()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const visibleAgents = useMemo(
    () =>
      availableAgents.filter(agent =>
        `${agent.agent_full_name} ${agent.agent_email}`
          .toLocaleLowerCase()
          .includes(normalizedSearch),
      ),
    [availableAgents, normalizedSearch],
  )
  const names = useMemo(
    () => new Map(availableAgents.map(agent => [agent.agent_email, agent.agent_full_name])),
    [availableAgents],
  )

  const toggle = (email: string) => {
    onSelectionChange(
      selectedAgents.includes(email)
        ? selectedAgents.filter(selected => selected !== email)
        : [...selectedAgents, email],
    )
  }

  return (
    <div className="min-w-0">
      <span id={labelId} className="pennie-label mb-1.5 block">
        Agents
      </span>
      <Popover open={open} onOpenChange={next => {
        setOpen(next)
        if (!next) setSearch('')
      }}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-labelledby={`${labelId} ${summaryId}`}
            aria-expanded={open}
            className="pennie-focus-ring inline-flex h-10 min-w-[12rem] max-w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-sm text-foreground hover:bg-pennie-beige/40"
          >
            <span id={summaryId} className="truncate font-medium">
              {selectedAgents.length === 0
                ? 'All agents'
                : `${selectedAgents.length} selected`}
            </span>
            <ChevronDown
              aria-hidden="true"
              className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl border-border bg-pennie-white p-2 shadow-floating"
        >
          <label className="relative block">
            <span className="sr-only">Search agents</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search name or email"
              className="pennie-focus-ring h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm"
            />
          </label>
          <div className="mt-2 max-h-64 overflow-y-auto" role="group" aria-label="Agent choices">
            {visibleAgents.map(agent => {
              const checked = selectedAgents.includes(agent.agent_email)
              const name = agentDisplayName(agent.agent_full_name, agent.agent_email)
              return (
                <label
                  key={agent.agent_email}
                  className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm hover:bg-pennie-beige/60"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(agent.agent_email)}
                    className="peer sr-only"
                  />
                  <span className="flex size-5 shrink-0 items-center justify-center rounded border border-input bg-background peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-checked:border-pennie-navy peer-checked:bg-pennie-navy peer-checked:text-pennie-white">
                    {checked && <Check aria-hidden="true" className="size-3.5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-pennie-navy">{name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{agent.agent_email}</span>
                  </span>
                </label>
              )
            })}
            {visibleAgents.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No agents match your search.
              </p>
            )}
          </div>
          {selectedAgents.length > 0 && (
            <button
              type="button"
              onClick={() => onSelectionChange([])}
              className="pennie-focus-ring mt-2 min-h-[36px] w-full rounded-xl border-t border-border px-3 text-left text-sm font-semibold text-pennie-blue-deeper hover:bg-pennie-beige/60"
            >
              Clear all agents
            </button>
          )}
        </PopoverContent>
      </Popover>

      {selectedAgents.length > 0 && (
        <div className="mt-2 flex max-w-md flex-wrap gap-1.5" aria-label="Selected agents">
          {selectedAgents.map(email => (
            <span
              key={email}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-pennie-blue-light/60 py-1 pl-2.5 pr-1 text-xs font-semibold text-pennie-navy"
            >
              <span className="truncate">{names.get(email) ?? email}</span>
              <button
                type="button"
                onClick={() => toggle(email)}
                aria-label={`Remove ${names.get(email) ?? email}`}
                className="pennie-focus-ring inline-flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-pennie-white/70"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
