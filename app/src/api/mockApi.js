// A stand-in for Supabase so the app can be tried before a project exists.
// Only one special user can sign in, and everything is kept in this browser's storage.
// The password ships inside the page's JavaScript, so this is for demos, not for protecting anything.
// The demo admin can also preview the app as one of the sample coaches (see viewAs).

import { addDays, daysBetween, todayIso } from '../dates'

const ADMIN_EMAIL = (import.meta.env.VITE_MOCK_ADMIN_EMAIL || 'admin@matchmaking.test').toLowerCase()
const ADMIN_PASSWORD = import.meta.env.VITE_MOCK_ADMIN_PASSWORD || 'letmein'
const ADMIN_ID = 'mock-admin'

const SESSION_KEY = 'mock-session'
const DATA_KEY = 'mock-data-v1'

const seed = {
  coaches: [
    { id: 'coach-1', email: 'maria.lopez@example.com', name: 'Maria Lopez', state: 'Active' },
    { id: 'coach-2', email: 'dave.okafor@example.com', name: 'Dave Okafor', state: 'Active' },
    { id: null, email: 'sam.reid@example.com', name: 'Sam Reid', state: 'Invited' },
  ],
  athletes: [
    { id: 'athlete-1', name: 'Ali Hassan', date_of_birth: '2004-03-12', weight_class: 'Lightweight', club: 'Eastside BC', invite_email: 'ali@example.com', user_id: 'user-ali', coach_id: 'coach-1' },
    { id: 'athlete-2', name: 'Jade Murphy', date_of_birth: '2006-07-30', weight_class: 'Flyweight', club: 'Eastside BC', invite_email: 'jade@example.com', user_id: null, coach_id: 'coach-1' },
    { id: 'athlete-3', name: 'Tom Becker', date_of_birth: '2001-11-05', weight_class: 'Middleweight', club: 'Riverside Boxing', invite_email: null, user_id: null, coach_id: 'coach-2' },
  ],
  officials: [
    { id: 'official-1', name: 'Grace Adeyemi', qualifications: 'Level 3 referee', invite_email: 'grace@example.com', user_id: 'user-grace' },
    { id: 'official-2', name: 'Rob Turner', qualifications: 'Judge', invite_email: null, user_id: null },
  ],
}

// Sample events dated from today, so there's always something upcoming.
function seedEvents() {
  const today = todayIso()
  const start = addDays(today, 14)
  const single = addDays(today, 35)
  return {
    events: [
      {
        id: 'event-1', name: 'Eastside Winter Box Cup', venue: 'Eastside Leisure Centre',
        start_date: start, end_date: addDays(start, 1), owner_id: 'coach-1',
        days: [
          { day: start, weigh_in_time: '08:00', bouts_time: '12:00' },
          { day: addDays(start, 1), weigh_in_time: '08:30', bouts_time: '11:00' },
        ],
      },
      {
        id: 'event-2', name: 'Riverside Club Show', venue: 'Riverside Boxing Club',
        start_date: single, end_date: single, owner_id: 'coach-2',
        days: [{ day: single, weigh_in_time: '16:00', bouts_time: '19:00' }],
      },
    ],
    eventAthletes: [
      { event_id: 'event-1', athlete_id: 'athlete-1' },
      { event_id: 'event-1', athlete_id: 'athlete-3' },
    ],
  }
}

const allPermissions = [
  'public:read', 'pages:read', 'cards:read', 'cards:create', 'cards:manage', 'cards:submit-official',
  'cards:submit-athlete', 'athletes:read', 'athletes:create', 'athletes:write', 'officials:read',
  'officials:write', 'files:upload', 'users:manage', 'roles:manage', 'audit:read',
  'events:read', 'events:create', 'events:manage',
]

// Matches the coach grants in the migrations; 'own' scopes are checked in the functions below.
const coachPermissions = [
  'public:read', 'pages:read', 'cards:read', 'cards:create', 'cards:manage', 'cards:submit-athlete',
  'athletes:read', 'athletes:create', 'athletes:write', 'officials:read', 'files:upload',
  'events:read', 'events:manage',
]

// Storage can be blocked (private windows, strict settings); fall back to memory.
const memory = {}
function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key))
  } catch {
    return memory[key] ?? null
  }
}
function write(key, value) {
  memory[key] = value
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // memory copy above is enough for this visit
  }
}

function data() {
  const stored = read(DATA_KEY) ?? structuredClone(seed)
  stored.officials ??= structuredClone(seed.officials) // saved before officials existed
  if (!stored.events) Object.assign(stored, seedEvents()) // saved before events existed
  return stored
}

function currentUserId() {
  return read(SESSION_KEY)?.user.id
}

// Admins can change any event; a coach only the events they own.
function eventForEditing(current, eventId) {
  const event = current.events.find((e) => e.id === eventId)
  if (!event) throw new Error('That event no longer exists')
  const userId = currentUserId()
  if (userId !== ADMIN_ID && event.owner_id !== userId) throw new Error('Only the event\'s owner can change it')
  return event
}

function withEventExtras(current, event) {
  const owner = current.coaches.find((c) => c.id === event.owner_id) ?? null
  const entries = current.eventAthletes.filter((ea) => ea.event_id === event.id)
  return { ...event, owner, athlete_count: entries.length, entries }
}

const listeners = new Set()
function setSession(session) {
  write(SESSION_KEY, session)
  listeners.forEach((callback) => callback(session))
}

const byName = (a, b) => (a.name || a.email).localeCompare(b.name || b.email)

export const mockApi = {
  mode: 'mock',
  adminEmail: ADMIN_EMAIL,
  adminId: ADMIN_ID,

  async getSession() {
    return read(SESSION_KEY)
  },

  onAuthChange(callback) {
    listeners.add(callback)
    return () => listeners.delete(callback)
  },

  async signOut() {
    setSession(null)
  },

  async signInWithPassword(email, password) {
    if (email.trim().toLowerCase() !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      throw new Error('That email and password don\'t match the demo account.')
    }
    setSession({ user: { id: ADMIN_ID, email: ADMIN_EMAIL } })
  },

  // Demo only: switch between the admin and the sample coaches without a second login.
  async viewAs(userId) {
    const coach = data().coaches.find((c) => c.id && c.id === userId)
    setSession(coach ? { user: { id: coach.id, email: coach.email } } : { user: { id: ADMIN_ID, email: ADMIN_EMAIL } })
  },

  async loadMe(userId) {
    const coach = data().coaches.find((c) => c.id && c.id === userId)
    if (coach) {
      return {
        profile: { id: coach.id, email: coach.email, name: coach.name, role_id: 'coach', status: 'active', roles: { name: 'Coaches' } },
        permissions: coachPermissions,
      }
    }
    return {
      profile: { id: ADMIN_ID, email: ADMIN_EMAIL, name: 'Demo Admin', role_id: 'admin', status: 'active', roles: { name: 'Admins' } },
      permissions: allPermissions,
    }
  },

  async listCoaches() {
    return [...data().coaches].sort(byName)
  },

  async addCoach({ name, email }) {
    const clean = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('That email address doesn\'t look right')
    const current = data()
    const existing = current.coaches.find((c) => c.email === clean)
    if (existing) {
      existing.name = name.trim() || existing.name
    } else {
      current.coaches.push({ id: null, email: clean, name: name.trim(), state: 'Invited' })
    }
    write(DATA_KEY, current)
    return existing ? 'updated' : 'invited'
  },

  async listAthletes() {
    const current = data()
    return current.athletes
      .map((a) => ({ ...a, coach: current.coaches.find((c) => c.id && c.id === a.coach_id) ?? null }))
      .sort(byName)
  },

  async addAthlete(athlete) {
    const current = data()
    current.athletes.push({ ...athlete, id: crypto.randomUUID(), user_id: null })
    write(DATA_KEY, current)
  },

  async listOfficials() {
    return [...data().officials].sort(byName)
  },

  async addOfficial(official) {
    const current = data()
    current.officials.push({ ...official, id: crypto.randomUUID(), user_id: null })
    write(DATA_KEY, current)
  },

  async listEvents() {
    const current = data()
    return current.events
      .map((e) => withEventExtras(current, e))
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
  },

  async getEvent(eventId) {
    const current = data()
    const event = current.events.find((e) => e.id === eventId)
    if (!event) return null
    const result = withEventExtras(current, event)
    result.athletes = result.entries
      .map((ea) => current.athletes.find((a) => a.id === ea.athlete_id))
      .filter(Boolean)
      .map((a) => ({ ...a, coach: current.coaches.find((c) => c.id && c.id === a.coach_id) ?? null }))
      .sort(byName)
    return result
  },

  // Creates the event when there's no id. Mirrors the checks in save_event and check_event.
  async saveEvent({ id, name, venue, startDate, endDate, ownerId, days }) {
    const current = data()
    const isAdmin = currentUserId() === ADMIN_ID
    const range = daysBetween(startDate, endDate)
    if (!name.trim()) throw new Error('Give the event a name')
    if (range.length === 0) throw new Error('The end date must be on or after the start date, and within 31 days of it')
    if (range.some((day) => !days.find((d) => d.day === day && d.weigh_in_time && d.bouts_time))) {
      throw new Error('Every day of the event needs a weigh-in time and a bout time')
    }
    if (!current.coaches.some((c) => c.id && c.id === ownerId && c.state === 'Active')) {
      throw new Error('An event\'s owner must be an active coach')
    }

    const fields = {
      name: name.trim(),
      venue: venue.trim() || null,
      start_date: startDate,
      end_date: endDate,
      days: range.map((day) => {
        const { weigh_in_time, bouts_time } = days.find((d) => d.day === day)
        return { day, weigh_in_time, bouts_time }
      }),
    }

    if (!id) {
      if (!isAdmin) throw new Error('Only Admins can create events')
      const event = { id: crypto.randomUUID(), owner_id: ownerId, ...fields }
      current.events.push(event)
      write(DATA_KEY, current)
      return event.id
    }

    const event = eventForEditing(current, id)
    if (ownerId !== event.owner_id && !isAdmin) throw new Error('Only Admins can change who owns an event')
    Object.assign(event, fields, { owner_id: ownerId })
    write(DATA_KEY, current)
    return id
  },

  async deleteEvent(eventId) {
    if (currentUserId() !== ADMIN_ID) throw new Error('Only Admins can delete events')
    const current = data()
    current.events = current.events.filter((e) => e.id !== eventId)
    current.eventAthletes = current.eventAthletes.filter((ea) => ea.event_id !== eventId)
    write(DATA_KEY, current)
  },

  async addEventAthlete(eventId, athleteId) {
    const current = data()
    eventForEditing(current, eventId)
    if (!current.eventAthletes.some((ea) => ea.event_id === eventId && ea.athlete_id === athleteId)) {
      current.eventAthletes.push({ event_id: eventId, athlete_id: athleteId })
      write(DATA_KEY, current)
    }
  },

  async removeEventAthlete(eventId, athleteId) {
    const current = data()
    eventForEditing(current, eventId)
    current.eventAthletes = current.eventAthletes.filter((ea) => !(ea.event_id === eventId && ea.athlete_id === athleteId))
    write(DATA_KEY, current)
  },

  resetDemoData() {
    write(DATA_KEY, null)
  },
}
