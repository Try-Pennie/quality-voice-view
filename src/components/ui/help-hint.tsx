import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { HelpCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { getHelp, type HelpEntry, type HelpId } from '@/lib/help-content'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'eavesly:hints-enabled'
const FIRST_RUN_KEY = 'eavesly:hints-seen'
const FIRST_RUN_MS = 2200

type HintsCtx = {
  enabled: boolean
  toggle: () => void
  firstRun: boolean
}

const Ctx = createContext<HintsCtx>({
  enabled: true,
  toggle: () => {},
  firstRun: false,
})

export function HintsProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    const v = window.localStorage.getItem(STORAGE_KEY)
    return v === null ? true : v === '1'
  })
  const [firstRun, setFirstRun] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(FIRST_RUN_KEY) !== '1'
  })

  // First-run bloom: pulse every hint icon to full opacity for ~2s on the
  // user's very first dashboard visit, then settle to the resting style.
  // Persisted so the bloom never replays.
  useEffect(() => {
    if (!firstRun) return
    const t = window.setTimeout(() => {
      setFirstRun(false)
      window.localStorage.setItem(FIRST_RUN_KEY, '1')
    }, FIRST_RUN_MS)
    return () => window.clearTimeout(t)
  }, [firstRun])

  const toggle = useCallback(() => {
    setEnabled(prev => {
      const next = !prev
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      return next
    })
  }, [])

  const value = useMemo(
    () => ({ enabled, toggle, firstRun }),
    [enabled, toggle, firstRun],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useHints() {
  return useContext(Ctx)
}

function assertHelp(id: HelpId) {
  if (import.meta.env.DEV) {
    const entry = (getHelp as unknown as (i: string) => unknown)(id)
    if (!entry) {
      console.warn(`[HelpHint] Missing entry for id "${id}". Add it to src/lib/help-content.ts.`)
    }
  }
}

interface HelpHintProps {
  id: HelpId
  className?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Override icon size (Tailwind h-/w- modifier number). Default 3.5 (=14px). */
  size?: 3 | 3.5 | 4
}

/**
 * HelpHint — small ⓘ icon that opens a tooltip with the registered help copy.
 * Auto-promotes to a Popover (with formula/example/glossary link) when the
 * registry entry includes those fields. Returns null when the user has hidden
 * hints via the layout toggle, so power users see no chrome.
 */
export function HelpHint({
  id,
  className,
  side = 'top',
  size = 3.5,
}: HelpHintProps) {
  const { enabled, firstRun } = useHints()
  if (!enabled) return null
  assertHelp(id)
  const entry = getHelp(id)
  if (!entry) return null

  const hasRichContent = Boolean(entry.formula || entry.example)
  return hasRichContent ? (
    <RichHelp
      id={id}
      entry={entry}
      firstRun={firstRun}
      size={size}
      className={className}
    />
  ) : (
    <SimpleHelp
      id={id}
      entry={entry}
      firstRun={firstRun}
      side={side}
      size={size}
      className={className}
    />
  )
}

function iconSizeClass(size: 3 | 3.5 | 4) {
  return size === 3 ? 'h-3 w-3' : size === 4 ? 'h-4 w-4' : 'h-3.5 w-3.5'
}

// Bumped from /40 → /50 for first-time discoverability without becoming loud.
// Focus ring uses /70 to clear WCAG 1.4.11 (3:1) on warm-beige backgrounds.
const TRIGGER_BASE =
  'inline-flex items-center justify-center align-middle rounded-full transition-[color,opacity,transform] duration-200 text-pennie-graphite/50 hover:text-pennie-navy focus:text-pennie-navy focus:outline-none focus:ring-2 focus:ring-pennie-blue-dark/70 data-[first-run=true]:text-pennie-navy data-[first-run=true]:scale-110'

function SimpleHelp({
  entry,
  firstRun,
  side,
  size,
  className,
}: {
  id: HelpId
  entry: HelpEntry
  firstRun: boolean
  side: 'top' | 'right' | 'bottom' | 'left'
  size: 3 | 3.5 | 4
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`What is "${entry.title}"?`}
          data-first-run={firstRun || undefined}
          className={cn(TRIGGER_BASE, className)}
        >
          <HelpCircle className={iconSizeClass(size)} aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        className="max-w-xs whitespace-normal text-sm leading-snug"
      >
        <p className="font-semibold mb-1 text-pennie-navy">{entry.title}</p>
        <p className="text-pennie-graphite">{entry.body}</p>
      </TooltipContent>
    </Tooltip>
  )
}

function RichHelp({
  id,
  entry,
  firstRun,
  size,
  className,
}: {
  id: HelpId
  entry: HelpEntry
  firstRun: boolean
  size: 3 | 3.5 | 4
  className?: string
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Learn about "${entry.title}"`}
          data-first-run={firstRun || undefined}
          className={cn(TRIGGER_BASE, className)}
        >
          <HelpCircle className={iconSizeClass(size)} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm leading-snug">
        <p className="font-semibold text-pennie-navy mb-1.5">{entry.title}</p>
        <p className="text-pennie-graphite mb-3">{entry.body}</p>
        {entry.formula && (
          <div className="text-xs bg-pennie-beige rounded-md px-2.5 py-1.5 mb-2 text-pennie-graphite tabular-nums">
            <span className="font-semibold uppercase tracking-wider text-[10px] text-muted-foreground mr-1.5">
              Formula
            </span>
            {entry.formula}
          </div>
        )}
        {entry.example && (
          <div className="text-xs text-muted-foreground mb-3">
            <span className="font-semibold uppercase tracking-wider text-[10px] mr-1.5">
              Example
            </span>
            {entry.example}
          </div>
        )}
        <Link
          to={`/dashboard/help#${id}`}
          className="text-xs font-semibold text-pennie-blue-dark hover:underline underline-offset-4"
        >
          See in glossary →
        </Link>
      </PopoverContent>
    </Popover>
  )
}
