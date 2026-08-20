/** A bounded page of items plus display-ready range metadata. */
export type PageSlice<T> = {
  readonly items: ReadonlyArray<T>
  readonly page: number
  readonly pageCount: number
  readonly start: number
  readonly end: number
  readonly total: number
}

/** Returns a clamped, one-based page without mutating the source items. */
export function paginate<T>(
  items: ReadonlyArray<T>,
  requestedPage: number,
  pageSize: number,
): PageSlice<T> {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError('pageSize must be a positive integer')

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const page = Math.min(Math.max(1, Math.floor(requestedPage)), pageCount)
  const startIndex = (page - 1) * pageSize
  const endIndex = Math.min(startIndex + pageSize, items.length)

  return {
    items: items.slice(startIndex, endIndex),
    page,
    pageCount,
    start: items.length === 0 ? 0 : startIndex + 1,
    end: endIndex,
    total: items.length,
  }
}
