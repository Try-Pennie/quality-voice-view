import { NavLink } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth()

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
                <DashNavLink to="/dashboard/alerts">Alerts</DashNavLink>
              </nav>
            </div>

            <div className="flex items-center gap-4">
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
