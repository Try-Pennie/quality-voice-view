import { useAuth } from '../hooks/useAuth'
import { Button } from './ui/button'

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth()

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-foreground">
              Agent Manager Dashboard
            </h1>

            <div className="flex items-center gap-4">
              <div className="text-sm text-muted-foreground">
                {user?.email}
              </div>
              <Button
                onClick={signOut}
                variant="destructive"
                size="sm"
              >
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}
