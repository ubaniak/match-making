// Event dates are plain calendar days ('YYYY-MM-DD'), handled in UTC so the browser's
// time zone never shifts them by a day.

const MS_PER_DAY = 24 * 60 * 60 * 1000
export const MAX_EVENT_DAYS = 31

const toDate = (iso) => new Date(`${iso}T00:00:00Z`)
const toIso = (date) => date.toISOString().slice(0, 10)

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

// ---------------------------------------------------------------------------
// Time zones. Each event has one (an IANA name like 'America/Winnipeg'); its weigh-in and
// bout times are wall-clock times there, and "today" for the event is today there.
// ---------------------------------------------------------------------------

export const DEFAULT_TIME_ZONE = 'America/Winnipeg'

export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE
  } catch {
    return DEFAULT_TIME_ZONE
  }
}

// Every time zone the browser knows, with the browser's own zone first.
export function timeZoneOptions(current) {
  let all = []
  try {
    all = Intl.supportedValuesOf('timeZone')
  } catch {
    all = [DEFAULT_TIME_ZONE]
  }
  const first = [...new Set([current, browserTimeZone()].filter(Boolean))]
  return [...first, ...all.filter((tz) => !first.includes(tz))]
}

// The parts of a moment as seen on a wall clock in a time zone.
function wallParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)
  const get = (type) => Number(parts.find((p) => p.type === type).value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

const pad = (n) => String(n).padStart(2, '0')

// Today's date ('YYYY-MM-DD') in a time zone; the browser's own date when none is given.
export function todayIso(timeZone) {
  if (!timeZone) {
    const now = new Date()
    return toIso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())))
  }
  const p = wallParts(new Date(), timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

// Short zone name on a given day, e.g. 'CDT' or 'CST' (it changes with daylight saving).
export function zoneAbbr(timeZone, isoDay) {
  if (!timeZone) return ''
  const when = isoDay ? new Date(`${isoDay}T12:00:00Z`) : new Date()
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(when).find((p) => p.type === 'timeZoneName')
    return part?.value ?? timeZone
  } catch {
    return timeZone
  }
}

// 'America/Winnipeg (CDT)'
export const zoneLabel = (timeZone, isoDay) => `${timeZone.replaceAll('_', ' ')} (${zoneAbbr(timeZone, isoDay)})`

// A datetime-local value ('YYYY-MM-DDTHH:MM') read as wall-clock time in timeZone -> ISO UTC.
export function zonedInputToIso(value, timeZone) {
  if (!value) return ''
  const [d, t] = value.split('T')
  const [y, mo, da] = d.split('-').map(Number)
  const [h, mi] = t.split(':').map(Number)
  const asUtc = Date.UTC(y, mo - 1, da, h, mi)
  // Guess, then correct by the zone's offset at that moment (twice covers DST edges).
  let guess = asUtc
  for (let i = 0; i < 2; i++) {
    const p = wallParts(new Date(guess), timeZone)
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
    guess += asUtc - shown
  }
  return new Date(guess).toISOString()
}

// ISO timestamp -> datetime-local value showing the wall-clock time in timeZone.
export function isoToZonedInput(iso, timeZone) {
  if (!iso) return ''
  const p = wallParts(new Date(iso), timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

// A moment shown in a time zone, e.g. 'Sat, Oct 31, 07:09 PM CDT'.
export function formatInZone(iso, timeZone) {
  return new Date(iso).toLocaleString(undefined, {
    timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  })
}

// Wall-clock times on an event day, moved into another zone for a "your time" line, e.g.
// yourTimes('2026-11-14', ['08:00', '10:00'], 'America/Winnipeg', 'America/Toronto')
//   -> '09:00–11:00 EST'. A time that lands on another date gets its short day in front.
export function yourTimes(day, times, fromZone, toZone, sep = '–') {
  const shown = times.map((time) => {
    const [d, t] = isoToZonedInput(zonedInputToIso(`${day}T${time.slice(0, 5)}`, fromZone), toZone).split('T')
    return d === day ? t : `${formatShortDay(d)} ${t}`
  })
  return `${shown.join(sep)} ${zoneAbbr(toZone, day)}`
}
