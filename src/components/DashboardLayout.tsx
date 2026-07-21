import { useEffect, useMemo, useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  BookOpen,
  ChevronDown,
  Lightbulb,
  LightbulbOff,
  LogOut,
  Menu,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useAlertBreakdown, useUserScope } from '../hooks/use-queries'
import { ymdInBusinessTZ } from '../lib/time-zone'
import { HintsProvider, useHints } from './ui/help-hint'
import { NotificationBell } from './NotificationBell'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './ui/sheet'

// Secondary analysis surfaces grouped under the "Reports" dropdown so the
// primary manager loop (Calls / Alerts / Team) stays flat in the top nav.
const REPORT_LINKS = [
  { to: '/dashboard/disposition-audit', label: 'Disposition Audit' },
  { to: '/dashboard/gota', label: 'Achieve GOTA' },
  { to: '/dashboard/insights', label: 'Insights' },
]

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <HintsProvider>
      <DashboardChrome>{children}</DashboardChrome>
    </HintsProvider>
  )
}

function DashboardChrome({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth()
  // God-mode gates the Admin nav link. TanStack Query dedupes this with the
  // AdminPage's own useUserScope call. The link is UX only — RLS enforces.
  const { data: scope } = useUserScope(user?.email)
  const isGodMode = !!scope?.isGodMode
  const { enabled: hintsEnabled, toggle: toggleHints } = useHints()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(false)

  // Open-alert count for the Alerts nav badge — today's window (ET), matching
  // the queue's default view, so it shares the AlertsPage breakdown cache.
  // Uses the simple `unreviewed` count for all roles; god-mode "needs my ✓"
  // nuance stays on the page itself.
  const [todayStart, todayEnd] = useMemo(() => {
    const [y, m, d] = ymdInBusinessTZ(new Date()).split('-').map(Number)
    const start = new Date(y, m - 1, d)
    start.setHours(0, 0, 0, 0)
    const end = new Date(y, m - 1, d)
    end.setHours(23, 59, 59, 999)
    return [start, end] as const
  }, [])
  const { data: breakdown } = useAlertBreakdown(scope, todayStart, todayEnd)
  const openAlertCount = useMemo(
    () => (breakdown ?? []).reduce((sum, c) => sum + c.unreviewed, 0),
    [breakdown],
  )

  // Press "?" anywhere outside text inputs to jump to the glossary.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== '?') return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      ) {
        return
      }
      if (location.pathname === '/dashboard/help') return
      e.preventDefault()
      navigate('/dashboard/help')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate, location.pathname])

  // Auto-close the mobile nav when the route changes (after the user picks
  // a destination). Listening on pathname covers <NavLink> taps; the date
  // params don't matter for this.
  useEffect(() => {
    setMobileNavOpen(false)
    setReportsOpen(false)
  }, [location.pathname])

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-pennie-white sticky top-0 z-30 print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center gap-3 sm:gap-4 py-3 sm:py-4">
            <div className="flex items-center gap-4 sm:gap-8 min-w-0">
              <a
                href="/dashboard"
                className="font-display text-xl sm:text-2xl tracking-[-0.02em] text-pennie-navy font-bold hover:opacity-80 transition-opacity"
              >
                Eavesly
              </a>
              <nav
                aria-label="Primary"
                className="hidden sm:flex items-center gap-1"
              >
                <DashNavLink to="/dashboard" end>
                  Calls
                </DashNavLink>
                <DashNavLink to="/dashboard/alerts" badge={openAlertCount}>
                  Alerts
                </DashNavLink>
                <DashNavLink to="/dashboard/team">Team</DashNavLink>
                <ReportsMenu open={reportsOpen} onOpenChange={setReportsOpen} />
                {isGodMode && (
                  <DashNavLink to="/dashboard/admin">Admin</DashNavLink>
                )}
              </nav>
            </div>

            <div className="flex items-center gap-1 sm:gap-2">
              <NotificationBell />
              <button
                type="button"
                onClick={toggleHints}
                aria-pressed={hintsEnabled}
                title={
                  hintsEnabled
                    ? 'Hide help hints across the dashboard'
                    : 'Show help hints across the dashboard'
                }
                className="pennie-focus-ring hidden sm:inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-full text-pennie-graphite/70 hover:text-pennie-navy hover:bg-pennie-beige transition-colors"
              >
                {hintsEnabled ? (
                  <Lightbulb className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <LightbulbOff className="w-4 h-4" aria-hidden="true" />
                )}
                <span className="sr-only">
                  {hintsEnabled ? 'Hide hints' : 'Show hints'}
                </span>
              </button>
              <NavLink
                to="/dashboard/help"
                title="Glossary (press ?)"
                className={({ isActive }) =>
                  `pennie-focus-ring min-h-[40px] min-w-[40px] sm:min-h-[36px] sm:min-w-[36px] inline-flex items-center justify-center rounded-full transition-colors ${
                    isActive
                      ? 'text-pennie-navy bg-pennie-beige'
                      : 'text-pennie-graphite/70 hover:text-pennie-navy hover:bg-pennie-beige'
                  }`
                }
              >
                <BookOpen className="w-4 h-4" aria-hidden="true" />
                <span className="sr-only">Open glossary</span>
              </NavLink>
              <span className="text-sm text-muted-foreground hidden lg:inline truncate max-w-[160px]">
                {user?.email}
              </span>
              <button
                type="button"
                onClick={signOut}
                className="pennie-focus-ring hidden sm:inline-flex min-h-[36px] px-3 py-1.5 rounded-full text-sm font-semibold text-pennie-graphite hover:bg-pennie-beige transition-colors"
              >
                Sign out
              </button>

              {/* Mobile navigation — hamburger that opens a right-side sheet
                  with the same nav links plus hints toggle, account email, and
                  sign-out. Visible only below `sm`; desktop keeps the inline
                  nav unchanged. */}
              <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    aria-label="Open menu"
                    className="pennie-focus-ring sm:hidden min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-full text-pennie-graphite hover:text-pennie-navy hover:bg-pennie-beige transition-colors"
                  >
                    <Menu className="w-5 h-5" aria-hidden="true" />
                  </button>
                </SheetTrigger>
                <SheetContent
                  side="right"
                  className="w-72 max-w-[85vw] bg-pennie-white p-0 flex flex-col"
                >
                  <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
                    <SheetTitle className="text-pennie-navy">Menu</SheetTitle>
                  </SheetHeader>
                  <nav
                    aria-label="Primary"
                    className="flex-1 overflow-y-auto px-3 py-4 space-y-1"
                  >
                    <MobileNavLink to="/dashboard" end>
                      Calls
                    </MobileNavLink>
                    <MobileNavLink
                      to="/dashboard/alerts"
                      badge={openAlertCount}
                    >
                      Alerts
                    </MobileNavLink>
                    <MobileNavLink to="/dashboard/team">Team</MobileNavLink>
                    <p className="pennie-label px-4 pt-4 pb-1">Reports</p>
                    {REPORT_LINKS.map(link => (
                      <MobileNavLink key={link.to} to={link.to}>
                        {link.label}
                      </MobileNavLink>
                    ))}
                    {isGodMode && (
                      <MobileNavLink to="/dashboard/admin" carryDates={false}>
                        Admin
                      </MobileNavLink>
                    )}
                    <MobileNavLink to="/dashboard/help" carryDates={false}>
                      Glossary
                    </MobileNavLink>
                  </nav>
                  <div className="border-t border-border px-5 py-4 space-y-3">
                    <button
                      type="button"
                      onClick={toggleHints}
                      aria-pressed={hintsEnabled}
                      className="pennie-focus-ring flex items-center justify-between w-full min-h-[44px] px-3 -mx-3 rounded-2xl text-sm font-semibold text-pennie-graphite hover:bg-pennie-beige transition-colors"
                    >
                      <span className="inline-flex items-center gap-2">
                        {hintsEnabled ? (
                          <Lightbulb
                            className="w-4 h-4"
                            aria-hidden="true"
                          />
                        ) : (
                          <LightbulbOff
                            className="w-4 h-4"
                            aria-hidden="true"
                          />
                        )}
                        Help hints
                      </span>
                      <span className="text-xs font-bold uppercase tracking-wider text-pennie-graphite/60">
                        {hintsEnabled ? 'On' : 'Off'}
                      </span>
                    </button>
                    {user?.email && (
                      <p className="text-xs text-pennie-graphite/60 truncate px-3 -mx-3">
                        Signed in as {user.email}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={signOut}
                      className="pennie-focus-ring inline-flex items-center gap-2 w-full min-h-[44px] px-4 rounded-full bg-pennie-beige text-sm font-semibold text-pennie-navy hover:bg-pennie-beige/70 transition-colors"
                    >
                      <LogOut className="w-4 h-4" aria-hidden="true" />
                      Sign out
                    </button>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
        {children}
      </main>
    </div>
  )
}

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-pennie-blue-deeper text-pennie-white text-[10px] font-bold tabular-nums"
      aria-label={`${count} open alert${count === 1 ? '' : 's'} today`}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

function ReportsMenu({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const location = useLocation()
  const isActive = REPORT_LINKS.some(link =>
    location.pathname.startsWith(link.to),
  )
  const params = new URLSearchParams(location.search)
  const start = params.get('start')
  const endParam = params.get('end')
  const carry = new URLSearchParams()
  if (start) carry.set('start', start)
  if (endParam) carry.set('end', endParam)
  const withDates = (to: string) =>
    carry.toString() ? `${to}?${carry.toString()}` : to

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          className={`pennie-focus-ring relative px-4 py-2 rounded-full text-sm font-semibold transition-colors inline-flex items-center gap-1.5 ${
            isActive
              ? 'text-pennie-navy bg-pennie-beige'
              : 'text-pennie-graphite/70 hover:text-pennie-navy hover:bg-pennie-beige/60'
          }`}
        >
          {isActive && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-pennie-blue-dark"
              aria-hidden="true"
            />
          )}
          Reports
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-56 p-2 rounded-2xl bg-pennie-white border-border shadow-floating"
      >
        <nav aria-label="Reports" className="flex flex-col gap-0.5">
          {REPORT_LINKS.map(link => (
            <NavLink
              key={link.to}
              to={withDates(link.to)}
              onClick={() => onOpenChange(false)}
              className={({ isActive: linkActive }) =>
                `pennie-focus-ring flex items-center min-h-[40px] px-3 rounded-xl text-sm font-semibold transition-colors ${
                  linkActive
                    ? 'text-pennie-navy bg-pennie-beige'
                    : 'text-pennie-graphite hover:text-pennie-navy hover:bg-pennie-beige/60'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </PopoverContent>
    </Popover>
  )
}

function DashNavLink({
  to,
  end,
  children,
  badge,
}: {
  to: string
  end?: boolean
  children: React.ReactNode
  badge?: number
}) {
  const location = useLocation()
  // Calls / Team / Alerts all use the same ?start=&end= contract, so carrying
  // the current range across the top-nav keeps the date window stable when a
  // user pivots from one view to another.
  const params = new URLSearchParams(location.search)
  const start = params.get('start')
  const endParam = params.get('end')
  const carry = new URLSearchParams()
  if (start) carry.set('start', start)
  if (endParam) carry.set('end', endParam)
  const target = carry.toString() ? `${to}?${carry.toString()}` : to
  return (
    <NavLink
      to={target}
      end={end}
      className={({ isActive }) =>
        `pennie-focus-ring relative px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
          isActive
            ? 'text-pennie-navy bg-pennie-beige'
            : 'text-pennie-graphite/70 hover:text-pennie-navy hover:bg-pennie-beige/60'
        }`
      }
    >
      {({ isActive }) => (
        <span className="inline-flex items-center gap-2">
          {isActive && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-pennie-blue-dark"
              aria-hidden="true"
            />
          )}
          {children}
          {badge != null && <NavBadge count={badge} />}
        </span>
      )}
    </NavLink>
  )
}

function MobileNavLink({
  to,
  end,
  children,
  carryDates = true,
  badge,
}: {
  to: string
  end?: boolean
  children: React.ReactNode
  carryDates?: boolean
  badge?: number
}) {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const start = params.get('start')
  const endParam = params.get('end')
  const carry = new URLSearchParams()
  if (carryDates && start) carry.set('start', start)
  if (carryDates && endParam) carry.set('end', endParam)
  const target = carry.toString() ? `${to}?${carry.toString()}` : to
  return (
    <NavLink
      to={target}
      end={end}
      className={({ isActive }) =>
        `pennie-focus-ring flex items-center min-h-[48px] px-4 rounded-2xl text-base font-semibold transition-colors ${
          isActive
            ? 'text-pennie-navy bg-pennie-beige'
            : 'text-pennie-graphite hover:text-pennie-navy hover:bg-pennie-beige/60'
        }`
      }
    >
      {({ isActive }) => (
        <span className="inline-flex items-center gap-3">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isActive ? 'bg-pennie-blue-dark' : 'bg-transparent'
            }`}
            aria-hidden="true"
          />
          {children}
          {badge != null && <NavBadge count={badge} />}
        </span>
      )}
    </NavLink>
  )
}
