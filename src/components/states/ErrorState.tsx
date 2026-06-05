import { AlertTriangle, RefreshCw } from 'lucide-react'

/**
 * Retryable error state. `onRetry` should be a React Query `refetch`.
 * `compact` is for in-card use (call-detail alerts section, panels).
 */
export function ErrorState({
  title = "Couldn't load this",
  message = 'Something went wrong fetching this data. Try again in a moment.',
  onRetry,
  compact = false,
}: {
  title?: string
  message?: string
  onRetry?: () => void
  compact?: boolean
}) {
  if (compact) {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-2xl bg-pennie-beige px-4 py-3">
        <AlertTriangle
          className="w-4 h-4 text-pennie-peach-dark flex-none"
          aria-hidden="true"
        />
        <p className="flex-1 text-sm text-pennie-navy">{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="pennie-focus-ring text-xs font-semibold text-pennie-blue-deeper hover:underline underline-offset-4"
          >
            Retry
          </button>
        )}
      </div>
    )
  }
  return (
    <div role="alert" className="p-16 text-center">
      <div className="pennie-icon-chip mx-auto mb-4 bg-pennie-beige">
        <AlertTriangle className="w-6 h-6 text-pennie-peach-dark" aria-hidden="true" />
      </div>
      <p className="text-pennie-navy font-semibold text-lg">{title}</p>
      <p className="text-sm text-muted-foreground mt-1">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="pennie-focus-ring mt-4 inline-flex items-center gap-2 rounded-full bg-pennie-navy px-4 py-2 text-sm font-semibold text-pennie-white hover:bg-pennie-navy/90 transition-colors"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Try again
        </button>
      )}
    </div>
  )
}
