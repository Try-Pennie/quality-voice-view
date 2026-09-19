type HistoryNavigationGuard = (event: PopStateEvent) => void

let activeGuard: HistoryNavigationGuard | null = null

// Eagerly imported by main.tsx before BrowserRouter mounts, so a cancelled POP
// cannot unmount the editor and erase its draft before history is restored.
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', event => activeGuard?.(event))
}

export function registerHistoryNavigationGuard(guard: HistoryNavigationGuard): () => void {
  activeGuard = guard
  return () => {
    if (activeGuard === guard) activeGuard = null
  }
}
