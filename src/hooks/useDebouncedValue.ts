import { useEffect, useState } from 'react'

/**
 * Returns a value that lags `value` by `delay` ms. Useful for search inputs
 * that drive network requests — we want the latest keystroke in local state
 * for responsive UI, but a delayed copy for the actual fetch.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])

  return debounced
}
