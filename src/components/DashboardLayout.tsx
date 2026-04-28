import { useEffect } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { BookOpen, Lightbulb, LightbulbOff } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { HintsProvider, useHints } from './ui/help-hint'

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <HintsProvider>
      <DashboardChrome>{children}</DashboardChrome>
    </HintsProvider>
  )
}

function DashboardChrome({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth()
  const { enabled: hintsEnabled, toggle: toggleHints } = useHints()
  const navigate = useNavigate()
  const location = useLocation()

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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-pennie-white/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex flex-wrap justify-between items-center gap-4 py-4">
            <div className="flex items-center gap-8">
              <a
                href="/dashboard"
                className="font-display text-2xl tracking-[-0.02em] text-pennie-navy font-bold hover:opacity-80 transition-opacity"
              >
                Eavesly
              </a>
              <nav aria-label="Primary" className="flex items-center gap-1">
                <DashNavLink to="/dashboard" end>
                  Calls
                </DashNavLink>
                <DashNavLink to="/dashboard/team">Team</DashNavLink>
                <DashNavLink to="/dashboard/alerts">Alerts</DashNavLink>
              </nav>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleHints}
                aria-pressed={hintsEnabled}
                title={
                  hintsEnabled
                    ? 'Hide help hints across the dashboard'
                    : 'Show help hints across the dashboard'
                }
                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-full text-pennie-graphite/70 hover:text-pennie-navy hover:bg-pennie-beige focus:outline-none focus:ring-2 focus:ring-pennie-blue-dark/70 transition-colors"
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
                  `min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-pennie-blue-dark/70 transition-colors ${
                    isActive
                      ? 'text-pennie-navy bg-pennie-beige'
                      : 'text-pennie-graphite/70 hover:text-pennie-navy hover:bg-pennie-beige'
                  }`
                }
              >
                <BookOpen className="w-4 h-4" aria-hidden="true" />
                <span className="sr-only">Open glossary</span>
              </NavLink>
              <span className="text-sm text-muted-foreground hidden sm:inline">
                {user?.email}
              </span>
              <button
                type="button"
                onClick={signOut}
                className="min-h-[36px] px-3 py-1.5 rounded-full text-sm font-semibold text-pennie-graphite hover:bg-pennie-beige transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 lg:px-8 py-10">{children}</main>
    </div>
  )
}

function DashNavLink({
  to,
  end,
  children,
}: {
  to: string
  end?: boolean
  children: React.ReactNode
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `relative px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
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
        </span>
      )}
    </NavLink>
  )
}
