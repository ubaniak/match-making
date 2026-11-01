// A stand-in for Supabase so the app can be tried before a project exists.
// Only one special user can sign in, and everything is kept in this browser's storage.
// The password ships inside the page's JavaScript, so this is for demos, not for protecting anything.
// The demo admin can also preview the app as one of the sample users (see viewAs).

import { athleteProblems } from '../athletes'
import { DEFAULT_TIME_ZONE, addDays, daysBetween, todayIso } from '../dates'
import { dayProblems, effectiveStatus, hasProblems } from '../events'
import { testClubs, testRoster } from './testRoster'

const ADMIN_EMAIL = (import.meta.env.VITE_MOCK_ADMIN_EMAIL || 'admin@matchmaking.test').toLowerCase()
const ADMIN_PASSWORD = import.meta.env.VITE_MOCK_ADMIN_PASSWORD || 'letmein'
const ADMIN_ID = 'mock-admin'

const SESSION_KEY = 'mock-session'
const DATA_KEY = 'mock-data-v10' // v10: officials accept for chosen days

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
      { id: 'user-4', email: 'kim.lee@example.com', name: 'Kim Lee', state: 'Active' },
      { id: null, email: 'sam.reid@example.com', name: 'Sam Reid', state: 'Invited' },
    ],
    athletes: [
      { id: 'athlete-1', name: 'Ali Hassan', date_of_birth: '2004-03-12', gender: 'male', weight_kg: 60.5, bouts: 12, club_id: 'club-1', invite_email: 'ali@example.com', user_id: 'user-ali', coach_id: 'user-1' },
      { id: 'athlete-2', name: 'Jade Murphy', date_of_birth: '2006-07-30', gender: 'female', weight_kg: 51, bouts: 3, club_id: 'club-1', invite_email: 'jade@example.com', user_id: null, coach_id: 'user-1' },
      { id: 'athlete-3', name: 'Tom Becker', date_of_birth: '2001-11-05', gender: 'male', weight_kg: 74.2, bouts: 27, club_id: 'club-2', invite_email: null, user_id: null, coach_id: 'user-2' },
      { id: 'athlete-4', name: 'Marco Ruiz', date_of_birth: '2003-08-21', gender: 'male', weight_kg: 61.8, bouts: 14, club_id: 'club-2', invite_email: null, user_id: null, coach_id: 'user-2' },
      { id: 'athlete-5', name: 'Ben Clarke', date_of_birth: '2004-01-09', gender: 'male', weight_kg: 73, bouts: 22, club_id: 'club-1', invite_email: null, user_id: null, coach_id: 'user-1' },
    ],
    clubs: [
      { id: 'club-1', name: 'Eastside BC' },
      { id: 'club-2', name: 'Riverside Boxing' },
    ],
    clubMembers: [
      { club_id: 'club-1', user_id: 'user-1', role: 'owner', status: 'active' },
      { club_id: 'club-2', user_id: 'user-2', role: 'owner', status: 'active' },
      { club_id: 'club-1', user_id: 'user-3', role: 'coach', status: 'pending', invited_by: 'user-1', invited_at: new Date().toISOString() },
    ],
    transfers: [],
    officials: [
      { id: 'official-1', name: 'Grace Adeyemi', qualifications: 'Level 3 referee', invite_email: 'grace@example.com', user_id: 'user-grace' },
      { id: 'official-2', name: 'Rob Turner', qualifications: 'Judge', invite_email: 'rob@example.com', user_id: null },
      { id: 'official-3', name: 'Priya Shah', qualifications: 'Level 2 referee', invite_email: 'priya.shah@example.com', user_id: 'user-3' },
      { id: 'official-4', name: 'Kim Lee', qualifications: 'Judge', invite_email: 'kim.lee@example.com', user_id: 'user-4' },
    ],
    events: [
      {
        id: 'event-1', name: 'Eastside Winter Box Cup', venue: 'Eastside Leisure Centre',
        start_date: start, end_date: addDays(start, 1), status: 'active', poster_path: null, entry_deadline: null, timezone: DEFAULT_TIME_ZONE,
        days: [
          { day: start, weigh_in_start: '08:00', weigh_in_end: '10:00', sessions: [{ starts_at: '13:00', label: 'Afternoon' }, { starts_at: '18:30', label: 'Evening' }] },
          { day: addDays(start, 1), weigh_in_start: '08:30', weigh_in_end: '10:30', sessions: [{ starts_at: '14:00', label: '' }] },
        ],
      },
      {
        id: 'event-2', name: 'Riverside Club Show', venue: 'Riverside Boxing Club',
        start_date: single, end_date: single, status: 'requested', poster_path: null, entry_deadline: null, timezone: DEFAULT_TIME_ZONE,
        days: [],
      },
    ],
    eventMembers: [
      { event_id: 'event-1', user_id: 'user-1', role: 'owner' },
      { event_id: 'event-1', user_id: 'user-3', role: 'viewer' },
      { event_id: 'event-2', user_id: 'user-2', role: 'owner' },
    ],
    eventClubs: [
      { event_id: 'event-1', club_id: 'club-1', status: 'accepted', requested_at: new Date().toISOString() },
      { event_id: 'event-1', club_id: 'club-2', status: 'accepted', requested_at: new Date().toISOString() },
    ],
    eventAthletes: [
      { event_id: 'event-1', athlete_id: 'athlete-1', club_id: 'club-1', added_by: 'user-1', suggested_opponent_name: 'Marco Ruiz', suggested_opponent_club: 'Riverside Boxing' },
      { event_id: 'event-1', athlete_id: 'athlete-3', club_id: 'club-2', added_by: 'user-2' },
      { event_id: 'event-1', athlete_id: 'athlete-4', club_id: 'club-2', added_by: 'user-2' },
      { event_id: 'event-1', athlete_id: 'athlete-5', club_id: 'club-1', added_by: 'user-1' },
    ],
    lateEntries: [],
    officialInvitations: [
      { id: 'invite-1', event_id: 'event-1', official_id: 'official-3', status: 'accepted', days: [start, addDays(start, 1)], respond_by: null, invited_at: new Date().toISOString(), responded_at: new Date().toISOString() },
      { id: 'invite-2', event_id: 'event-1', official_id: 'official-4', status: 'accepted', days: [start], respond_by: null, invited_at: new Date().toISOString(), responded_at: new Date().toISOString() },
      { id: 'invite-3', event_id: 'event-1', official_id: 'official-1', status: 'declined', respond_by: null, invited_at: new Date().toISOString(), responded_at: new Date().toISOString() },
      { id: 'invite-4', event_id: 'event-1', official_id: 'official-2', status: 'pending', respond_by: addDays(today, 7), invited_at: new Date().toISOString(), responded_at: null },
    ],
    eventOfficials: [
      { event_id: 'event-1', role: 'chief', user_id: 'user-3' },
      { event_id: 'event-1', role: 'deputy', user_id: 'user-4' },
    ],
    bouts: [
      {
        id: 'bout-1', event_id: 'event-1', day: start, session_starts_at: null, position: 1,
        red_athlete_id: 'athlete-1', blue_athlete_id: 'athlete-4', red_club_id: 'club-1', blue_club_id: 'club-2',
        status: 'pending', needs_supervisor: false, warnings: ['Different weight classes, 1.3 kg apart', 'Open vs Open, 2 bouts apart'],
        after_weigh_in: false, made_by: 'user-1', made_at: new Date().toISOString(),
        approvals: [{ side: 'red', decision: 'approved', note: null, override: false, decided_by: 'user-1', decided_at: new Date().toISOString() }],
        comments: [],
      },
    ],
    weighIns: [],
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
  'athletes:read', 'athletes:create', 'athletes:write', 'officials:read', 'files:upload',
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

const roleNames = { admin: 'Admins', user: 'Users', official: 'Officials', public: 'Public' }
const byName = (a, b) => (a.name || a.email).localeCompare(b.name || b.email)

function currentUserId() {
  return read(SESSION_KEY)?.user.id
}

const adminUser = { id: ADMIN_ID, email: ADMIN_EMAIL, name: 'Demo Admin', state: 'Active' }
const findUser = (current, id) => (id === ADMIN_ID ? adminUser : current.users.find((u) => u.id && u.id === id) ?? null)

const isSiteAdmin = () => currentUserId() === ADMIN_ID

// The signed-in user's role on an event: 'owner', 'coach', 'viewer' or null.
function roleOn(current, eventId) {
  const userId = currentUserId()
  return current.eventMembers.find((m) => m.event_id === eventId && m.user_id === userId)?.role ?? null
}

// Mirrors can_read_event and can_read_entries.
const inEventClub = (current, eventId) =>
  current.eventClubs.some((ec) => ec.event_id === eventId && ec.status === 'accepted' && clubRole(current, ec.club_id))
// The signed-in user's official role on an event: 'chief', 'deputy' or null.
const officialRole = (current, eventId) =>
  (current.eventOfficials ?? []).find((o) => o.event_id === eventId && o.user_id === currentUserId())?.role ?? null
const isOfficial = (current, eventId) => isSiteAdmin() || Boolean(officialRole(current, eventId))
// Mirrors is_accepted_official.
const acceptedOfficial = (current, eventId) => (current.officialInvitations ?? []).some((i) => i.event_id === eventId && i.status === 'accepted'
  && current.officials.find((o) => o.id === i.official_id)?.user_id === currentUserId())
// Mirrors my_official_days.
const myDays = (current, eventId) => (current.officialInvitations ?? []).find((i) => i.event_id === eventId && i.status === 'accepted'
  && current.officials.find((o) => o.id === i.official_id)?.user_id === currentUserId())?.days ?? []
const userAccepted = (current, eventId, userId) => (current.officialInvitations ?? []).some((i) => i.event_id === eventId && i.status === 'accepted'
  && current.officials.find((o) => o.id === i.official_id)?.user_id === userId)
function canSee(current, eventId) {
  const event = current.events.find((e) => e.id === eventId)
  return Boolean(event) && (isSiteAdmin() || Boolean(roleOn(current, eventId)) || Boolean(officialRole(current, eventId)) || acceptedOfficial(current, eventId) || inEventClub(current, eventId) || ['active', 'done'].includes(event.status))
}
const canSeeEntries = (current, eventId) => isSiteAdmin() || roleOn(current, eventId) === 'owner' || inEventClub(current, eventId) || Boolean(officialRole(current, eventId)) || acceptedOfficial(current, eventId)
const isOwnerOf = (current, eventId) => isSiteAdmin() || roleOn(current, eventId) === 'owner'
const eventOpen = (event) => effectiveStatus(event) === 'active'
const entriesOpen = (event) => eventOpen(event) && (!event.entry_deadline || new Date() <= new Date(event.entry_deadline))
const stillRunning = (event) => ['requested', 'active'].includes(effectiveStatus(event))
const now = () => new Date().toISOString()

// Mirrors check_entry. Returns the athlete's club.
function checkEntry(current, event, athleteId) {
  const athlete = current.athletes.find((a) => a.id === athleteId)
  if (!athlete) throw new Error('That athlete no longer exists')
  if (!isSiteAdmin() && clubRole(current, athlete.club_id) !== 'owner') throw new Error('Only the athlete\'s club Owners can enter them')
  if (!eventOpen(event)) throw new Error('Athletes can be entered once the event is Active, and until it is over')
  if (!current.eventClubs.some((ec) => ec.event_id === event.id && ec.club_id === athlete.club_id && ec.status === 'accepted')) {
    throw new Error('The athlete\'s club isn\'t in this event yet')
  }
  if (current.eventAthletes.some((ea) => ea.event_id === event.id && ea.athlete_id === athleteId)) throw new Error('That athlete is already entered')
  return athlete.club_id
}

// The signed-in user's role in a club: 'owner', 'coach' or null. Pending invites don't count.
function clubRole(current, clubId) {
  const userId = currentUserId()
  return current.clubMembers.find((m) => m.club_id === clubId && m.user_id === userId && m.status === 'active')?.role ?? null
}

const clubName = (current, clubId) => current.clubs.find((c) => c.id === clubId)?.name ?? null
const withClub = (current, athlete) => ({ ...athlete, club: clubName(current, athlete.club_id), coach: findUser(current, athlete.coach_id) })

function clubMembers(current, clubId) {
  return current.clubMembers.filter((m) => m.club_id === clubId).map((m) => ({ ...m, user: findUser(current, m.user_id) }))
}

// Mirrors athlete_in_open_event.
function inOpenEvent(current, athleteId) {
  return current.eventAthletes.some((ea) => {
    const event = current.events.find((e) => e.id === ea.event_id)
    return ea.athlete_id === athleteId && event && effectiveStatus(event) === 'active'
  })
}

const LOCKED = 'This athlete is entered in an Active event, so they can\'t transfer until it is Done'

function findEvent(current, eventId) {
  const event = current.events.find((e) => e.id === eventId)
  if (!event) throw new Error('That event no longer exists')
  return event
}

// Mirrors can_edit_event: site Admins always; the Owner while Requested or Active.
function requireEditor(current, eventId) {
  const event = findEvent(current, eventId)
  if (isSiteAdmin()) return event
  if (roleOn(current, eventId) !== 'owner' || !['requested', 'active'].includes(effectiveStatus(event))) {
    throw new Error('Only the event\'s Owner or a site Admin can change it, and only while it is Requested or Active')
  }
  return event
}


// ---------------------------------------------------------------------------
// Bouts: mirrors migration 12 (20261101040000_bouts.sql)
// ---------------------------------------------------------------------------

const weighInStarted = (current, eventId, day) => current.weighIns.some((w) => w.event_id === eventId && w.day === day)
const canMatch = (current, eventId, day) =>
  isOfficial(current, eventId) || (roleOn(current, eventId) === 'owner' && !weighInStarted(current, eventId, day))
const cardOpen = (event) => event.status === 'active'
const isInBout = (current, bout) =>
  isSiteAdmin() || roleOn(current, bout.event_id) === 'owner' || Boolean(officialRole(current, bout.event_id)) ||
  Boolean(clubRole(current, bout.red_club_id)) || Boolean(clubRole(current, bout.blue_club_id))

function findBout(current, boutId) {
  const bout = current.bouts.find((b) => b.id === boutId)
  if (!bout) throw new Error('That bout no longer exists')
  return bout
}

function refreshBoutStatus(bout) {
  if (bout.status === 'cancelled') return
  const rejected = bout.approvals.some((a) => a.decision === 'rejected')
  const approved = bout.approvals.filter((a) => a.decision === 'approved').length
  bout.status = rejected ? 'rejected' : approved === 3 ? 'approved' : 'pending'
}

function cancelAthleteBouts(current, eventId, athleteId, day, reason) {
  for (const b of current.bouts ?? []) {
    if (b.event_id === eventId && b.status !== 'cancelled' && !b.winner && (day == null || b.day === day) &&
        [b.red_athlete_id, b.blue_athlete_id].includes(athleteId)) {
      Object.assign(b, { status: 'cancelled', cancel_reason: reason, cancelled_at: now() })
    }
  }
}

function requireSiteAdmin(message) {
  if (!isSiteAdmin()) throw new Error(message)
}

const label = (day) => new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))

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
      ...current.users.map((u) => ({ ...u, role_id: u.role_id ?? 'user', role_name: roleNames[u.role_id ?? 'user'] })),
    ].sort(byName)
  },

  async updateUser(user, { name, email, roleId, status }) {
    if (user.id === ADMIN_ID) throw new Error('In demo mode the demo admin can\'t be changed')
    const current = data()
    const row = current.users.find((u) => (user.id ? u.id === user.id : !u.id && u.email === user.email))
    if (!row) throw new Error('That user no longer exists')
    row.name = name?.trim() || null
    row.role_id = roleId
    if (row.id) {
      row.state = status === 'disabled' ? 'Disabled' : 'Active'
    } else {
      const clean = email.trim().toLowerCase()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('That email address doesn\'t look right')
      row.email = clean
    }
    write(DATA_KEY, current)
  },

  async deleteUser(user) {
    if (user.id === ADMIN_ID || user.id === currentUserId()) throw new Error('You can\'t delete your own account')
    const current = data()
    if (user.id && current.eventMembers.some((m) => m.user_id === user.id && m.role === 'owner')) {
      throw new Error('This user owns an event. Change the event\'s Owner first, or disable the user instead.')
    }
    current.users = current.users.filter((u) => !(user.id ? u.id === user.id : !u.id && u.email === user.email))
    if (user.id) {
      current.eventMembers = current.eventMembers.filter((m) => m.user_id !== user.id)
      current.clubMembers = current.clubMembers.filter((m) => m.user_id !== user.id)
      current.eventOfficials = current.eventOfficials.filter((o) => o.user_id !== user.id)
      current.officials.forEach((o) => { if (o.user_id === user.id) o.user_id = null })
    }
    write(DATA_KEY, current)
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
    return current.athletes.map((a) => withClub(current, a)).sort(byName)
  },

  // Mirrors the "add athletes" policy: site Admins, or an Owner of the athlete's club.
  async addAthlete(athlete) {
    const problems = athleteProblems(athlete)
    if (problems.length) throw new Error(problems.join('. '))
    const current = data()
    if (!isSiteAdmin() && clubRole(current, athlete.club_id) !== 'owner') throw new Error('Only the club\'s Owners can add its athletes')
    current.athletes.push({ ...athlete, id: crypto.randomUUID(), user_id: null })
    write(DATA_KEY, current)
  },

  async updateAthlete(athleteId, fields) {
    const current = data()
    const athlete = current.athletes.find((a) => a.id === athleteId)
    if (!athlete) throw new Error('That athlete no longer exists')
    if (!isSiteAdmin() && clubRole(current, athlete.club_id) !== 'owner') throw new Error('You can\'t edit this athlete')
    if (fields.club_id && fields.club_id !== athlete.club_id && !isSiteAdmin()) throw new Error('Athletes change clubs through a transfer request')
    const problems = athleteProblems({ ...athlete, ...fields })
    if (problems.length) throw new Error(problems.join('. '))
    Object.assign(athlete, fields)
    write(DATA_KEY, current)
  },

  // Mirrors check_athlete_delete (migration 13).
  async deleteAthlete(athleteId) {
    const current = data()
    const athlete = current.athletes.find((a) => a.id === athleteId)
    if (!athlete) throw new Error('That athlete no longer exists')
    if (!isSiteAdmin() && clubRole(current, athlete.club_id) !== 'owner') throw new Error('You can\'t delete this athlete')
    if (inOpenEvent(current, athleteId)) throw new Error('This athlete is entered in an Active event. Withdraw them first, or wait until the event is Done.')
    if (current.bouts.some((b) => b.winner && [b.red_athlete_id, b.blue_athlete_id].includes(athleteId))) {
      throw new Error('This athlete has bout results on record, so they can\'t be deleted.')
    }
    current.athletes = current.athletes.filter((a) => a.id !== athleteId)
    current.eventAthletes = current.eventAthletes.filter((ea) => ea.athlete_id !== athleteId)
    current.transfers = current.transfers.filter((t) => t.athlete_id !== athleteId)
    current.lateEntries = current.lateEntries.filter((r) => r.athlete_id !== athleteId)
    current.bouts = current.bouts.filter((b) => ![b.red_athlete_id, b.blue_athlete_id].includes(athleteId))
    current.weighIns = current.weighIns.filter((w) => w.athlete_id !== athleteId)
    write(DATA_KEY, current)
  },

  async listClubs() {
    const current = data()
    return current.clubs
      .map((c) => ({ ...c, members: clubMembers(current, c.id), athlete_count: current.athletes.filter((a) => a.club_id === c.id).length }))
      .sort(byName)
  },

  async getClub(clubId) {
    const current = data()
    const club = current.clubs.find((c) => c.id === clubId)
    if (!club) return null
    const canSeeTransfers = (t) => isSiteAdmin() || clubRole(current, t.from_club_id) || clubRole(current, t.to_club_id)
    return {
      ...club,
      members: clubMembers(current, clubId),
      athletes: current.athletes.filter((a) => a.club_id === clubId).map((a) => withClub(current, a)).sort(byName),
      transfers: current.transfers
        .filter((t) => (t.from_club_id === clubId || t.to_club_id === clubId) && canSeeTransfers(t))
        .map((t) => ({
          ...t,
          athlete: current.athletes.find((a) => a.id === t.athlete_id) ?? null,
          from_club: t.from_club_id ? { id: t.from_club_id, name: clubName(current, t.from_club_id) } : null,
          to_club: t.to_club_id ? { id: t.to_club_id, name: clubName(current, t.to_club_id) } : null,
          requester: findUser(current, t.requested_by),
        }))
        .sort((a, b) => b.requested_at.localeCompare(a.requested_at)),
    }
  },

  async createClub({ name, ownerIds }) {
    requireSiteAdmin('Only a site Admin can create clubs')
    const current = data()
    if (!name.trim()) throw new Error('Give the club a name')
    if (current.clubs.some((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())) throw new Error('There is already a club with that name')
    const club = { id: crypto.randomUUID(), name: name.trim() }
    current.clubs.push(club)
    ownerIds.forEach((user_id) => current.clubMembers.push({ club_id: club.id, user_id, role: 'owner', status: 'active' }))
    write(DATA_KEY, current)
    return club.id
  },

  async renameClub(clubId, name) {
    requireSiteAdmin('Only a site Admin can rename clubs')
    const current = data()
    if (!name.trim()) throw new Error('Give the club a name')
    if (current.clubs.some((c) => c.id !== clubId && c.name.trim().toLowerCase() === name.trim().toLowerCase())) throw new Error('There is already a club with that name')
    current.clubs.find((c) => c.id === clubId).name = name.trim()
    write(DATA_KEY, current)
  },

  async deleteClub(clubId) {
    requireSiteAdmin('Only a site Admin can delete clubs')
    const current = data()
    if (current.athletes.some((a) => a.club_id === clubId)) throw new Error('Move or remove the club\'s athletes first')
    current.clubs = current.clubs.filter((c) => c.id !== clubId)
    current.clubMembers = current.clubMembers.filter((m) => m.club_id !== clubId)
    write(DATA_KEY, current)
  },

  async addClubMember(clubId, userId, role, { approved }) {
    const current = data()
    if (!isSiteAdmin() && clubRole(current, clubId) !== 'owner') throw new Error('Only the club\'s Owners can invite people')
    if (approved && !isSiteAdmin()) throw new Error('A site Admin has to approve new club members')
    if (current.clubMembers.some((m) => m.club_id === clubId && m.user_id === userId)) throw new Error('That person is already in the club or invited')
    current.clubMembers.push({
      club_id: clubId, user_id: userId, role, status: approved ? 'active' : 'pending',
      invited_by: currentUserId(), invited_at: new Date().toISOString(),
    })
    write(DATA_KEY, current)
  },

  async approveClubMember(clubId, userId) {
    requireSiteAdmin('Only a site Admin can approve club members')
    const current = data()
    const member = current.clubMembers.find((m) => m.club_id === clubId && m.user_id === userId)
    if (member) member.status = 'active'
    write(DATA_KEY, current)
  },

  async setClubMemberRole(clubId, userId, role) {
    requireSiteAdmin('Only a site Admin can change club roles')
    const current = data()
    const member = current.clubMembers.find((m) => m.club_id === clubId && m.user_id === userId)
    if (member) member.role = role
    write(DATA_KEY, current)
  },

  async removeClubMember(clubId, userId) {
    const current = data()
    if (!isSiteAdmin() && clubRole(current, clubId) !== 'owner') throw new Error('Only the club\'s Owners can remove people')
    current.clubMembers = current.clubMembers.filter((m) => !(m.club_id === clubId && m.user_id === userId))
    write(DATA_KEY, current)
  },

  async listPendingClubInvites() {
    const current = data()
    return current.clubMembers
      .filter((m) => m.status === 'pending')
      .map((m) => ({ ...m, club: { name: clubName(current, m.club_id) }, user: findUser(current, m.user_id), inviter: findUser(current, m.invited_by) }))
  },

  // Mirrors request_transfer.
  async requestTransfer(athleteId, toClubId, note) {
    const current = data()
    const athlete = current.athletes.find((a) => a.id === athleteId)
    if (!athlete) throw new Error('That athlete no longer exists')
    if (!isSiteAdmin() && !clubRole(current, athlete.club_id)) throw new Error('Only members of the athlete\'s club can ask to transfer them')
    if (!toClubId) throw new Error('Pick the club to transfer to')
    if (toClubId === athlete.club_id) throw new Error('The athlete is already in that club')
    if (inOpenEvent(current, athleteId)) throw new Error(LOCKED)
    if (current.transfers.some((t) => t.athlete_id === athleteId && t.status === 'pending')) throw new Error('This athlete already has a transfer request waiting')
    current.transfers.push({
      id: crypto.randomUUID(), athlete_id: athleteId, from_club_id: athlete.club_id, to_club_id: toClubId,
      status: 'pending', note: note?.trim() || null, requested_by: currentUserId(), requested_at: new Date().toISOString(),
    })
    write(DATA_KEY, current)
  },

  // Mirrors decide_transfer.
  async decideTransfer(transferId, accept, override = false) {
    const current = data()
    const transfer = current.transfers.find((t) => t.id === transferId)
    if (!transfer || transfer.status !== 'pending') throw new Error('That transfer request is no longer waiting')
    if (!isSiteAdmin() && clubRole(current, transfer.to_club_id) !== 'owner') throw new Error('Only the receiving club\'s Owner can accept or decline')
    if (accept) {
      if (inOpenEvent(current, transfer.athlete_id) && !(override && isSiteAdmin())) throw new Error(LOCKED)
      current.athletes.find((a) => a.id === transfer.athlete_id).club_id = transfer.to_club_id
    }
    Object.assign(transfer, { status: accept ? 'accepted' : 'declined', decided_by: currentUserId(), decided_at: new Date().toISOString() })
    write(DATA_KEY, current)
  },

  async cancelTransfer(transferId) {
    const current = data()
    const transfer = current.transfers.find((t) => t.id === transferId)
    if (!transfer || transfer.status !== 'pending') throw new Error('That transfer request is no longer waiting')
    if (!isSiteAdmin() && transfer.requested_by !== currentUserId() && clubRole(current, transfer.from_club_id) !== 'owner') {
      throw new Error('Only whoever asked, or the club\'s Owner, can withdraw this request')
    }
    Object.assign(transfer, { status: 'cancelled', decided_by: currentUserId(), decided_at: new Date().toISOString() })
    write(DATA_KEY, current)
  },

  // Mirrors move_athlete.
  async moveAthlete(athleteId, clubId, override = false) {
    requireSiteAdmin('Only a site Admin can move athletes between clubs')
    const current = data()
    const athlete = current.athletes.find((a) => a.id === athleteId)
    if (!athlete) throw new Error('That athlete no longer exists')
    if (!clubId) throw new Error('Pick the club to move to')
    if (clubId === athlete.club_id) return
    if (inOpenEvent(current, athleteId) && !override) throw new Error('This athlete is entered in an Active event. Tick "Move anyway" to override.')
    const now = new Date().toISOString()
    current.transfers.forEach((t) => {
      if (t.athlete_id === athleteId && t.status === 'pending') Object.assign(t, { status: 'cancelled', decided_by: currentUserId(), decided_at: now })
    })
    current.transfers.push({
      id: crypto.randomUUID(), athlete_id: athleteId, from_club_id: athlete.club_id, to_club_id: clubId,
      status: 'moved', note: null, requested_by: currentUserId(), requested_at: now, decided_by: currentUserId(), decided_at: now,
    })
    athlete.club_id = clubId
    write(DATA_KEY, current)
  },

  async listOfficials() {
    return [...data().officials].sort(byName)
  },

  async updateOfficial(official, fields) {
    if (fields.invite_email !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.invite_email ?? '')) throw new Error('Officials need an email address')
    const current = data()
    const row = current.officials.find((o) => o.id === official.id)
    if (!row) throw new Error('That official no longer exists')
    if (fields.invite_email !== undefined && fields.invite_email !== row.invite_email) {
      row.user_id = current.users.find((u) => u.id && u.email === fields.invite_email)?.id ?? null
    }
    Object.assign(row, fields)
    write(DATA_KEY, current)
  },

  async deleteOfficial(officialId) {
    const current = data()
    const row = current.officials.find((o) => o.id === officialId)
    if (!row) return
    const events = new Set(current.officialInvitations.filter((i) => i.official_id === officialId).map((i) => i.event_id))
    current.eventOfficials = current.eventOfficials.filter((o) => !(o.user_id === row.user_id && events.has(o.event_id)))
    current.officialInvitations = current.officialInvitations.filter((i) => i.official_id !== officialId)
    current.officials = current.officials.filter((o) => o.id !== officialId)
    write(DATA_KEY, current)
  },

  async addOfficial(official) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(official.invite_email ?? '')) throw new Error('Officials need an email address')
    const current = data()
    const email = official.invite_email.trim().toLowerCase()
    current.officials.push({ ...official, invite_email: email, id: crypto.randomUUID(), user_id: current.users.find((u) => u.email === email)?.id ?? null })
    write(DATA_KEY, current)
  },

  // Only events the user is a member of (all of them for the site admin).
  async listEvents() {
    const current = data()
    return current.events
      .filter((e) => canSee(current, e.id))
      .map((e) => withMembers(current, e))
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
  },

  async getEvent(eventId) {
    const current = data()
    const event = current.events.find((e) => e.id === eventId)
    if (!event || !canSee(current, eventId)) return null
    const result = withMembers(current, event)
    const entries = canSeeEntries(current, eventId)
    result.athletes = entries
      ? current.eventAthletes
        .filter((ea) => ea.event_id === eventId)
        .map((ea) => {
          const athlete = current.athletes.find((a) => a.id === ea.athlete_id)
          return athlete && {
            ...withClub(current, athlete), added_by: ea.added_by, entry_club_id: ea.club_id,
            suggested_opponent_name: ea.suggested_opponent_name ?? null, suggested_opponent_club: ea.suggested_opponent_club ?? null,
          }
        })
        .filter(Boolean)
        .sort(byName)
      : []
    result.clubs = current.eventClubs
      .filter((ec) => ec.event_id === eventId && (entries || clubRole(current, ec.club_id)))
      .map((ec) => ({ ...ec, club: { id: ec.club_id, name: clubName(current, ec.club_id) } }))
    result.late_entries = current.lateEntries
      .filter((r) => r.event_id === eventId && (isOwnerOf(current, eventId) || clubRole(current, r.club_id)))
      .map((r) => ({ ...r, athlete: current.athletes.find((a) => a.id === r.athlete_id) ?? null, club: { id: r.club_id, name: clubName(current, r.club_id) } }))
      .sort((a, b) => b.requested_at.localeCompare(a.requested_at))
    return result
  },

  // Mirrors create_event.
  async createEvent({ name, venue, startDate, endDate, ownerId, timezone }) {
    requireSiteAdmin('Only a site Admin can create events')
    const current = data()
    if (!name.trim()) throw new Error('Give the event a name')
    if (daysBetween(startDate, endDate).length === 0) throw new Error('The end date must be on or after the start date, and within 31 days of it')
    if (!ownerId || !findUser(current, ownerId)) throw new Error('Pick an Owner who has signed in at least once')
    const event = {
      id: crypto.randomUUID(), name: name.trim(), venue: venue.trim() || null,
      start_date: startDate, end_date: endDate, status: 'requested', poster_path: null, days: [],
      timezone: timezone || DEFAULT_TIME_ZONE,
    }
    current.events.push(event)
    current.eventMembers.push({ event_id: event.id, user_id: ownerId, role: 'owner' })
    write(DATA_KEY, current)
    return event.id
  },

  async updateEventDetails(eventId, { name, venue, startDate, endDate, entryDeadline, timezone }) {
    const current = data()
    const event = requireEditor(current, eventId)
    if (timezone && timezone !== (event.timezone ?? DEFAULT_TIME_ZONE)) {
      requireSiteAdmin('Only a site Admin can change an event\'s time zone')
      event.timezone = timezone
    }
    if (!name.trim()) throw new Error('Give the event a name')
    if (daysBetween(startDate, endDate).length === 0) throw new Error('The end date must be on or after the start date, and within 31 days of it')
    Object.assign(event, { name: name.trim(), venue: venue.trim() || null, start_date: startDate, end_date: endDate, entry_deadline: entryDeadline || null })
    // Days that fall outside the new dates go with them.
    event.days = event.days.filter((d) => d.day >= startDate && d.day <= endDate)
    write(DATA_KEY, current)
  },

  // Mirrors save_event_times.
  async saveEventTimes(eventId, days) {
    const current = data()
    const event = requireEditor(current, eventId)
    const seen = new Set()
    for (const d of days) {
      if (d.day < event.start_date || d.day > event.end_date) throw new Error(`${label(d.day)} is not one of the event's days`)
      if (seen.has(d.day)) throw new Error(`${label(d.day)} is listed twice`)
      seen.add(d.day)
      const problems = dayProblems(d)
      if (hasProblems(problems)) throw new Error(`${label(d.day)}: ${[...problems.weighIn, ...problems.sessions][0]}`)
    }
    event.days = [...days]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => ({
        day: d.day, weigh_in_start: d.weigh_in_start, weigh_in_end: d.weigh_in_end,
        sessions: d.sessions.map((s) => ({ starts_at: s.starts_at, label: s.label?.trim() ?? '' })).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
      }))
    write(DATA_KEY, current)
  },

  // Mirrors set_event_status.
  async setEventStatus(eventId, status) {
    requireSiteAdmin('Only a site Admin can approve, cancel or close an event')
    const current = data()
    const event = findEvent(current, eventId)
    const from = effectiveStatus(event)
    if (from === status) return
    if (from === 'done' || from === 'cancelled') throw new Error(`This event is already ${from === 'done' ? 'Done' : 'Cancelled'}`)
    if (!['active', 'done', 'cancelled'].includes(status) || (status === 'active' && from !== 'requested')) {
      throw new Error('An event can\'t make that change')
    }
    event.status = status
    write(DATA_KEY, current)
  },

  // Demo mode can't send email; the page offers to open the site Admin's email app instead.
  async emailEventOwner() {
    throw new Error('Demo mode doesn\'t send email')
  },

  // Demo posters are kept in this browser as data: URLs.
  posterUrl(path) {
    return path || null
  },

  async uploadPoster(eventId, file) {
    if (file.size > 1024 * 1024) throw new Error('In demo mode posters must be under 1 MB')
    const url = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    const current = data()
    requireEditor(current, eventId).poster_path = url
    write(DATA_KEY, current)
  },

  async removePoster(eventId) {
    const current = data()
    requireEditor(current, eventId).poster_path = null
    write(DATA_KEY, current)
  },

  async listPublicEvents() {
    return data().events
      .filter((e) => e.status === 'active' && e.end_date >= todayIso(e.timezone ?? DEFAULT_TIME_ZONE))
      .map(({ id, name, venue, start_date, end_date, poster_path, days, timezone }) => ({ id, name, venue, start_date, end_date, poster_path, days, timezone: timezone ?? DEFAULT_TIME_ZONE }))
      .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name))
  },

  async deleteEvent(eventId) {
    requireSiteAdmin('Only a site Admin can delete events')
    const current = data()
    current.events = current.events.filter((e) => e.id !== eventId)
    current.eventMembers = current.eventMembers.filter((m) => m.event_id !== eventId)
    current.eventAthletes = current.eventAthletes.filter((ea) => ea.event_id !== eventId)
    write(DATA_KEY, current)
  },

  // The same TEST events, clubs and athletes as migration 17's seed_test_data and clear_test_data.
  async seedTestData() {
    requireSiteAdmin('Only a site Admin can load test data')
    const current = data()
    const isTest = (x) => x.name.startsWith('TEST ')
    if (current.events.some(isTest) || current.clubs.some(isTest) || current.athletes.some(isTest)) {
      throw new Error('Test data is already loaded. Clear it first.')
    }
    const owner = currentUserId()
    const day = (date, sessions) => ({ day: date, weigh_in_start: '08:00', weigh_in_end: '10:00', sessions })
    const afternoon = { starts_at: '13:00', label: 'Afternoon' }
    const evening = { starts_at: '18:00', label: 'Evening' }
    const base = { status: 'active', poster_path: null, entry_deadline: null, timezone: 'America/Winnipeg' }
    const events = {
      one: { ...base, id: crypto.randomUUID(), name: 'TEST One-Day Card', venue: 'TEST Venue, Winnipeg', start_date: '3000-01-01', end_date: '3000-01-01', days: [day('3000-01-01', [afternoon])] },
      multi: {
        ...base, id: crypto.randomUUID(), name: 'TEST Multi-Day Open', venue: 'TEST Arena, Winnipeg', start_date: '3000-01-08', end_date: '3000-01-10',
        days: ['3000-01-08', '3000-01-09', '3000-01-10'].map((d) => day(d, [afternoon, evening])),
      },
    }
    const clubIds = Object.fromEntries(testClubs.map((name) => [name, crypto.randomUUID()]))
    for (const event of Object.values(events)) {
      current.events.push(event)
      current.eventMembers.push({ event_id: event.id, user_id: owner, role: 'owner' })
      testClubs.forEach((name) => current.eventClubs.push({ event_id: event.id, club_id: clubIds[name], status: 'accepted', requested_at: now() }))
    }
    testClubs.forEach((name) => current.clubs.push({ id: clubIds[name], name }))
    for (const [name, date_of_birth, gender, weight_kg, bouts, club, ev] of testRoster) {
      const athlete = { id: crypto.randomUUID(), name, date_of_birth, gender, weight_kg, bouts, club_id: clubIds[club], invite_email: null, user_id: null, coach_id: null }
      current.athletes.push(athlete)
      current.eventAthletes.push({ event_id: events[ev].id, athlete_id: athlete.id, club_id: athlete.club_id, added_by: owner })
    }
    write(DATA_KEY, current)
    return { events: 2, clubs: testClubs.length, athletes: testRoster.length }
  },

  async clearTestData() {
    requireSiteAdmin('Only a site Admin can clear test data')
    const current = data()
    const isTest = (x) => x.name.startsWith('TEST ')
    const eventIds = new Set(current.events.filter(isTest).map((e) => e.id))
    const athleteIds = new Set(current.athletes.filter(isTest).map((a) => a.id))
    const clubIds = new Set(current.clubs.filter(isTest).map((c) => c.id))
    const counts = { events: eventIds.size, clubs: clubIds.size, athletes: athleteIds.size }
    const keep = (list, test) => (list ?? []).filter((x) => !test(x))
    current.events = keep(current.events, (e) => eventIds.has(e.id))
    for (const key of ['eventMembers', 'eventClubs', 'lateEntries', 'officialInvitations', 'eventOfficials', 'weighIns']) {
      current[key] = keep(current[key], (x) => eventIds.has(x.event_id) || athleteIds.has(x.athlete_id))
    }
    current.eventAthletes = keep(current.eventAthletes, (x) => eventIds.has(x.event_id) || athleteIds.has(x.athlete_id))
    current.bouts = keep(current.bouts, (b) => eventIds.has(b.event_id) || athleteIds.has(b.red_athlete_id) || athleteIds.has(b.blue_athlete_id))
    current.transfers = keep(current.transfers, (t) => athleteIds.has(t.athlete_id))
    current.athletes = keep(current.athletes, (a) => athleteIds.has(a.id))
    current.clubMembers = keep(current.clubMembers, (m) => clubIds.has(m.club_id))
    current.clubs = keep(current.clubs, (c) => clubIds.has(c.id))
    write(DATA_KEY, current)
    return counts
  },

  // Add a Coach or Viewer, or change their role. Ownership moves only through transferEventOwnership.
  async setEventMember(eventId, userId, role) {
    const current = data()
    const event = requireEditor(current, eventId)
    if (role !== 'viewer') throw new Error('Only a site Admin can change who owns an event')
    const existing = current.eventMembers.find((m) => m.event_id === eventId && m.user_id === userId)
    if (existing?.role === 'owner') throw new Error('Only a site Admin can change who owns an event')
    if (existing) existing.role = role
    else {
      if (effectiveStatus(event) !== 'active') throw new Error('People can be added once the event is Active')
      current.eventMembers.push({ event_id: eventId, user_id: userId, role })
    }
    write(DATA_KEY, current)
  },

  async removeEventMember(eventId, userId) {
    const current = data()
    requireEditor(current, eventId)
    const member = current.eventMembers.find((m) => m.event_id === eventId && m.user_id === userId)
    if (member?.role === 'owner') throw new Error('Only a site Admin can change who owns an event')
    current.eventMembers = current.eventMembers.filter((m) => m !== member)
    write(DATA_KEY, current)
  },

  // The old Owner stays on as a Viewer.
  async transferEventOwnership(eventId, userId) {
    requireSiteAdmin('Only a site Admin can change who owns an event')
    const current = data()
    findEvent(current, eventId)
    current.eventMembers.forEach((m) => {
      if (m.event_id === eventId && m.role === 'owner' && m.user_id !== userId) m.role = 'viewer'
    })
    const existing = current.eventMembers.find((m) => m.event_id === eventId && m.user_id === userId)
    if (existing) existing.role = 'owner'
    else current.eventMembers.push({ event_id: eventId, user_id: userId, role: 'owner' })
    write(DATA_KEY, current)
  },

  async inviteClub(eventId, clubId) {
    const current = data()
    const event = findEvent(current, eventId)
    if (!isOwnerOf(current, eventId)) throw new Error('Only the event\'s Owner or a site Admin can invite clubs')
    if (!eventOpen(event)) throw new Error('Clubs can be invited once the event is Active')
    const existing = current.eventClubs.find((ec) => ec.event_id === eventId && ec.club_id === clubId)
    if (existing) existing.status = 'accepted'
    else current.eventClubs.push({ event_id: eventId, club_id: clubId, status: 'accepted', requested_at: now() })
    write(DATA_KEY, current)
  },

  async requestToJoin(eventId, clubId) {
    const current = data()
    const event = findEvent(current, eventId)
    if (!isSiteAdmin() && clubRole(current, clubId) !== 'owner') throw new Error('Only the club\'s Owners can ask to join for it')
    if (!eventOpen(event)) throw new Error('Clubs can join once the event is Active')
    const existing = current.eventClubs.find((ec) => ec.event_id === eventId && ec.club_id === clubId)
    if (existing?.status === 'accepted') throw new Error('That club is already in this event')
    if (existing) Object.assign(existing, { status: 'requested', requested_at: now() })
    else current.eventClubs.push({ event_id: eventId, club_id: clubId, status: 'requested', requested_at: now() })
    write(DATA_KEY, current)
  },

  async decideJoinRequest(eventId, clubId, accept) {
    const current = data()
    if (!isOwnerOf(current, eventId)) throw new Error('Only the event\'s Owner or a site Admin can answer join requests')
    const request = current.eventClubs.find((ec) => ec.event_id === eventId && ec.club_id === clubId && ec.status === 'requested')
    if (!request) throw new Error('That request is no longer waiting')
    request.status = accept ? 'accepted' : 'declined'
    write(DATA_KEY, current)
  },

  async removeEventClub(eventId, clubId) {
    const current = data()
    const event = findEvent(current, eventId)
    if (!isOwnerOf(current, eventId) && clubRole(current, clubId) !== 'owner') throw new Error('Only the event\'s Owner, the club\'s Owners or a site Admin can do that')
    if (!stillRunning(event) && !isSiteAdmin()) throw new Error('This event can no longer be changed')
    current.eventAthletes = current.eventAthletes.filter((ea) => !(ea.event_id === eventId && ea.club_id === clubId))
    current.lateEntries.forEach((r) => {
      if (r.event_id === eventId && r.club_id === clubId && r.status === 'pending') r.status = 'cancelled'
    })
    current.eventClubs = current.eventClubs.filter((ec) => !(ec.event_id === eventId && ec.club_id === clubId))
    write(DATA_KEY, current)
  },

  async enterAthlete(eventId, athleteId, opponentName, opponentClub) {
    const current = data()
    const event = findEvent(current, eventId)
    const clubId = checkEntry(current, event, athleteId)
    if (!entriesOpen(event) && !isSiteAdmin()) throw new Error('The entry deadline has passed. Send the Owner a late-entry request instead.')
    current.eventAthletes.push({
      event_id: eventId, athlete_id: athleteId, club_id: clubId, added_by: currentUserId(),
      suggested_opponent_name: opponentName?.trim() || null, suggested_opponent_club: opponentClub?.trim() || null,
    })
    write(DATA_KEY, current)
  },

  async suggestOpponent(eventId, athleteId, opponentName, opponentClub) {
    const current = data()
    const entry = current.eventAthletes.find((ea) => ea.event_id === eventId && ea.athlete_id === athleteId)
    if (!entry) throw new Error('That athlete isn\'t entered')
    if (!isSiteAdmin() && clubRole(current, entry.club_id) !== 'owner') throw new Error('Only the athlete\'s club Owners can suggest an opponent')
    Object.assign(entry, { suggested_opponent_name: opponentName?.trim() || null, suggested_opponent_club: opponentClub?.trim() || null })
    write(DATA_KEY, current)
  },

  async withdrawAthlete(eventId, athleteId) {
    const current = data()
    const event = findEvent(current, eventId)
    const entry = current.eventAthletes.find((ea) => ea.event_id === eventId && ea.athlete_id === athleteId)
    if (!entry) throw new Error('That athlete isn\'t entered')
    if (!isSiteAdmin() && clubRole(current, entry.club_id) !== 'owner') throw new Error('Only the athlete\'s club Owners can withdraw them')
    if (!isSiteAdmin() && !stillRunning(event)) throw new Error('This event is over, so its entries can\'t change')
    current.eventAthletes = current.eventAthletes.filter((ea) => ea !== entry)
    cancelAthleteBouts(current, eventId, athleteId, null, 'Withdrawn from the event')
    write(DATA_KEY, current)
  },

  async requestLateEntry(eventId, athleteId, note) {
    const current = data()
    const event = findEvent(current, eventId)
    const clubId = checkEntry(current, event, athleteId)
    if (entriesOpen(event)) throw new Error('Entries are still open, so enter the athlete directly')
    if (current.lateEntries.some((r) => r.event_id === eventId && r.athlete_id === athleteId && r.status === 'pending')) {
      throw new Error('There is already a late-entry request waiting for that athlete')
    }
    current.lateEntries.push({
      id: crypto.randomUUID(), event_id: eventId, athlete_id: athleteId, club_id: clubId, note: note?.trim() || null,
      status: 'pending', requested_by: currentUserId(), requested_at: now(),
    })
    write(DATA_KEY, current)
  },

  async decideLateEntry(requestId, accept) {
    const current = data()
    const request = current.lateEntries.find((r) => r.id === requestId)
    if (!request || request.status !== 'pending') throw new Error('That request is no longer waiting')
    if (!isOwnerOf(current, request.event_id)) throw new Error('Only the event\'s Owner or a site Admin can answer late-entry requests')
    if (accept) {
      if (!eventOpen(findEvent(current, request.event_id))) throw new Error('This event is no longer taking entries')
      if (!current.eventAthletes.some((ea) => ea.event_id === request.event_id && ea.athlete_id === request.athlete_id)) {
        current.eventAthletes.push({ event_id: request.event_id, athlete_id: request.athlete_id, club_id: request.club_id, added_by: currentUserId() })
      }
    }
    request.status = accept ? 'accepted' : 'declined'
    write(DATA_KEY, current)
  },

  async cancelLateEntry(requestId) {
    const current = data()
    const request = current.lateEntries.find((r) => r.id === requestId)
    if (!request || request.status !== 'pending') throw new Error('That request is no longer waiting')
    if (!isSiteAdmin() && request.requested_by !== currentUserId() && clubRole(current, request.club_id) !== 'owner') {
      throw new Error('Only the club\'s Owners can withdraw this request')
    }
    request.status = 'cancelled'
    write(DATA_KEY, current)
  },

  resetDemoData() {
    write(DATA_KEY, null)
  },

  // ---------------------------------------------------------------------------
  // Bouts (stage 4)
  // ---------------------------------------------------------------------------

  async getBouts(eventId) {
    const current = data()
    if (!canSee(current, eventId)) return { officials: [], bouts: [], weighIns: [], acceptedDays: [] }
    const officials = current.eventOfficials
      .filter((o) => o.event_id === eventId)
      .map((o) => ({ ...o, user: findUser(current, o.user_id) }))
    if (!canSeeEntries(current, eventId)) return { officials, bouts: [], weighIns: [], acceptedDays: [] }
    const athlete = (id) => {
      const a = current.athletes.find((x) => x.id === id)
      return a ? { id: a.id, name: a.name } : null
    }
    const bouts = current.bouts
      .filter((b) => b.event_id === eventId)
      .sort((a, b) => a.day.localeCompare(b.day) || a.position - b.position)
      .map((b) => ({
        ...b,
        red: athlete(b.red_athlete_id), blue: athlete(b.blue_athlete_id),
        red_club: { id: b.red_club_id, name: clubName(current, b.red_club_id) },
        blue_club: { id: b.blue_club_id, name: clubName(current, b.blue_club_id) },
        comments: isInBout(current, b) ? b.comments.map((c) => ({ ...c, author: findUser(current, c.author_id) })) : [],
      }))
    return { officials, bouts, weighIns: current.weighIns.filter((w) => w.event_id === eventId), acceptedDays: myDays(current, eventId) }
  },

  async setEventOfficial(eventId, role, userId) {
    const current = data()
    requireEditor(current, eventId)
    if (userId && !userAccepted(current, eventId, userId)) throw new Error('Pick an official who has accepted the invitation to this event')
    current.eventOfficials = current.eventOfficials.filter((o) => !(o.event_id === eventId && o.role === role))
    if (userId) {
      if (current.eventOfficials.some((o) => o.event_id === eventId && o.user_id === userId)) {
        throw new Error('The Chief Official and the Deputy must be different people')
      }
      current.eventOfficials.push({ event_id: eventId, role, user_id: userId })
    }
    write(DATA_KEY, current)
  },

  // Official invitations: the same rules as the database functions in migration 14.
  async listInvitableOfficials(eventId) {
    const current = data()
    if (!isOwnerOf(current, eventId)) throw new Error('Only the event\'s Owner or a site Admin can invite officials')
    return current.officials
      .filter((o) => o.invite_email)
      .map((o) => ({ id: o.id, name: o.name, email: o.invite_email, signed_in: Boolean(o.user_id) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  async listEventInvitations(eventId) {
    const current = data()
    if (!isOwnerOf(current, eventId) && !officialRole(current, eventId)) return []
    return current.officialInvitations
      .filter((i) => i.event_id === eventId)
      .map((i) => {
        const o = current.officials.find((x) => x.id === i.official_id)
        return { ...i, name: o?.name ?? '—', email: o?.invite_email ?? null, user_id: o?.user_id ?? null }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  async listMyInvitations() {
    const current = data()
    const mine = new Set(current.officials.filter((o) => o.user_id && o.user_id === currentUserId()).map((o) => o.id))
    return current.officialInvitations
      .filter((i) => mine.has(i.official_id) && current.events.some((e) => e.id === i.event_id))
      .map((i) => {
        const e = current.events.find((x) => x.id === i.event_id)
        return {
          ...i, event_name: e.name, venue: e.venue, start_date: e.start_date, end_date: e.end_date,
          timezone: e.timezone, event_status: e.status,
        }
      })
      .sort((a, b) => b.start_date.localeCompare(a.start_date))
  },

  async inviteOfficials(eventId, officialIds, respondBy) {
    const current = data()
    const event = findEvent(current, eventId)
    if (!isOwnerOf(current, eventId)) throw new Error('Only the event\'s Owner or a site Admin can invite officials')
    if (!eventOpen(event)) throw new Error('Officials can be invited once the event is Active, and until it is over')
    if (respondBy && respondBy < todayIso(event.timezone)) throw new Error('The respond-by date has already passed')
    if (respondBy && respondBy > event.end_date) throw new Error('The respond-by date must be on or before the event\'s last day')
    if (!officialIds?.length) throw new Error('Choose at least one official')
    const sent = []
    for (const officialId of officialIds) {
      if (!current.officials.some((o) => o.id === officialId && o.invite_email)) throw new Error('Only officials with an email can be invited')
      let invite = current.officialInvitations.find((i) => i.event_id === eventId && i.official_id === officialId)
      if (invite?.status === 'accepted') continue
      if (!invite) {
        invite = { id: crypto.randomUUID(), event_id: eventId, official_id: officialId }
        current.officialInvitations.push(invite)
      }
      Object.assign(invite, { status: 'pending', respond_by: respondBy || null, invited_at: now(), responded_at: null })
      sent.push(invite.id)
    }
    write(DATA_KEY, current)
    return sent
  },

  async respondToInvitation(invitationId, accept, days, sessions) {
    const current = data()
    const invite = current.officialInvitations.find((i) => i.id === invitationId)
    if (!invite) throw new Error('That invitation has been cancelled')
    const official = current.officials.find((o) => o.id === invite.official_id)
    if (!official?.user_id || official.user_id !== currentUserId()) throw new Error('Only the invited official can answer this invitation')
    const event = findEvent(current, invite.event_id)
    const today = todayIso(event.timezone)
    if (event.status !== 'active' || today >= event.start_date) throw new Error('Answers are locked once the event starts. Contact the event\'s Owner.')
    if (invite.status === 'pending' && invite.respond_by && today > invite.respond_by) {
      throw new Error('The respond-by date has passed. Ask the event\'s Owner to invite you again.')
    }
    let chosen = null
    let parts = null
    if (accept) {
      chosen = [...new Set(days?.length ? days : daysBetween(event.start_date, event.end_date))].sort()
      if (chosen.some((d) => d < event.start_date || d > event.end_date)) throw new Error('Pick days of the event')
      parts = [...new Set(sessions ?? [])].sort()
      const real = (key) => chosen.includes(key.slice(0, 10))
        && (event.days.find((d) => d.day === key.slice(0, 10))?.sessions ?? []).some((x) => x.starts_at === key.slice(11))
      if (!parts.every(real)) throw new Error('Pick bout sessions of the days you work')
    }
    invite.status = accept ? 'accepted' : 'declined'
    invite.days = chosen
    invite.sessions = accept && parts.length ? parts : null
    invite.responded_at = now()
    if (!accept) current.eventOfficials = current.eventOfficials.filter((o) => !(o.event_id === event.id && o.user_id === official.user_id))
    write(DATA_KEY, current)
  },

  async cancelInvitation(invitationId) {
    const current = data()
    const invite = current.officialInvitations.find((i) => i.id === invitationId)
    if (!invite) return
    requireEditor(current, invite.event_id)
    const userId = current.officials.find((o) => o.id === invite.official_id)?.user_id
    current.officialInvitations = current.officialInvitations.filter((i) => i.id !== invitationId)
    if (userId) current.eventOfficials = current.eventOfficials.filter((o) => !(o.event_id === invite.event_id && o.user_id === userId))
    write(DATA_KEY, current)
  },

  async emailOfficialInvitation() {
    throw new Error('Demo mode doesn\'t send email')
  },

  async saveBout({ id, eventId, day, redId, blueId, needsSupervisor, warnings }) {
    const current = data()
    const event = findEvent(current, eventId)
    const old = id ? findBout(current, id) : null
    if (old?.winner) throw new Error('This bout has a result, so it can\'t be re-matched')
    if ((old && !canMatch(current, eventId, old.day)) || !canMatch(current, eventId, day)) {
      throw new Error(roleOn(current, eventId) === 'owner'
        ? 'The weigh-in for that day has started, so only the Chief Official or Deputy can make bouts'
        : 'Only the event\'s Owner or officials can make bouts')
    }
    if (!cardOpen(event)) throw new Error('Bouts can be made only while the event is Active')
    if (!day || day < event.start_date || day > event.end_date) throw new Error('Pick a day of the event')
    if (!redId || !blueId || redId === blueId) throw new Error('Pick two different athletes')
    const red = current.eventAthletes.find((ea) => ea.event_id === eventId && ea.athlete_id === redId)
    const blue = current.eventAthletes.find((ea) => ea.event_id === eventId && ea.athlete_id === blueId)
    if (!red || !blue) throw new Error('Both athletes must be entered in the event')
    const gender = (aid) => current.athletes.find((a) => a.id === aid)?.gender
    if (gender(redId) !== gender(blueId)) throw new Error('Male and female athletes can\'t box each other')
    if (current.bouts.some((b) => b.event_id === eventId && b.day === day && b.status !== 'cancelled' && b.id !== id &&
        [b.red_athlete_id, b.blue_athlete_id].some((x) => x === redId || x === blueId))) {
      throw new Error('One of these athletes already has a bout that day')
    }
    const nextPosition = Math.max(0, ...current.bouts.filter((b) => b.event_id === eventId && b.day === day).map((b) => b.position)) + 1
    const fields = {
      red_athlete_id: redId, blue_athlete_id: blueId, red_club_id: red.club_id, blue_club_id: blue.club_id,
      needs_supervisor: Boolean(needsSupervisor), warnings: warnings ?? [], after_weigh_in: weighInStarted(current, eventId, day),
      status: 'pending', cancel_reason: null, cancelled_at: null, made_by: currentUserId(), made_at: now(), approvals: [],
    }
    let bout = old
    if (bout) {
      if (bout.day !== day) Object.assign(bout, { day, position: nextPosition, session_starts_at: null })
      Object.assign(bout, fields)
    } else {
      bout = { id: crypto.randomUUID(), event_id: eventId, day, session_starts_at: null, position: nextPosition, comments: [], ...fields }
      current.bouts.push(bout)
    }
    write(DATA_KEY, current)
    return bout.id
  },

  async decideBout(boutId, side, approve, note) {
    const current = data()
    const bout = findBout(current, boutId)
    if (bout.status === 'cancelled' || bout.winner) throw new Error('This bout can no longer be approved or rejected')
    if (!cardOpen(findEvent(current, bout.event_id))) throw new Error('The event isn\'t Active')
    let override = false
    if (side === 'official') {
      if (!isOfficial(current, bout.event_id)) throw new Error('Only the Chief Official or Deputy gives the official approval')
    } else {
      const club = side === 'red' ? bout.red_club_id : bout.blue_club_id
      if (clubRole(current, club) !== 'owner' && !isSiteAdmin()) {
        if (bout.after_weigh_in && officialRole(current, bout.event_id)) override = true
        else throw new Error('Only that corner\'s club Owners can approve for it')
      }
    }
    bout.approvals = bout.approvals.filter((a) => a.side !== side)
    bout.approvals.push({ side, decision: approve ? 'approved' : 'rejected', note: note?.trim() || null, override, decided_by: currentUserId(), decided_at: now() })
    refreshBoutStatus(bout)
    write(DATA_KEY, current)
  },

  async cancelBout(boutId, reason) {
    const current = data()
    const bout = findBout(current, boutId)
    if (!canMatch(current, bout.event_id, bout.day)) throw new Error('Only the event\'s Owner (before the weigh-in) or officials can cancel bouts')
    if (bout.winner) throw new Error('This bout has a result, so it can\'t be cancelled')
    Object.assign(bout, { status: 'cancelled', cancel_reason: reason?.trim() || null, cancelled_at: now() })
    write(DATA_KEY, current)
  },

  async setCardOrder(eventId, day, order) {
    const current = data()
    if (!isOwnerOf(current, eventId)) throw new Error('Only the event\'s Owner sets the order of the card')
    if (!cardOpen(findEvent(current, eventId))) throw new Error('The card can change only while the event is Active')
    order.forEach(({ id, session }, i) => {
      const bout = current.bouts.find((b) => b.id === id && b.event_id === eventId && b.day === day)
      if (bout) Object.assign(bout, { position: i + 1, session_starts_at: session || null })
    })
    write(DATA_KEY, current)
  },

  async addBoutComment(boutId, body) {
    const current = data()
    const bout = findBout(current, boutId)
    if (!isInBout(current, bout)) throw new Error('Only people involved in this bout can comment on it')
    if (!body?.trim()) throw new Error('Write a comment first')
    bout.comments.push({ id: crypto.randomUUID(), body: body.trim(), created_at: now(), author_id: currentUserId() })
    write(DATA_KEY, current)
  },

  async recordWeighIn({ eventId, day, athleteId, weightKg, medical, note }) {
    const current = data()
    const event = findEvent(current, eventId)
    if (!isOfficial(current, eventId) && !myDays(current, eventId).includes(day)) throw new Error('Only the event\'s officials record the weigh-in, on the days they officiate')
    if (!cardOpen(event)) throw new Error('The weigh-in can be recorded only while the event is Active')
    if (!current.eventAthletes.some((ea) => ea.event_id === eventId && ea.athlete_id === athleteId)) throw new Error('That athlete isn\'t entered in the event')
    const kg = weightKg === '' || weightKg == null ? null : Number(weightKg)
    if (medical === 'pass' && kg == null) throw new Error('Enter the athlete\'s weight')
    current.weighIns = current.weighIns.filter((w) => !(w.event_id === eventId && w.day === day && w.athlete_id === athleteId))
    current.weighIns.push({ event_id: eventId, day, athlete_id: athleteId, weight_kg: kg, medical, note: note?.trim() || null, recorded_at: now() })
    if (medical === 'fail') cancelAthleteBouts(current, eventId, athleteId, day, 'Failed the medical')
    if (medical === 'absent') cancelAthleteBouts(current, eventId, athleteId, day, 'Didn\'t come to the weigh-in')
    write(DATA_KEY, current)
  },

  async recordResult(boutId, winner, method, note) {
    const current = data()
    const bout = findBout(current, boutId)
    if (!isOfficial(current, bout.event_id)) throw new Error('Only the Chief Official or Deputy records results')
    if (bout.status !== 'approved') throw new Error('Only approved bouts get a result')
    if (!['red', 'blue'].includes(winner) || !method) throw new Error('Pick the winner and how they won')
    if (!bout.winner) {
      for (const a of current.athletes) if ([bout.red_athlete_id, bout.blue_athlete_id].includes(a.id)) a.bouts = (a.bouts ?? 0) + 1
    }
    Object.assign(bout, { winner, method, result_note: note?.trim() || null, result_by: currentUserId(), result_at: now() })
    write(DATA_KEY, current)
  },

  async clearResult(boutId) {
    const current = data()
    const bout = findBout(current, boutId)
    if (!isOfficial(current, bout.event_id)) throw new Error('Only the Chief Official or Deputy changes results')
    if (!bout.winner) return
    for (const a of current.athletes) if ([bout.red_athlete_id, bout.blue_athlete_id].includes(a.id)) a.bouts = Math.max((a.bouts ?? 0) - 1, 0)
    Object.assign(bout, { winner: null, method: null, result_note: null, result_by: null, result_at: null })
    write(DATA_KEY, current)
  },
}
