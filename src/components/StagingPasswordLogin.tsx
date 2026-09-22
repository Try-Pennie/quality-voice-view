import { useState, type FormEvent } from 'react'
import { supabase } from '@/integrations/supabase/client'

const accounts = {
  manager: 'eavesly-staging-manager-xuvveqaiz@trypennie.com',
  kris: 'eavesly-staging-kris-xuvveqaiz@trypennie.com',
} as const

/** Preview account choice is authenticated by Supabase, not a client-side role override. */
export default function StagingPasswordLogin() {
  const [view, setView] = useState<'manager' | 'kris'>('manager')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !password) return
    setPending(true)
    setError(null)
    try {
      const result = await supabase.auth.signInWithPassword({ email: accounts[view], password })
      if (result.error) {
        setError(result.error.status === 429
          ? 'Too many attempts. Please wait a moment and try again.'
          : result.error.code === 'invalid_credentials'
            ? 'That password was not recognized. Please try again.'
            : 'Unable to sign in right now. Please try again shortly.')
      } else {
        setPassword('')
        // LoginPage navigates from the actual authenticated identity, not the selection.
      }
    } catch {
      // Never echo Auth responses, passwords or session tokens into UI/logs.
      setError('Unable to connect. Check your connection and try again.')
    } finally {
      setPending(false)
    }
  }

  return <form onSubmit={signIn} className="space-y-5" aria-label="Staging sign in" aria-busy={pending}>
    <div className="space-y-2">
      <label htmlFor="staging-view" className="block text-sm font-semibold text-pennie-graphite">View to test</label>
      <select id="staging-view" value={view} disabled={pending}
        onChange={event => { if (event.target.value === 'manager' || event.target.value === 'kris') setView(event.target.value) }}
        className="pennie-focus-ring min-h-[48px] w-full rounded-xl border border-border bg-white px-3 text-base">
        <option value="manager">Manager view</option>
        <option value="kris">Kris view</option>
      </select>
    </div>
    <div className="space-y-2">
      <label htmlFor="staging-password" className="block text-sm font-semibold text-pennie-graphite">Preview password</label>
      <input type="hidden" name="username" autoComplete="username" value={accounts[view]} />
      <input id="staging-password" name="password" type="password" autoComplete="current-password" required
        value={password} disabled={pending} onChange={event => setPassword(event.target.value)}
        aria-invalid={Boolean(error)} aria-describedby={error ? 'staging-login-error' : undefined}
        className="pennie-focus-ring min-h-[48px] w-full rounded-xl border border-border bg-white px-3 text-base" />
    </div>
    {error && <p id="staging-login-error" role="alert" className="text-sm text-pennie-peach-deeper">{error}</p>}
    <button type="submit" disabled={pending || !password}
      className="pennie-focus-ring inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-pennie-navy px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
      {pending ? 'Signing in…' : 'Open preview'}
    </button>
    <p className="text-xs text-muted-foreground">To try the other view, sign out and choose it here. All changes stay in staging.</p>
  </form>
}
