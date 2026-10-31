// A stand-in for Supabase so the app can be tried before a project exists.
// Only one special user can sign in, and everything is kept in this browser's storage.
// The password ships inside the page's JavaScript, so this is for demos, not for protecting anything.
// The demo admin can also preview the app as one of the sample users (see viewAs).

import { athleteProblems } from '../athletes'
import { addDays, daysBetween, todayIso } from '../dates'

const ADMIN_EMAIL = (import.meta.env.VITE_MOCK_ADMIN_EMAIL || 'admin@matchmaking.test').toLowerCase()
const ADMIN_PASSWORD = import.meta.env.VITE_MOCK_ADMIN_PASSWORD || 'letmein'
const ADMIN_ID = 'mock-admin'

const SESSION_KEY = 'mock-session'
const DATA_KEY = 'mock-data-v3' // v3: athletes gained gender, weight and bouts

// Sample events dated from today, so there's always something upcoming.
function seed() {
  const today = todayIso()
  const start = addDays(today, 14)
  const single = addDays(today, 35)
  return {
    users: [
      { id: 'user-1', email: 'maria.lopez@example.com', name: 'Maria Lopez', state: 'Active' },
      { id: 'user-2', email: 'dave.okafor@example.com', name: 'Dave Okafor', state: 'Active' },
      { id: 'user-3', email: 'priya.shah@example.com', name: 'Priya Shah', state: 'Active' },
      { id: null, email: 'sam.reid@example.com', name: 'Sam Reid', state: 'Invited' },
    ],
    athletes: [
      { id: 'athlete-1', name: 'Ali Hassan', date_of_birth: '2004-03-12', gender: 'male', weight_kg: 60.5, bouts: 12, club: 'Eastside BC', invite_email: 'ali@example.com', user_id: 'user-ali', coach_id: 'user-1' },
      { id: 'athlete-2', name: 'Jade Murphy', date_of_birth: '2006-07-30', gender: 'female', weight_kg: 51, bouts: 3, club: 'Eastside BC', invite_email: 'jade@example.com', user_id: null, coach_id: 'user-1' },
      { id: 'athlete-3', name: 'Tom Becker', date_of_birth: '2001-11-05', gender: 'male', weight_kg: 74.2, bouts: 27, club: 'Riverside Boxing', invite_email: null, user_id: null, coach_id: 'user-2' },
    ],
    officials: [
      { id: 'official-1', name: 'Grace Adeyemi', qualifications: 'Level 3 referee', invite_email: 'grace@example.com', user_id: 'user-grace' },
      { id: 'official-2', name: 'Rob Turner', qualifications: 'Judge', invite_email: 'rob@example.com', user_id: null },
    ],
    events: [
      {
        id: 'event-1', name: 'Eastside Winter Box Cup', venue: 'Eastside Leisure Centre',
        start_date: start, end_date: addDays(start, 1),
        days: [
          { day: start, weigh_in_time: '08:00', bouts_time: '12:00' },
          { day: addDays(start, 1), weigh_in_time: '08:30', bouts_time: '11:00' },
        ],
      },
      {
        id: 'event-2', name: 'Riverside Club Show', venue: 'Riverside Boxing Club',
        start_date: single, end_date: single,
        days: [{ day: single, weigh_in_time: '16:00', bouts_time: '19:00' }],
      },
    ],
    eventMembers: [
      { event_id: 'event-1', user_id: 'user-1', role: 'owner' },
      { event_id: 'event-1', user_id: 'user-2', role: 'coach' },
      { event_id: 'event-1', user_id: 'user-3', role: 'viewer' },
      { event_id: 'event-2', user_id: 'user-2', role: 'owner' },
      { event_id: 'event-2', user_id: 'user-3', role: 'admin' },
    ],
    eventAthletes: [
      { event_id: 'event-1', athlete_id: 'athlete-1', added_by: 'user-1' },
      { event_id: 'event-1', athlete_id: 'athlete-3', added_by: 'user-2' },
    ],
  }
}

const allPermissions = [
  'public:read', 'pages:read', 'cards:read', 'cards:create', 'cards:manage', 'cards:submit-official',
  'cards:submit-athlete', 'athletes:read', 'athletes:create', 'athletes:write', 'officials:read',
  'officials:write', 'files:upload', 'users:manage', 'roles:manage', 'audit:read', 'events:create',
]

// Matches the Users grants in the migrations; 'own' scopes are checked in the functions below.
const userPermissions = [
  'public:read', 'pages:read', 'cards:read', 'cards:create', 'cards:manage', 'cards:submit-athlete',
  'athletes:read', 'athletes:create', 'athletes:write', 'officials:read', 'files:upload', 'events:create',
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
  return read(DATA_KEY) ?? seed()
}

const listeners = new Set()
function setSession(session) {
  write(SESSION_KEY, session)
  listeners.forEach((callback) => callback(session))
}

const byName = (a, b) => (a.name || a.email).localeCompare(b.name || b.email)

function currentUserId() {
  return read(SESSION_KEY)?.user.id
}

const adminUser = { id: ADMIN_ID, email: ADMIN_EMAIL, name: 'Demo Admin', state: 'Active' }
const findUser = (current, id) => (id === ADMIN_ID ? adminUser : current.users.find((u) => u.id && u.id === id) ?? null)

// The signed-in user's role on an event. The site admin counts as Owner everywhere.
function roleOn(current, eventId) {
  const userId = currentUserId()
  if (userId === ADMIN_ID) return 'owner'
  return current.eventMembers.find((m) => m.event_id === eventId && m.user_id === userId)?.role ?? null
}

function requireRole(current, eventId, roles, message) {
  if (!current.events.some((e) => e.id === eventId)) throw new Error('That event no longer exists')
  if (!roles.includes(roleOn(current, eventId))) throw new Error(message)
}

function withMembers(current, event) {
  const members = current.eventMembers
    .filter((m) => m.event_id === event.id)
    .map((m) => ({ ...m, user: findUser(current, m.user_id) }))
  return { ...event, members, athlete_count: current.eventAthletes.filter((ea) => ea.event_id === event.id).length }
}

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

  // Demo only: switch between the admin and the sample users without a second login.
  async viewAs(userId) {
    const user = data().users.find((u) => u.id && u.id === userId)
    setSession(user ? { user: { id: user.id, email: user.email } } : { user: { id: ADMIN_ID, email: ADMIN_EMAIL } })
  },

  async loadMe(userId) {
    const user = data().users.find((u) => u.id && u.id === userId)
    if (user) {
      return {
        profile: { id: user.id, email: user.email, name: user.name, role_id: 'user', status: 'active', roles: { name: 'Users' } },
        permissions: userPermissions,
      }
    }
    return {
      profile: { id: ADMIN_ID, email: ADMIN_EMAIL, name: 'Demo Admin', role_id: 'admin', status: 'active', roles: { name: 'Admins' } },
      permissions: allPermissions,
    }
  },

  // Everyone with an account, plus invites waiting for a first sign-in.
  async listUsers() {
    const current = data()
    return [
      { ...adminUser, role_id: 'admin', role_name: 'Admins' },
      ...current.users.map((u) => ({ ...u, role_id: 'user', role_name: 'Users' })),
    ].sort(byName)
  },

  async addUser({ name, email }) {
    const clean = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('That email address doesn\'t look right')
    const current = data()
    const existing = current.users.find((u) => u.email === clean)
    if (existing) {
      existing.name = name.trim() || existing.name
    } else {
      current.users.push({ id: null, email: clean, name: name.trim(), state: 'Invited' })
    }
    write(DATA_KEY, current)
    return existing ? 'updated' : 'invited'
  },

  async listAthletes() {
    const current = data()
    return current.athletes
      .map((a) => ({ ...a, coach: findUser(current, a.coach_id) }))
      .sort(byName)
  },

  async addAthlete(athlete) {
    const problems = athleteProblems(athlete)
    if (problems.length) throw new Error(problems.join('. '))
    const current = data()
    current.athletes.push({ ...athlete, id: crypto.randomUUID(), user_id: null })
    write(DATA_KEY, current)
  },

  async listOfficials() {
    return [...data().officials].sort(byName)
  },

  async addOfficial(official) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(official.invite_email ?? '')) throw new Error('Officials need an email address')
    const current = data()
    current.officials.push({ ...official, id: crypto.randomUUID(), user_id: null })
    write(DATA_KEY, current)
  },

  // Only events the user is a member of (all of them for the site admin).
  async listEvents() {
    const current = data()
    return current.events
      .filter((e) => roleOn(current, e.id))
      .map((e) => withMembers(current, e))
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
  },

  async getEvent(eventId) {
    const current = data()
    const event = current.events.find((e) => e.id === eventId)
    if (!event || !roleOn(current, eventId)) return null
    const result = withMembers(current, event)
    result.athletes = current.eventAthletes
      .filter((ea) => ea.event_id === eventId)
      .map((ea) => {
        const athlete = current.athletes.find((a) => a.id === ea.athlete_id)
        return athlete && { ...athlete, added_by: ea.added_by, coach: findUser(current, athlete.coach_id) }
      })
      .filter(Boolean)
      .sort(byName)
    return result
  },

  // Creates the event (owned by the current user) when there's no id. Mirrors save_event.
  async saveEvent({ id, name, venue, startDate, endDate, days, ownerId }) {
    const current = data()
    const range = daysBetween(startDate, endDate)
    if (!name.trim()) throw new Error('Give the event a name')
    if (range.length === 0) throw new Error('The end date must be on or after the start date, and within 31 days of it')
    if (range.some((day) => !days.find((d) => d.day === day && d.weigh_in_time && d.bouts_time))) {
      throw new Error('Every day of the event needs a weigh-in time and a bout time')
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
      const event = { id: crypto.randomUUID(), ...fields }
      const me = currentUserId()
      const owner = ownerId || me
      if (owner !== me && !findUser(current, owner)) throw new Error('That user can\'t own events')
      current.events.push(event)
      current.eventMembers.push({ event_id: event.id, user_id: owner, role: 'owner' })
      // Someone else owns it: the creator stays on as an Admin (the site admin sees everything anyway).
      if (owner !== me && me !== ADMIN_ID) current.eventMembers.push({ event_id: event.id, user_id: me, role: 'admin' })
      write(DATA_KEY, current)
      return event.id
    }

    requireRole(current, id, ['owner', 'admin'], 'Only the event\'s Owner or Admins can edit it')
    Object.assign(current.events.find((e) => e.id === id), fields)
    write(DATA_KEY, current)
    return id
  },

  async deleteEvent(eventId) {
    const current = data()
    requireRole(current, eventId, ['owner'], 'Only the event\'s Owner can delete it')
    current.events = current.events.filter((e) => e.id !== eventId)
    current.eventMembers = current.eventMembers.filter((m) => m.event_id !== eventId)
    current.eventAthletes = current.eventAthletes.filter((ea) => ea.event_id !== eventId)
    write(DATA_KEY, current)
  },

  // Add someone to an event, or change their role. Ownership moves only through transferEventOwnership.
  async setEventMember(eventId, userId, role) {
    const current = data()
    requireRole(current, eventId, ['owner', 'admin'], 'Only the event\'s Owner or Admins can change its members')
    if (!['admin', 'coach', 'viewer'].includes(role)) throw new Error('Use "Make owner" to change who owns an event')
    const existing = current.eventMembers.find((m) => m.event_id === eventId && m.user_id === userId)
    if (existing?.role === 'owner') throw new Error('Use "Make owner" to change who owns an event')
    if (existing) existing.role = role
    else current.eventMembers.push({ event_id: eventId, user_id: userId, role })
    write(DATA_KEY, current)
  },

  async removeEventMember(eventId, userId) {
    const current = data()
    requireRole(current, eventId, ['owner', 'admin'], 'Only the event\'s Owner or Admins can change its members')
    const member = current.eventMembers.find((m) => m.event_id === eventId && m.user_id === userId)
    if (member?.role === 'owner') throw new Error('Use "Make owner" to change who owns an event')
    current.eventMembers = current.eventMembers.filter((m) => m !== member)
    write(DATA_KEY, current)
  },

  // The old Owner stays on as an Admin.
  async transferEventOwnership(eventId, userId) {
    const current = data()
    requireRole(current, eventId, ['owner'], 'Only the event\'s Owner can hand it over')
    current.eventMembers.forEach((m) => {
      if (m.event_id === eventId && m.role === 'owner') m.role = 'admin'
    })
    const existing = current.eventMembers.find((m) => m.event_id === eventId && m.user_id === userId)
    if (existing) existing.role = 'owner'
    else current.eventMembers.push({ event_id: eventId, user_id: userId, role: 'owner' })
    write(DATA_KEY, current)
  },

  async addEventAthlete(eventId, athleteId) {
    const current = data()
    requireRole(current, eventId, ['owner', 'admin', 'coach'], 'Only the event\'s Owner, Admins and Coaches can add athletes')
    if (!current.eventAthletes.some((ea) => ea.event_id === eventId && ea.athlete_id === athleteId)) {
      current.eventAthletes.push({ event_id: eventId, athlete_id: athleteId, added_by: currentUserId() })
      write(DATA_KEY, current)
    }
  },

  async removeEventAthlete(eventId, athleteId) {
    const current = data()
    const entry = current.eventAthletes.find((ea) => ea.event_id === eventId && ea.athlete_id === athleteId)
    const role = roleOn(current, eventId)
    if (!(role === 'owner' || role === 'admin' || (role === 'coach' && entry?.added_by === currentUserId()))) {
      throw new Error('Coaches can only remove the athletes they added')
    }
    current.eventAthletes = current.eventAthletes.filter((ea) => ea !== entry)
    write(DATA_KEY, current)
  },

  resetDemoData() {
    write(DATA_KEY, null)
  },
}
