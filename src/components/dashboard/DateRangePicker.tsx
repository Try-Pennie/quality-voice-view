import { useEffect, useState } from 'react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { Calendar as CalendarIcon, ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { cn } from '../../lib/utils'
import { BUSINESS_TIMEZONE_LABEL } from '../../lib/time-zone'

interface DateRangePickerProps {
  startDate: Date
  endDate: Date
  // Atomic emit — only fires when both ends of the range are set, so the
  // consuming page's URL-sync useEffect never runs against a half-selected
  // window. setStartDate + setEndDate in the same callback batch into one
  // render.
  onRangeChange: (start: Date, end: Date) => void
  maxDate?: Date
}

type Preset = {
  label: string
  range: () => [Date, Date]
}

function startOfLocalDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

function endOfLocalDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(23, 59, 59, 999)
  return r
}

function todayLocal(): Date {
  return startOfLocalDay(new Date())
}

const PRESETS: Preset[] = [
  {
    label: 'Today',
    range: () => {
      const t = todayLocal()
      return [t, endOfLocalDay(t)]
    },
  },
  {
    label: 'Yesterday',
    range: () => {
      const t = todayLocal()
      const y = new Date(t)
      y.setDate(y.getDate() - 1)
      return [y, endOfLocalDay(y)]
    },
  },
  {
    label: 'Last 7 days',
    range: () => {
      const t = todayLocal()
      const s = new Date(t)
      s.setDate(s.getDate() - 6)
      return [s, endOfLocalDay(t)]
    },
  },
  {
    label: 'Last 14 days',
    range: () => {
      const t = todayLocal()
      const s = new Date(t)
      s.setDate(s.getDate() - 13)
      return [s, endOfLocalDay(t)]
    },
  },
  {
    label: 'Last 30 days',
    range: () => {
      const t = todayLocal()
      const s = new Date(t)
      s.setDate(s.getDate() - 29)
      return [s, endOfLocalDay(t)]
    },
  },
  {
    label: 'Last 90 days',
    range: () => {
      const t = todayLocal()
      const s = new Date(t)
      s.setDate(s.getDate() - 89)
      return [s, endOfLocalDay(t)]
    },
  },
  {
    label: 'This month',
    range: () => {
      const t = todayLocal()
      const s = new Date(t.getFullYear(), t.getMonth(), 1)
      return [s, endOfLocalDay(t)]
    },
  },
  {
    label: 'Last month',
    range: () => {
      const t = todayLocal()
      const s = new Date(t.getFullYear(), t.getMonth() - 1, 1)
      const e = new Date(t.getFullYear(), t.getMonth(), 0)
      e.setHours(23, 59, 59, 999)
      return [s, e]
    },
  },
]

const monthDayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const monthDayYearFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

function sameYMD(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatRange(start: Date, end: Date): string {
  if (sameYMD(start, end)) return monthDayYearFmt.format(start)
  if (start.getFullYear() === end.getFullYear()) {
    return `${monthDayFmt.format(start)} – ${monthDayYearFmt.format(end)}`
  }
  return `${monthDayYearFmt.format(start)} – ${monthDayYearFmt.format(end)}`
}

function presetMatches(p: Preset, start: Date, end: Date): boolean {
  const [s, e] = p.range()
  return sameYMD(s, start) && sameYMD(e, end)
}

function useIsWide(query = '(min-width: 640px)'): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

export function DateRangePicker({
  startDate,
  endDate,
  onRangeChange,
  maxDate,
}: DateRangePickerProps) {
  const today = maxDate ?? new Date()
  const isWide = useIsWide()
  const [open, setOpen] = useState(false)
  // Draft holds the in-progress selection inside the popover. The picker
  // only commits to the parent (and to the URL) when both ends are set,
  // so consumers never see a half-selected window.
  const [draft, setDraft] = useState<[Date | null, Date | null]>([startDate, endDate])

  // Re-sync the draft when the committed range changes externally
  // (e.g. URL deep link, sidebar nav carrying start/end across pages).
  useEffect(() => {
    if (!open) setDraft([startDate, endDate])
  }, [startDate, endDate, open])

  const handleChange = (dates: [Date | null, Date | null]) => {
    const [s, e] = dates
    setDraft([s, e])
    if (s && e) {
      onRangeChange(startOfLocalDay(s), endOfLocalDay(e))
      setOpen(false)
    }
  }

  const handlePreset = (p: Preset) => {
    const [s, e] = p.range()
    setDraft([s, e])
    onRangeChange(s, e)
    setOpen(false)
  }

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="pennie-label inline-flex items-center gap-1.5">
        Date range
        <span
          className="text-[10px] font-semibold tracking-normal normal-case text-pennie-graphite/70 px-1.5 py-0.5 rounded-full bg-pennie-beige"
          title="All dates and chart buckets are in Eastern Time"
        >
          {BUSINESS_TIMEZONE_LABEL}
        </span>
      </legend>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'pennie-focus-ring inline-flex h-10 min-w-[16rem] items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-pennie-beige/40',
              open && 'bg-pennie-beige/40',
            )}
            aria-label={`Date range: ${formatRange(startDate, endDate)}. Click to change.`}
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <span className="inline-flex items-center gap-2">
              <CalendarIcon className="size-4 text-muted-foreground" aria-hidden />
              <span className="font-medium">{formatRange(startDate, endDate)}</span>
            </span>
            <ChevronDown
              className={cn(
                'size-4 text-muted-foreground transition-transform',
                open && 'rotate-180',
              )}
              aria-hidden
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-auto max-w-[calc(100vw-1.5rem)] p-0"
        >
          <div className="flex flex-col sm:flex-row">
            <div
              className="flex sm:flex-col gap-1 p-2 border-b sm:border-b-0 sm:border-r sm:w-40 overflow-x-auto sm:overflow-x-visible"
              role="group"
              aria-label="Date range presets"
            >
              {PRESETS.map(p => {
                const active = presetMatches(p, startDate, endDate)
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => handlePreset(p)}
                    className={cn(
                      'pennie-focus-ring shrink-0 sm:w-full whitespace-nowrap rounded-md px-3 py-1.5 text-left text-sm transition-colors',
                      active
                        ? 'bg-pennie-navy text-pennie-white'
                        : 'text-foreground hover:bg-pennie-beige',
                    )}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
            <div className="p-2">
              <DatePicker
                startDate={draft[0] ?? undefined}
                endDate={draft[1] ?? undefined}
                onChange={handleChange}
                selectsRange
                maxDate={today}
                monthsShown={isWide ? 2 : 1}
                inline
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </fieldset>
  )
}
