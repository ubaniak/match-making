// The roles an official works at an event (migration 42). Each is yes/no, so an official can be any
// mix of them. They pick them when they accept the event, and per bout from those same roles.
export const eventRoles = [
  { key: 'referee', label: 'Referee' },
  { key: 'judge', label: 'Judge' },
  { key: 'supervisor', label: 'Supervisor' },
  { key: 'timekeeper', label: 'Timekeeper' },
]

// The role keys that are on for a row: ['referee', 'judge'].
export const rolesOf = (row) => eventRoles.filter((r) => row?.[r.key]).map((r) => r.key)

// 'Referee, Judge', or the fallback when none are on.
export function rolesText(row, none = 'No roles chosen') {
  const on = eventRoles.filter((r) => row?.[r.key]).map((r) => r.label)
  return on.length ? on.join(', ') : none
}

// { judge: true, referee: false, ... } from a list of keys.
export const rolesFlags = (keys) => Object.fromEntries(eventRoles.map((r) => [r.key, keys.includes(r.key)]))
