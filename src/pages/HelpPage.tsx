import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Search } from 'lucide-react'
import {
  HELP,
  HELP_CATEGORIES,
  type HelpCategory,
  type HelpEntry,
} from '../lib/help-content'

type GroupedEntry = { id: string; entry: HelpEntry }

export default function HelpPage() {
  const [query, setQuery] = useState('')
  const location = useLocation()

  // Deep-link to a specific entry via /dashboard/help#metric.compliance_rate.
  // Slight delay lets the list paint before scrolling.
  useEffect(() => {
    if (!location.hash) return
    const id = decodeURIComponent(location.hash.slice(1))
    requestAnimationFrame(() => {
      const el = document.getElementById(id)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        el.classList.add('ring-2', 'ring-pennie-blue-dark/40')
        setTimeout(
          () => el.classList.remove('ring-2', 'ring-pennie-blue-dark/40'),
          1500,
        )
      }
    })
  }, [location.hash])

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const buckets = new Map<HelpCategory, GroupedEntry[]>()
    for (const cat of HELP_CATEGORIES) buckets.set(cat, [])
    for (const [id, entry] of Object.entries(HELP)) {
      if (q) {
        const hay =
          `${entry.title} ${entry.body} ${entry.formula ?? ''} ${entry.example ?? ''} ${id}`.toLowerCase()
        if (!hay.includes(q)) continue
      }
      buckets.get(entry.category)?.push({ id, entry })
    }
    for (const [, list] of buckets) {
      list.sort((a, b) => a.entry.title.localeCompare(b.entry.title))
    }
    return buckets
  }, [query])

  const totalMatches = useMemo(() => {
    let n = 0
    for (const [, list] of grouped) n += list.length
    return n
  }, [grouped])

  const populatedCategories = useMemo(
    () => HELP_CATEGORIES.filter(c => (grouped.get(c) ?? []).length > 0),
    [grouped],
  )

  return (
    <div className="space-y-6 sm:space-y-8 animate-pennie-rise">
      {/* Quieter reference-style header — this is a glossary, not a hero. */}
      <header className="flex flex-wrap items-end justify-between gap-6 pb-2 border-b border-border/60">
        <div>
          <p className="pennie-label mb-1">Glossary</p>
          <h1 className="font-display text-3xl text-pennie-navy">
            What everything means
          </h1>
          <p className="mt-2 text-sm text-pennie-graphite/70 max-w-prose">
            Definitions for every metric, filter, and label. Tap{' '}
            <kbd className="px-1.5 py-0.5 rounded-md border border-border bg-pennie-beige text-[11px] font-mono text-pennie-graphite">
              ?
            </kbd>{' '}
            anywhere to come back here.
          </p>
        </div>
        <div className="flex-1 min-w-[260px] max-w-md">
          <label htmlFor="help-search" className="sr-only">
            Search glossary
          </label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              id="help-search"
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search definitions…"
              className="w-full min-h-[40px] pl-9 pr-3 py-2 rounded-full border border-border bg-pennie-white text-sm font-medium placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-pennie-blue-deeper/40 focus:border-pennie-blue-deeper"
            />
          </div>
          {query.trim() && (
            <p className="text-xs text-muted-foreground mt-1.5 px-2">
              {totalMatches === 0
                ? 'No matches.'
                : `${totalMatches} ${totalMatches === 1 ? 'match' : 'matches'}.`}
            </p>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr] gap-x-10 gap-y-6">
        {/* Sticky category jump-nav — short, alphabetized by section. */}
        <nav
          aria-label="Jump to category"
          className="hidden lg:block lg:sticky lg:top-24 self-start"
        >
          <p className="pennie-label mb-2">Sections</p>
          <ul className="space-y-1.5">
            {populatedCategories.map(cat => (
              <li key={cat}>
                <a
                  href={`#cat-${slug(cat)}`}
                  className="block text-sm text-pennie-graphite/80 hover:text-pennie-navy hover:underline underline-offset-4"
                >
                  {cat}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-10 min-w-0">
          {populatedCategories.map(cat => {
            const items = grouped.get(cat) ?? []
            return (
              <section key={cat} id={`cat-${slug(cat)}`} className="scroll-mt-24">
                <h2 className="font-display text-xl text-pennie-navy mb-3">
                  {cat}
                </h2>
                <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
                  {items.map(({ id, entry }) => (
                    <div
                      key={id}
                      id={id}
                      className="border-l-2 border-border pl-4 py-1 transition-colors scroll-mt-24"
                    >
                      <dt className="font-semibold text-pennie-navy text-sm">
                        {entry.title}
                      </dt>
                      <dd className="mt-1 text-sm text-pennie-graphite/90 leading-relaxed">
                        {entry.body}
                      </dd>
                      {entry.formula && (
                        <p className="mt-2 text-xs bg-pennie-beige rounded-md px-2.5 py-1 text-pennie-graphite inline-block tabular-nums">
                          <span className="font-semibold uppercase tracking-wider text-[10px] text-muted-foreground mr-1.5">
                            Formula
                          </span>
                          {entry.formula}
                        </p>
                      )}
                      {entry.example && (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          <span className="font-semibold uppercase tracking-wider text-[10px] mr-1.5">
                            Example
                          </span>
                          {entry.example}
                        </p>
                      )}
                    </div>
                  ))}
                </dl>
              </section>
            )
          })}
          {totalMatches === 0 && query.trim() && (
            <p className="text-sm text-muted-foreground py-12 text-center">
              Nothing matches "{query.trim()}". Try a shorter term.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
