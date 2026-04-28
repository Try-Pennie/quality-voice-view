// Supabase REST caps every response at ~1000 rows server-side regardless
// of the client's `.limit()` value. `fetchAllPaginated` pages through with
// `.range()` until a partial page signals end-of-stream. Required for any
// query whose result set may exceed 1000 rows (e.g. all calls in a
// multi-day window across many agents).

export async function fetchAllPaginated<T>(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = 1000,
  hardCap = 100_000, // safety net so a misuse can't loop forever
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  while (from < hardCap) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) {
      console.error('Paginated fetch error:', error)
      return all
    }
    const rows = (data || []) as T[]
    all.push(...rows)
    if (rows.length < pageSize) break
    from += pageSize
  }
  return all
}
