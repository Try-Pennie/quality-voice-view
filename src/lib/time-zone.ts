// All charts and date filters bucket on Eastern time so views stay
// consistent regardless of where the manager is sitting. Picker state
// keeps a JS Date whose LOCAL year/month/day matches the intended ET
// year/month/day (the picker doesn't care about the actual time
// component); fetch and bucketing layers convert to absolute UTC
// moments using the helpers below.

export const BUSINESS_TIMEZONE = 'America/New_York'
export const BUSINESS_TIMEZONE_LABEL = 'ET'

const ymdFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

// Returns YYYY-MM-DD as observed in the business timezone for the given
// absolute moment.
export function ymdInBusinessTZ(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return ymdFmt.format(d)
}

const wallClockFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

// Returns the offset in minutes between UTC and the business TZ for the
// given moment (handles EDT vs EST automatically). Negative for west of UTC.
function tzOffsetMinutes(date: Date): number {
  const parts = wallClockFmt.formatToParts(date)
  const get = (t: string) => +(parts.find(p => p.type === t)?.value ?? '0')
  let hour = get('hour')
  if (hour === 24) hour = 0 // Intl edge case at midnight
  const wallClockUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  )
  return Math.round((wallClockUTC - date.getTime()) / 60000)
}

// Returns the UTC moment that corresponds to the given Y/M/D h:m:s wall
// clock time in the business timezone. Two-pass adjustment handles DST.
export function dateInBusinessTZ(
  year: number,
  month: number,
  day: number,
  hour = 0,
  min = 0,
  sec = 0,
  ms = 0,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, min, sec, ms)
  const offset1 = tzOffsetMinutes(new Date(utcGuess))
  const utc1 = utcGuess - offset1 * 60000
  const offset2 = tzOffsetMinutes(new Date(utc1))
  return new Date(utcGuess - offset2 * 60000)
}

// Picker-state Dates carry the intended ET Y/M/D in their LOCAL components.
// These convert to the absolute UTC moment for the start/end of that ET day,
// for use as DB filter bounds.
export function startOfBusinessDay(d: Date): Date {
  return dateInBusinessTZ(d.getFullYear(), d.getMonth() + 1, d.getDate(), 0, 0, 0, 0)
}
export function endOfBusinessDay(d: Date): Date {
  return dateInBusinessTZ(
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
    23,
    59,
    59,
    999,
  )
}
