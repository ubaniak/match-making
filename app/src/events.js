// Event statuses and the day-time rules from plan/events.md. The database enforces the same
// rules (save_event_times); these let the form explain problems before saving.
import { todayIso } from './dates'

export const statusLabels = { requested: 'Requested', active: 'Active', done: 'Done', cancelled: 'Cancelled' }

// Events turn Done the day after their end date. The nightly job does it in the database;
// this covers the hours before it runs (and demo mode).
export function effectiveStatus(event) {
  if ((event.status === 'requested' || event.status === 'active') && event.end_date < todayIso(event.timezone)) return 'done'
  return event.status
}

export const isOpen = (event) => effectiveStatus(event) === 'active'
export const isEditableStatus = (event) => ['requested', 'active'].includes(effectiveStatus(event))

export const MIN_WEIGH_IN_MINUTES = 120
export const MIN_GAP_MINUTES = 180

export function toMinutes(time) {
  if (!time) return null
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

// Problems with one day's times: { weighIn: [...], sessions: [...] }. Empty arrays mean fine.
export function dayProblems(day) {
  const weighIn = []
  const sessions = []
  const start = toMinutes(day.weigh_in_start)
  const end = toMinutes(day.weigh_in_end)
  if (start == null || end == null) {
    weighIn.push('Give the weigh-in a start and an end time.')
  } else if (end - start < MIN_WEIGH_IN_MINUTES) {
    weighIn.push('The weigh-in must last at least 2 hours.')
  }
  const starts = (day.sessions ?? []).map((s) => toMinutes(s.starts_at))
  if (starts.length === 0) sessions.push('Add at least one bout session.')
  if (starts.some((s) => s == null)) sessions.push('Every bout session needs a start time.')
  if (new Set(starts).size !== starts.length) sessions.push('Two sessions start at the same time.')
  const first = Math.min(...starts.filter((s) => s != null))
  if (end != null && Number.isFinite(first) && first - end < MIN_GAP_MINUTES) {
    sessions.push('The weigh-in must end at least 3 hours before the first bout.')
  }
  return { weighIn, sessions }
}

export const hasProblems = (problems) => problems.weighIn.length + problems.sessions.length > 0

// Sessions in start-time order, for display.
export const sortedSessions = (sessions) => [...(sessions ?? [])].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
