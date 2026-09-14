import { Component, Suspense, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

type RouteErrorBoundaryProps = {
  readonly children: ReactNode
}

type RouteErrorBoundaryState = {
  readonly failed: boolean
}

class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <section className="pennie-card mx-auto max-w-xl text-center">
        <h1 className="font-display text-2xl text-pennie-navy">
          This page didn&apos;t load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page files may have changed while Eavesly was open. Reload to try
          again.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="pennie-focus-ring mt-5 min-h-10 rounded-full bg-pennie-navy px-5 text-sm font-semibold text-pennie-white hover:bg-pennie-navy/90"
        >
          Reload page
        </button>
      </section>
    )
  }
}

function RouteLoading() {
  return (
    <div
      role="status"
      aria-label="Loading page"
      className="flex min-h-48 items-center justify-center text-sm font-semibold text-muted-foreground"
    >
      Loading page…
    </div>
  )
}

/** Keep route-level loading and download failures inside the current app shell. */
export function RouteBoundary({ children }: { children: ReactNode }) {
  const location = useLocation()

  // Search params are in-page state; only a real route change should reset
  // healthy children or clear a failed route boundary.
  return (
    <RouteErrorBoundary key={location.pathname}>
      <Suspense fallback={<RouteLoading />}>{children}</Suspense>
    </RouteErrorBoundary>
  )
}
