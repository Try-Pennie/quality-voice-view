import { Component, Suspense, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

type RouteErrorBoundaryProps = {
  readonly children: ReactNode
  readonly resetKey: string
}

type RouteErrorBoundaryState = {
  readonly failed: boolean
  readonly resetKey: string
}

class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { failed: false, resetKey: this.props.resetKey }

  static getDerivedStateFromProps(
    props: RouteErrorBoundaryProps,
    state: RouteErrorBoundaryState,
  ): RouteErrorBoundaryState | null {
    return props.resetKey === state.resetKey
      ? null
      : { failed: false, resetKey: props.resetKey }
  }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(): void {
    console.error({ operation: 'render_route_page' })
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <section className="pennie-card mx-auto max-w-xl text-center">
        <h1 className="font-display text-2xl text-pennie-navy">
          This page couldn&apos;t open
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something prevented this page from opening. Reload to try again, or
          use the navigation to open another page.
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

  // Paths can be in-page state too (the Review drawer has its own URL).
  // Reset errors on navigation without remounting healthy page children.
  return (
    <RouteErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<RouteLoading />}>{children}</Suspense>
    </RouteErrorBoundary>
  )
}
