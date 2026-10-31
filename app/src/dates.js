// Event dates are plain calendar days ('YYYY-MM-DD'), handled in UTC so the browser's
// time zone never shifts them by a day.

const MS_PER_DAY = 24 * 60 * 60 * 1000
export const MAX_EVENT_DAYS = 31

const toDate = (iso) => new Date(`${iso}T00:00:00Z`)
const toIso = (date) => date.toISOString().slice(0, 10)

export function todayIso() {
  const now = new Date()
  return toIso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())))
}

export function addDays(iso, count) {
  return toIso(new Date(toDate(iso).getTime() + count * MS_PER_DAY))
}

// Every day from start to end, inclusive. Empty when the range is backwards or too long.
export function daysBetween(start, end) {
  if (!start || !end) return []
  const count = Math.round((toDate(end) - toDate(start)) / MS_PER_DAY) + 1
  if (count < 1 || count > MAX_EVENT_DAYS) return []
  return Array.from({ length: count }, (_, i) => addDays(start, i))
}

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const shortDayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

export const formatDay = (iso) => dayFormat.format(toDate(iso))
export const formatShortDay = (iso) => shortDayFormat.format(toDate(iso))

export function formatDateRange(start, end) {
  if (start === end) return formatDay(start)
  return `${formatShortDay(start)} – ${formatDay(end)}`
}

// '09:00:00' from Postgres, or '09:00' from an input, shown as '09:00'.
export const formatTime = (time) => (time ? time.slice(0, 5) : '—')
