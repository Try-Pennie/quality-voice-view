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
  /** Override icon size (Tailwind h-/w- modifier number). Default 3.5 (=14px). */
  size?: 3 | 3.5 | 4
  /**
   * Deprecated. Kept so existing call sites still type-check; the popover now
   * positions itself automatically.
   */
  side?: 'top' | 'right' | 'bottom' | 'left'
}

function iconSizeClass(size: 3 | 3.5 | 4) {
  return size === 3 ? 'h-3 w-3' : size === 4 ? 'h-4 w-4' : 'h-3.5 w-3.5'
}

const TRIGGER_BASE =
  'pennie-focus-ring inline-flex items-center justify-center align-middle rounded-full transition-[color,opacity,transform] duration-200 text-pennie-graphite/50 hover:text-pennie-navy focus-visible:text-pennie-navy data-[state=open]:text-pennie-navy data-[first-run=true]:text-pennie-navy data-[first-run=true]:scale-110'

/**
 * HelpHint — small ⓘ icon that opens a popover with the registered help copy.
 * Always renders the same rich layout (title + body + optional formula /
 * example + glossary link) so behavior and styling stay consistent across the
 * dashboard. Returns null when the user has hidden hints via the layout
 * toggle, so power users see no chrome.
 */
export function HelpHint({ id, className, size = 3.5 }: HelpHintProps) {
  const { enabled, firstRun } = useHints()
  if (!enabled) return null
  assertHelp(id)
  const entry = getHelp(id)
  if (!entry) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Learn about "${entry.title}"`}
          data-first-run={firstRun || undefined}
          onClick={(e) => e.stopPropagation()}
          className={cn(TRIGGER_BASE, className)}
        >
          <HelpCircle className={iconSizeClass(size)} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 text-sm leading-snug"
        onClick={(e) => e.stopPropagation()}
      >
        <HelpBody id={id} entry={entry} />
      </PopoverContent>
    </Popover>
  )
}

function HelpBody({ id, entry }: { id: HelpId; entry: HelpEntry }) {
  return (
    <>
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
        className="text-xs font-semibold text-pennie-blue-deeper hover:underline underline-offset-4"
      >
        See in glossary →
      </Link>
    </>
  )
}
