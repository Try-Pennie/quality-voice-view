type HistoryNavigationGuard = (event: PopStateEvent) => void

let activeGuard: HistoryNavigationGuard | null = null

// Register before BrowserRouter mounts so a cancelled POP cannot transiently
// unmount the editor and erase its draft before the history entry is restored.
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', event => activeGuard?.(event))
}

export function registerHistoryNavigationGuard(guard: HistoryNavigationGuard): () => void {
  activeGuard = guard
  return () => {
    if (activeGuard === guard) activeGuard = null
  }
}
