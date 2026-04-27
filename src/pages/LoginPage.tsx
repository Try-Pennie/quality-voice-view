import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function LoginPage() {
  const { user, loading, signInWithGoogle } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (user && !loading) {
      navigate('/dashboard')
    }
  }, [user, loading, navigate])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-base text-muted-foreground">Loading…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-background">
      <aside className="lg:col-span-7 hidden lg:flex flex-col justify-between p-12 bg-pennie-navy text-pennie-white">
        <div className="font-display text-3xl font-bold tracking-[-0.02em]">
          Eavesly
        </div>
        <div className="max-w-xl space-y-4 animate-pennie-rise">
          <p className="pennie-label text-pennie-blue-main">Pennie · Internal</p>
          <h1 className="font-display text-[clamp(2.5rem,4.5vw,4rem)] leading-[1.05] tracking-[-0.02em] font-bold">
            Coaching, not surveillance.
          </h1>
          <p className="text-pennie-white/70 text-lg leading-relaxed">
            Eavesly flags the calls worth reviewing so managers can spend their
            time where it matters — coaching agents, not combing transcripts.
          </p>
        </div>
        <p className="text-xs text-pennie-white/40">Pennie Mgmt, LLC · trypennie.com</p>
      </aside>

      <main className="lg:col-span-5 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm space-y-8 animate-pennie-rise">
          <div className="lg:hidden font-display text-2xl font-bold tracking-[-0.02em] text-pennie-navy">
            Eavesly
          </div>
          <div className="space-y-2">
            <p className="pennie-label">Sign in</p>
            <h2 className="font-display text-3xl tracking-[-0.02em] text-pennie-navy font-bold">
              Welcome back.
            </h2>
            <p className="text-pennie-graphite/70 text-sm">
              Sign in with your Pennie Google account to view alerts, calls, and
              team performance.
            </p>
          </div>

          <button
            type="button"
            onClick={signInWithGoogle}
            className="w-full inline-flex items-center justify-center gap-3 min-h-[48px] px-5 py-3 rounded-full bg-pennie-white border border-border text-sm font-semibold text-pennie-graphite hover:bg-pennie-beige transition-colors shadow-resting"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>

          <p className="text-xs text-muted-foreground text-center">
            Need access? Ask ops to add you to{' '}
            <code className="font-mono text-[11px] bg-pennie-beige px-1.5 py-0.5 rounded-md">
              agent_manager_mapping
            </code>
            .
          </p>
        </div>
      </main>
    </div>
  )
}
