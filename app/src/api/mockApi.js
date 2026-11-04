// A stand-in for Supabase so the app can be tried before a project exists.
// Only one special user can sign in, and everything is kept in this browser's storage.
// The password ships inside the page's JavaScript, so this is for demos, not for protecting anything.
// The demo admin can also preview the app as one of the sample users (see viewAs).

import { athleteProblems } from '../athletes'
import { ageCategory, experienceCategory } from '../categories'
import { DEFAULT_TIME_ZONE, addDays, daysBetween, todayIso } from '../dates'
import { dayProblems, effectiveStatus, hasProblems } from '../events'
import { testClubs, testRoster } from './testRoster'
import { eventRoles, rolesFlags, rolesOf, rolesText } from '../officialRoles'

const ADMIN_EMAIL = (import.meta.env.VITE_MOCK_ADMIN_EMAIL || 'admin@matchmaking.test').toLowerCase()
const ADMIN_PASSWORD = import.meta.env.VITE_MOCK_ADMIN_PASSWORD || 'letmein'
const ADMIN_ID = 'mock-admin'

const SESSION_KEY = 'mock-session'
const DATA_KEY = 'mock-data-v12' // v12: Admin + Member accounts, no event Viewers (migration 45)

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
      { id: 'athlete-1', name: 'Ali Hassan', date_of_birth: '2004-03-12', gender: 'male', weight_kg: 60.5, bouts: 12, club_id: 'club-1', invite_email: 'ali@example.com', user_id: 'user-ali', coach_id: 'user-1', bc_number: 'BC-104233', last_medical: '2026-09-15' },
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
      { id: 'official-1', name: 'Grace Adeyemi', level: 3, qualifications: 'Referee', invite_email: 'grace@example.com', phone: '204-555-0101', bc_number: 'BC-300112', user_id: 'user-grace' },
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
      { id: 'invite-1', event_id: 'event-1', official_id: 'official-3', status: 'accepted', days: [start, addDays(start, 1)], referee: true, judge: true, supervisor: true, respond_by: null, invited_at: new Date().toISOString(), responded_at: new Date().toISOString() },
      { id: 'invite-2', event_id: 'event-1', official_id: 'official-4', status: 'accepted', days: [start], judge: true, timekeeper: true, respond_by: null, invited_at: new Date().toISOString(), responded_at: new Date().toISOString() },
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
        status: 'pending', bout_type: 'scored', needs_supervisor: false, warnings: ['Different weight classes, 1.3 kg apart', 'Open vs Open, 2 bouts apart'],
        after_weigh_in: false, made_by: 'user-1', made_at: new Date().toISOString(),
        approvals: [],
        comments: [],
        approval_requested_at: new Date().toISOString(), approval_requested_by: 'user-1',
      },
    ],
    weighIns: [],
    notifications: [
      {
        id: 'note-1', user_id: ADMIN_ID, kind: 'member_request', title: 'Approve Priya Shah as coach of Eastside BC',
        body: 'Invited by Maria Lopez', event_id: null, club_id: 'club-1', bout_id: null, tab: null,
        action_key: 'member:club-1:user-3', needs_action: true, actor_id: 'user-1', created_at: new Date().toISOString(), read_at: null, done_at: null,
      },
      {
        id: 'note-3', user_id: 'user-3', kind: 'bout_approval', title: 'Approve bout: Ali Hassan vs Marco Ruiz',
        body: `Eastside Winter Box Cup · ${label(start)}`, event_id: 'event-1', club_id: null, bout_id: 'bout-1', tab: 'bouts',
        action_key: 'bout:bout-1:official', needs_action: true, actor_id: 'user-1', created_at: new Date().toISOString(), read_at: null, done_at: null,
      },
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
  if (key === DATA_KEY) setTimeout(() => noteListeners.forEach((callback) => callback()), 0)
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

// Two account types (migration 45): Admin and Member. Older saved data may still say user or official.
const roleNames = { admin: 'Admins', member: 'Members' }
const accountOf = (user) => (user?.role_id === 'admin' ? 'admin' : 'member')

// Members request events; a site Admin approves or denies them (migration 20261103050000).
const memberPermissions = () => [...userPermissions, 'events:create']
const byName = (a, b) => (a.name || a.email).localeCompare(b.name || b.email)

function currentUserId() {
  return read(SESSION_KEY)?.user.id
}

const adminUser = { id: ADMIN_ID, email: ADMIN_EMAIL, name: 'Demo Admin', state: 'Active' }
const findUser = (current, id) => (id === ADMIN_ID ? adminUser : current.users.find((u) => u.id && u.id === id) ?? null)

const isSiteAdmin = () => currentUserId() === ADMIN_ID

// The signed-in user's role on an event: 'owner' or null.
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
// Mirrors my_event_roles: the signed-in user's event roles from their accepted invitation.
const myEventRoles = (current, eventId) => {
  const invite = (current.officialInvitations ?? []).find((i) => i.event_id === eventId && i.status === 'accepted'
    && current.officials.find((o) => o.id === i.official_id)?.user_id === currentUserId())
  return rolesFlags(rolesOf(invite))
}
const userAccepted = (current, eventId, userId) => (current.officialInvitations ?? []).some((i) => i.event_id === eventId && i.status === 'accepted'
  && current.officials.find((o) => o.id === i.official_id)?.user_id === userId)
// Approved bouts for the public page, as migration 19's list_public_events: card numbers count every
// live bout that day; corners show name, club and categories only (never weight or birthdate).
function publicBouts(current, eventId, eventDate, days) {
  const live = (current.bouts ?? []).filter((b) => b.event_id === eventId && b.status !== 'cancelled')
    .sort((a, b) => a.day.localeCompare(b.day) || a.position - b.position)
  const corner = (athleteId, clubId) => {
    const a = current.athletes.find((x) => x.id === athleteId)
    const gender = { male: 'Male', female: 'Female' }[a?.gender]
    return {
      name: a?.name ?? 'Unknown',
      club: current.clubs.find((c) => c.id === clubId)?.name ?? null,
      categories: [ageCategory(a?.date_of_birth, eventDate)?.label, gender, experienceCategory(a?.bouts)?.label].filter(Boolean).join(' · ') || null,
    }
  }
  const numbers = new Map()
  return live.flatMap((b) => {
    const number = (numbers.get(b.day) ?? 0) + 1
    numbers.set(b.day, number)
    if (b.status !== 'approved') return []
    const starts = b.session_starts_at?.slice(0, 5) ?? null
    const session = days.find((d) => d.day === b.day)?.sessions.find((s) => s.starts_at === starts)
    return [{
      id: b.id, day: b.day, number, session_starts_at: starts, session_label: session?.label || null,
      red: corner(b.red_athlete_id, b.red_club_id), blue: corner(b.blue_athlete_id, b.blue_club_id),
    }]
  })
}

function canSee(current, eventId) {
  const event = current.events.find((e) => e.id === eventId)
  return Boolean(event) && (isSiteAdmin() || Boolean(roleOn(current, eventId)) || Boolean(officialRole(current, eventId)) || acceptedOfficial(current, eventId) || inEventClub(current, eventId) || ['active', 'done'].includes(event.status))
}
const canSeeEntries = (current, eventId) => isSiteAdmin() || roleOn(current, eventId) === 'owner' || inEventClub(current, eventId) || Boolean(officialRole(current, eventId)) || acceptedOfficial(current, eventId)
const isOwnerOf = (current, eventId) => isSiteAdmin() || roleOn(current, eventId) === 'owner'
const eventOpen = (event) => effectiveStatus(event) === 'active'
// Mirrors can_invite_officials: site Admins and the event's Chief Official.
// Both Chief Official seats count (migration 45).
const canInviteOfficials = (current, eventId) => isSiteAdmin() || Boolean(officialRole(current, eventId))
// Mirrors can_add_officials (migration 24): also the Deputy and any official who accepted.
const canAddOfficials = (current, eventId) => canInviteOfficials(current, eventId) || Boolean(officialRole(current, eventId)) || acceptedOfficial(current, eventId)

// Mirrors can_manage_event_clubs: the event's Owner or a site Admin, while the event is Active.
function requireClubManager(current, eventId, what) {
  const event = findEvent(current, eventId)
  if (!isOwnerOf(current, eventId) || !eventOpen(event)) throw new Error(`Only the event's Owner or a site Admin can ${what}, while the event is Active`)
}

function requireClubInEvent(current, eventId, clubId) {
  if (!current.eventClubs.some((ec) => ec.event_id === eventId && ec.club_id === clubId && ec.status === 'accepted')) throw new Error('That club isn\'t in this event')
}

// An active club owner, with no site Admin approval (only the functions above call this).
function putClubOwner(current, clubId, userId) {
  const user = findUser(current, userId)
  if (!user || user.state !== 'Active') throw new Error('Pick someone who has signed in at least once')
  const existing = current.clubMembers.find((m) => m.club_id === clubId && m.user_id === userId)
  if (existing) Object.assign(existing, { role: 'owner', status: 'active' })
  else current.clubMembers.push({ club_id: clubId, user_id: userId, role: 'owner', status: 'active' })
}
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
  if (bout.bout_type === 'sparring') {
    bout.status = 'approved'
    return
  }
  // Only the Chief Official's or Deputy's decision counts (migration 26).
  const official = bout.approvals.find((a) => a.side === 'official')
  bout.status = official?.decision === 'approved' ? 'approved' : official?.decision === 'rejected' ? 'rejected' : 'pending'
}

// Adds a reason to a bout's "needs discussion" flag, once (migration 34).
function flagBout(current, bout, reason) {
  if (bout.status === 'cancelled' || bout.winner) return
  const before = bout.review_reason ?? null
  if (!before) bout.review_reason = reason
  else if (!before.includes(reason)) bout.review_reason = `${before} ${reason}`.slice(0, 600)
  if (bout.review_reason === before) return
  bout.review_at = now()
  const key = `review:${bout.id}`
  current.notifications = (current.notifications ?? []).filter((n) => !(n.action_key === key && !n.done_at))
  notify(current, eventOfficialIds(current, bout.event_id), 'bout_review', `Discuss bout: ${boutLabel(current, bout)}`, {
    body: `${boutWhere(current, bout)} · ${bout.review_reason}`, eventId: bout.event_id, boutId: bout.id, tab: 'bouts', key,
  })
}

function flagAthleteBouts(current, eventId, athleteId, day, reason) {
  for (const b of current.bouts ?? []) {
    if (b.event_id === eventId && b.day === day && [b.red_athlete_id, b.blue_athlete_id].includes(athleteId)) flagBout(current, b, reason)
  }
}

function cancelAthleteBouts(current, eventId, athleteId, day, reason) {
  for (const b of current.bouts ?? []) {
    if (b.event_id === eventId && b.status !== 'cancelled' && !b.winner && (day == null || b.day === day) &&
        [b.red_athlete_id, b.blue_athlete_id].includes(athleteId)) {
      Object.assign(b, { status: 'cancelled', cancel_reason: reason, cancelled_at: now() })
    }
  }
}

// The four helper logins from migration 33: [user id, email, name, event they own or lead].
const HELPER_ACCOUNTS = [
  ['demo-owner1', 'owner1@demo.test', 'TEST Event Owner 1'],
  ['demo-owner2', 'owner2@demo.test', 'TEST Event Owner 2'],
  ['demo-official1', 'official1@demo.test', 'TEST Official 1'],
  ['demo-official2', 'official2@demo.test', 'TEST Official 2'],
]

// Adds the helper logins to the TEST events, as migration 33 does. Returns how many were new.
function addHelperAccounts(current) {
  const one = current.events.find((e) => e.name === 'TEST One-Day Card')
  const multi = current.events.find((e) => e.name === 'TEST Multi-Day Open')
  if (!one || !multi) throw new Error('Load test data first. The helper logins are added to the TEST events.')
  let made = 0
  for (const [id, email, name] of HELPER_ACCOUNTS) {
    if (!current.users.some((u) => u.id === id)) {
      current.users.push({ id, email, name, state: 'Active' })
      made += 1
    }
  }
  for (const [event, owner] of [[one, 'demo-owner1'], [multi, 'demo-owner2']]) {
    current.eventMembers = current.eventMembers.filter((m) => !(m.event_id === event.id && (m.user_id === owner || m.role === 'owner')))
    current.eventMembers.push({ event_id: event.id, user_id: owner, role: 'owner' })
  }
  current.officialInvitations = current.officialInvitations ?? []
  current.eventOfficials = current.eventOfficials ?? []
  for (const [userId, , name] of HELPER_ACCOUNTS.filter(([id]) => id.startsWith('demo-official'))) {
    const email = HELPER_ACCOUNTS.find(([id]) => id === userId)[1]
    let official = current.officials.find((o) => o.user_id === userId)
    if (!official) {
      official = { id: crypto.randomUUID(), name, qualifications: 'Level 3 referee', invite_email: email, user_id: userId }
      current.officials.push(official)
    }
    for (const event of [one, multi]) {
      if (!current.officialInvitations.some((i) => i.event_id === event.id && i.official_id === official.id)) {
        current.officialInvitations.push({ id: crypto.randomUUID(), event_id: event.id, official_id: official.id, status: 'accepted', days: event.days.map((d) => d.day), judge: true, referee: true, supervisor: true, timekeeper: true, respond_by: null, invited_at: new Date().toISOString(), responded_at: new Date().toISOString() })
      }
    }
  }
  current.eventOfficials = current.eventOfficials.filter((o) => o.event_id !== one.id && o.event_id !== multi.id)
  current.eventOfficials.push(
    { event_id: one.id, role: 'chief', user_id: 'demo-official1' }, { event_id: one.id, role: 'deputy', user_id: 'demo-official2' },
    { event_id: multi.id, role: 'chief', user_id: 'demo-official2' }, { event_id: multi.id, role: 'deputy', user_id: 'demo-official1' },
  )
  return made
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

// ---------------------------------------------------------------------------
// Notifications: mirrors migration 22 (20261101140000_notifications.sql)
// ---------------------------------------------------------------------------

const noteListeners = new Set()

// One notification per person, never to whoever is acting. `key` makes it a to-do.
function notify(current, userIds, kind, title, { body, eventId, clubId, boutId, tab, key } = {}) {
  current.notifications ??= []
  const actor = currentUserId()
  for (const userId of new Set(userIds.filter(Boolean))) {
    if (userId === actor) continue
    current.notifications.push({
      id: crypto.randomUUID(), user_id: userId, kind, title, body: body ? body.slice(0, 300) : null,
      event_id: eventId ?? null, club_id: clubId ?? null, bout_id: boutId ?? null, tab: tab ?? null,
      action_key: key ?? null, needs_action: Boolean(key), actor_id: actor, created_at: now(), read_at: null, done_at: null,
    })
  }
}

// Marks open to-dos with this key done; a key ending in '%' matches every key starting with it.
function resolveNotes(current, key) {
  const match = key.endsWith('%') ? (k) => k?.startsWith(key.slice(0, -1)) : (k) => k === key
  for (const n of current.notifications ?? []) {
    if (!n.done_at && match(n.action_key)) Object.assign(n, { done_at: now(), read_at: n.read_at ?? now() })
  }
}

const eventOwnerIds = (current, eventId) => current.eventMembers.filter((m) => m.event_id === eventId && m.role === 'owner').map((m) => m.user_id)
const eventOfficialIds = (current, eventId) => (current.eventOfficials ?? []).filter((o) => o.event_id === eventId).map((o) => o.user_id)
const clubPeopleIds = (current, clubId, coaches = false) => current.clubMembers
  .filter((m) => m.club_id === clubId && m.status === 'active' && (m.role === 'owner' || (coaches && m.role === 'coach'))).map((m) => m.user_id)
const athleteName = (current, id) => current.athletes.find((a) => a.id === id)?.name ?? null
const eventName = (current, id) => current.events.find((e) => e.id === id)?.name ?? 'the event'
const personName = (current, id) => findUser(current, id)?.name || findUser(current, id)?.email || 'Someone'
const boutLabel = (current, b) => `${athleteName(current, b.red_athlete_id) ?? 'Red'} vs ${athleteName(current, b.blue_athlete_id) ?? 'Blue'}`
const boutWhere = (current, b) => `${eventName(current, b.event_id)} · ${label(b.day)}`
const boutPeople = (current, b) => [
  ...eventOwnerIds(current, b.event_id), ...eventOfficialIds(current, b.event_id),
  ...clubPeopleIds(current, b.red_club_id, true), ...clubPeopleIds(current, b.blue_club_id, true),
]

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
        profile: {
          id: user.id, email: user.email, name: user.name, role_id: accountOf(user), status: 'active', roles: { name: roleNames[accountOf(user)] },
          in_club: data().clubMembers.some((m) => m.user_id === user.id),
          owns_event: data().eventMembers.some((m) => m.user_id === user.id && m.role === 'owner'),
        },
        permissions: memberPermissions(),
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
      ...current.users.map((u) => ({ ...u, role_id: accountOf(u), role_name: roleNames[accountOf(u)] })),
    ].sort(byName)
  },

  async emailNewUser() {
    throw new Error('Demo mode doesn\'t send email')
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

  async addUser({ name, email, roleId = 'member' }) {
    const clean = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('That email address doesn\'t look right')
    if (clean === adminUser.email.toLowerCase()) throw new Error('In demo mode the demo admin can\'t be changed')
    const current = data()
    const existing = current.users.find((u) => u.email === clean)
    if (existing) {
      existing.name = name.trim() || existing.name
      existing.role_id = roleId || 'member'
    } else {
      current.users.push({ id: null, email: clean, name: name.trim(), role_id: roleId || 'member', state: 'Invited' })
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
      email_invites: isSiteAdmin() || clubRole(current, clubId) === 'owner' ? (current.clubEmailInvites ?? []).filter((i) => i.club_id === clubId) : [],
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
    if (approved) {
      notify(current, [userId], 'member_answer', `You are now ${role === 'owner' ? 'an Owner' : 'a Coach'} of ${clubName(current, clubId)}`, { clubId })
    } else {
      notify(current, [ADMIN_ID], 'member_request', `Approve ${personName(current, userId)} as ${role} of ${clubName(current, clubId)}`, {
        body: `Invited by ${personName(current, currentUserId())}`, clubId, key: `member:${clubId}:${userId}`,
      })
    }
    write(DATA_KEY, current)
  },

  async listTransferClubs() {
    return data().clubs.map((c) => ({ id: c.id, name: c.name })).sort(byName)
  },

  async inviteClubMember(clubId, email, role) {
    const clean = (email ?? '').trim().toLowerCase()
    const user = data().users.find((u) => u.id && u.email?.toLowerCase() === clean)
    if (!user) {
      // Mirrors migration 45: hold the place until they sign in (demo mode has no real sign-in).
      const current = data()
      current.clubEmailInvites = current.clubEmailInvites ?? []
      if (current.clubEmailInvites.some((i) => i.club_id === clubId && i.email === clean)) throw new Error(`${clean} is already invited`)
      current.clubEmailInvites.push({ club_id: clubId, email: clean, role: role || 'coach', status: isSiteAdmin() ? 'active' : 'pending', invited_at: new Date().toISOString() })
      if (!current.users.some((u) => u.email === clean)) current.users.push({ id: null, email: clean, name: null, role_id: 'member', state: 'Invited' })
      write(DATA_KEY, current)
      return { name: clean, new_account: true }
    }
    await mockApi.addClubMember(clubId, user.id, role || 'coach', { approved: isSiteAdmin() })
    return { name: user.name || user.email, new_account: false }
  },

  async cancelClubEmailInvite(clubId, email) {
    const current = data()
    current.clubEmailInvites = (current.clubEmailInvites ?? []).filter((i) => !(i.club_id === clubId && i.email === email))
    write(DATA_KEY, current)
  },

  async approveClubMember(clubId, userId) {
    requireSiteAdmin('Only a site Admin can approve club members')
    const current = data()
    const member = current.clubMembers.find((m) => m.club_id === clubId && m.user_id === userId)
    if (member?.status === 'pending') {
      member.status = 'active'
      resolveNotes(current, `member:${clubId}:${userId}`)
      notify(current, [userId], 'member_answer', `You are now ${member.role === 'owner' ? 'an Owner' : 'a Coach'} of ${clubName(current, clubId)}`, { clubId })
      notify(current, [member.invited_by], 'member_answer', `${personName(current, userId)} was approved for ${clubName(current, clubId)}`, { clubId })
    }
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
    resolveNotes(current, `member:${clubId}:${userId}`)
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
    const transfer = {
      id: crypto.randomUUID(), athlete_id: athleteId, from_club_id: athlete.club_id, to_club_id: toClubId,
      status: 'pending', note: note?.trim() || null, requested_by: currentUserId(), requested_at: new Date().toISOString(),
    }
    current.transfers.push(transfer)
    notify(current, clubPeopleIds(current, toClubId), 'transfer', `Transfer request: ${athlete.name} to ${clubName(current, toClubId)}`, {
      body: `From ${clubName(current, athlete.club_id) ?? 'no club'}${transfer.note ? `: "${transfer.note}"` : ''}`, clubId: toClubId, key: `transfer:${transfer.id}`,
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
    resolveNotes(current, `transfer:${transfer.id}`)
    notify(current, [transfer.requested_by, ...clubPeopleIds(current, transfer.from_club_id)], 'transfer_answer',
      `${clubName(current, transfer.to_club_id)} ${transfer.status} the transfer of ${athleteName(current, transfer.athlete_id)}`, { clubId: transfer.from_club_id })
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
    resolveNotes(current, `transfer:${transfer.id}`)
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
    const current = data()
    if (!isSiteAdmin()) {
      if (ownerId && ownerId !== currentUserId()) throw new Error('Only a site Admin can create an event for someone else')
      ownerId = currentUserId()
    }
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

  async setMinOfficials(eventId, min) {
    const current = data()
    const event = current.events.find((e) => e.id === eventId)
    if (!event) throw new Error('That event no longer exists')
    if (!isOwnerOf(current, eventId) && !['chief', 'deputy'].includes(officialRole(current, eventId))) {
      throw new Error('Only a Chief Official, the event\'s Owner or a site Admin can set the minimum number of officials')
    }
    const n = Number(min)
    if (!Number.isInteger(n) || n < 1 || n > 100) throw new Error('The minimum number of officials must be between 1 and 100')
    event.min_officials = n
    write(DATA_KEY, current)
  },

  async setPublicBouts(eventId, show) {
    const current = data()
    requireEditor(current, eventId).show_public_bouts = !!show
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
  async setEventStatus(eventId, status, note) {
    requireSiteAdmin('Only a site Admin can approve, deny, cancel or close an event')
    const current = data()
    const event = findEvent(current, eventId)
    if (event.status === status) return
    event.status = status
    event.status_note = note?.trim() || null
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
      .map(({ id, name, venue, start_date, end_date, poster_path, days, timezone, show_public_bouts }) => ({ id, name, venue, start_date, end_date, poster_path, days, timezone: timezone ?? DEFAULT_TIME_ZONE, bouts: show_public_bouts ? publicBouts(data(), id, start_date, days) : [] }))
      .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name))
  },

  async deleteEvent(eventId) {
    requireSiteAdmin('Only a site Admin can delete events')
    const current = data()
    current.events = current.events.filter((e) => e.id !== eventId)
    // Everything that belongs to the event goes with it, like the database's on delete cascade.
    for (const key of ['eventMembers', 'eventAthletes', 'eventClubs', 'lateEntries', 'officialInvitations', 'eventOfficials', 'weighIns', 'bouts', 'notifications']) {
      current[key] = (current[key] ?? []).filter((x) => x.event_id !== eventId)
    }
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
    // Demo accounts, as migration 20 makes them. In demo mode, use "Viewing as" to try them.
    const demo = [['demo-event-owner', 'event-owner@demo.test', 'TEST Demo Event Owner'], ['demo-club-owner', 'club-owner@demo.test', 'TEST Demo Club Owner'], ['demo-official', 'official@demo.test', 'TEST Demo Official']]
    demo.forEach(([id, email, name]) => current.users.push({ id, email, name, state: 'Active' }))
    current.eventMembers = current.eventMembers.filter((m) => !Object.values(events).some((e) => e.id === m.event_id))
    const official = { id: crypto.randomUUID(), name: 'TEST Demo Official', qualifications: 'Level 3 referee', invite_email: 'official@demo.test', user_id: 'demo-official' }
    current.officials.push(official)
    current.officialInvitations = current.officialInvitations ?? []
    current.eventOfficials = current.eventOfficials ?? []
    for (const event of Object.values(events)) {
      current.eventMembers.push({ event_id: event.id, user_id: 'demo-event-owner', role: 'owner' })
      current.officialInvitations.push({ id: crypto.randomUUID(), event_id: event.id, official_id: official.id, status: 'accepted', days: event.days.map((d) => d.day), judge: true, referee: true, supervisor: true, timekeeper: true, respond_by: null, invited_at: now(), responded_at: now() })
      current.eventOfficials.push({ event_id: event.id, role: 'chief', user_id: 'demo-official' })
    }
    current.clubMembers.push({ club_id: clubIds['TEST North End Boxing'], user_id: 'demo-club-owner', role: 'owner', status: 'active' })
    const helpers = addHelperAccounts(current)
    write(DATA_KEY, current)
    return { events: 2, clubs: testClubs.length, athletes: testRoster.length, accounts: demo.length + helpers }
  },

  async seedHelperAccounts() {
    requireSiteAdmin('Only a site Admin can add helper logins')
    const current = data()
    const accounts = addHelperAccounts(current)
    write(DATA_KEY, current)
    return { accounts }
  },

  async clearHelperAccounts() {
    requireSiteAdmin('Only a site Admin can remove helper logins')
    const current = data()
    const ids = new Set(HELPER_ACCOUNTS.map(([id]) => id))
    const accounts = current.users.filter((u) => ids.has(u.id)).length
    const officialIds = new Set(current.officials.filter((o) => ids.has(o.user_id)).map((o) => o.id))
    current.officials = current.officials.filter((o) => !officialIds.has(o.id))
    current.officialInvitations = (current.officialInvitations ?? []).filter((i) => !officialIds.has(i.official_id))
    current.users = current.users.filter((u) => !ids.has(u.id))
    current.eventMembers = current.eventMembers.filter((m) => !ids.has(m.user_id))
    current.eventOfficials = (current.eventOfficials ?? []).filter((o) => !ids.has(o.user_id))
    // Hand the TEST events back to the original demo accounts, as migration 33 does.
    for (const event of current.events.filter((e) => e.name.startsWith('TEST '))) {
      const member = current.eventMembers.find((m) => m.event_id === event.id && m.user_id === 'demo-event-owner')
      if (member && !current.eventMembers.some((m) => m.event_id === event.id && m.role === 'owner')) member.role = 'owner'
      if (current.users.some((u) => u.id === 'demo-official') && !current.eventOfficials.some((o) => o.event_id === event.id && (o.role === 'chief' || o.user_id === 'demo-official'))) {
        current.eventOfficials.push({ event_id: event.id, role: 'chief', user_id: 'demo-official' })
      }
    }
    write(DATA_KEY, current)
    return { accounts }
  },

  async clearTestData() {
    requireSiteAdmin('Only a site Admin can clear test data')
    const current = data()
    const isTest = (x) => x.name.startsWith('TEST ')
    const eventIds = new Set(current.events.filter(isTest).map((e) => e.id))
    const testClubIds = new Set(current.clubs.filter(isTest).map((c) => c.id))
    // Athletes added to a TEST club go too, unless they are in a real (non-TEST) event.
    const inRealEvent = (a) => current.eventAthletes.some((x) => x.athlete_id === a.id && !eventIds.has(x.event_id))
      || current.bouts.some((b) => !eventIds.has(b.event_id) && (b.red_athlete_id === a.id || b.blue_athlete_id === a.id))
    const athleteIds = new Set(current.athletes.filter((a) => isTest(a) || (testClubIds.has(a.club_id) && !inRealEvent(a))).map((a) => a.id))
    const clubIds = new Set([...testClubIds].filter((id) => !current.athletes.some((a) => a.club_id === id && !athleteIds.has(a.id))))
    const demoIds = new Set(current.users.filter((u) => u.email.endsWith('@demo.test')).map((u) => u.id))
    const counts = { events: eventIds.size, clubs: clubIds.size, athletes: athleteIds.size, accounts: demoIds.size, kept_clubs: testClubIds.size - clubIds.size }
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
    const officialIds = new Set(current.officials.filter(isTest).map((o) => o.id))
    current.officialInvitations = keep(current.officialInvitations, (i) => officialIds.has(i.official_id))
    current.officials = keep(current.officials, (o) => officialIds.has(o.id))
    current.users = keep(current.users, (u) => demoIds.has(u.id))
    current.eventMembers = keep(current.eventMembers, (m) => demoIds.has(m.user_id))
    current.clubMembers = keep(current.clubMembers, (m) => demoIds.has(m.user_id))
    current.eventOfficials = keep(current.eventOfficials, (o) => demoIds.has(o.user_id))
    write(DATA_KEY, current)
    return counts
  },

  // The old Owner comes off the event (there are no Viewers since migration 45).
  async transferEventOwnership(eventId, userId) {
    requireSiteAdmin('Only a site Admin can change who owns an event')
    const current = data()
    findEvent(current, eventId)
    current.eventMembers = current.eventMembers.filter((m) => !(m.event_id === eventId && m.role === 'owner' && m.user_id !== userId))
    const existing = current.eventMembers.find((m) => m.event_id === eventId && m.user_id === userId)
    if (existing) existing.role = 'owner'
    else current.eventMembers.push({ event_id: eventId, user_id: userId, role: 'owner' })
    write(DATA_KEY, current)
  },

  // An invited club is in only once one of its Owners accepts (migration 36). If the club had
  // already asked to join, the invite accepts that request.
  async inviteClub(eventId, clubId) {
    const current = data()
    const event = findEvent(current, eventId)
    if (!isOwnerOf(current, eventId)) throw new Error('Only the event\'s Owner or a site Admin can invite clubs')
    if (!eventOpen(event)) throw new Error('Clubs can be invited once the event is Active')
    const existing = current.eventClubs.find((ec) => ec.event_id === eventId && ec.club_id === clubId)
    if (existing?.status === 'accepted') throw new Error('That club is already in this event')
    if (existing?.status === 'invited') return
    if (existing?.status === 'requested') {
      existing.status = 'accepted'
      resolveNotes(current, `join:${eventId}:${clubId}`)
      notify(current, clubPeopleIds(current, clubId, true), 'join_answer', `${clubName(current, clubId)} is in ${event.name}`, {
        body: 'You can now enter athletes.', eventId, clubId, tab: 'clubs',
      })
    } else {
      if (existing) Object.assign(existing, { status: 'invited', requested_at: now() })
      else current.eventClubs.push({ event_id: eventId, club_id: clubId, status: 'invited', requested_at: now() })
      notify(current, clubPeopleIds(current, clubId), 'club_invite', `${clubName(current, clubId)} is invited to ${event.name}`, {
        body: 'Accept to enter athletes. Only the athletes you enter take part.', eventId, clubId, tab: 'clubs', key: `club-invite:${eventId}:${clubId}`,
      })
    }
    write(DATA_KEY, current)
  },

  // A club Owner (or a site Admin) accepts or declines their club's invitation.
  async answerClubInvite(eventId, clubId, accept) {
    const current = data()
    const event = findEvent(current, eventId)
    if (!isSiteAdmin() && clubRole(current, clubId) !== 'owner') throw new Error('Only the club\'s Owners can answer its invitation')
    if (accept && !eventOpen(event)) throw new Error('This event is no longer taking clubs')
    const invite = current.eventClubs.find((ec) => ec.event_id === eventId && ec.club_id === clubId && ec.status === 'invited')
    if (!invite) throw new Error('That invitation is no longer waiting')
    invite.status = accept ? 'accepted' : 'declined'
    resolveNotes(current, `club-invite:${eventId}:${clubId}`)
    notify(current, eventOwnerIds(current, eventId), 'club_invite_answer',
      `${clubName(current, clubId)} ${accept ? 'accepted' : 'declined'} the invitation to ${event.name}`, { eventId, clubId, tab: 'clubs' })
    if (accept) {
      notify(current, clubPeopleIds(current, clubId, true), 'join_answer', `${clubName(current, clubId)} is in ${event.name}`, {
        body: 'You can now enter athletes.', eventId, clubId, tab: 'clubs',
      })
    }
    write(DATA_KEY, current)
  },

  async requestToJoin(eventId, clubId) {
    const current = data()
    const event = findEvent(current, eventId)
    if (!isSiteAdmin() && clubRole(current, clubId) !== 'owner') throw new Error('Only the club\'s Owners can ask to join for it')
    if (!eventOpen(event)) throw new Error('Clubs can join once the event is Active')
    const existing = current.eventClubs.find((ec) => ec.event_id === eventId && ec.club_id === clubId)
    if (existing?.status === 'accepted') throw new Error('That club is already in this event')
    if (existing?.status === 'requested') return
    if (existing?.status === 'invited') return mockApi.answerClubInvite(eventId, clubId, true)
    if (existing) Object.assign(existing, { status: 'requested', requested_at: now() })
    else current.eventClubs.push({ event_id: eventId, club_id: clubId, status: 'requested', requested_at: now() })
    notify(current, eventOwnerIds(current, eventId), 'join_request', `${clubName(current, clubId)} asked to join ${event.name}`, {
      eventId, clubId, tab: 'clubs', key: `join:${eventId}:${clubId}`,
    })
    write(DATA_KEY, current)
  },

  async decideJoinRequest(eventId, clubId, accept) {
    const current = data()
    if (!isOwnerOf(current, eventId)) throw new Error('Only the event\'s Owner or a site Admin can answer join requests')
    const request = current.eventClubs.find((ec) => ec.event_id === eventId && ec.club_id === clubId && ec.status === 'requested')
    if (!request) throw new Error('That request is no longer waiting')
    request.status = accept ? 'accepted' : 'declined'
    resolveNotes(current, `join:${eventId}:${clubId}`)
    notify(current, clubPeopleIds(current, clubId, true), 'join_answer',
      `${clubName(current, clubId)}${accept ? ' is in ' : ' was declined by '}${eventName(current, eventId)}`, {
        body: accept ? 'You can now enter athletes.' : null, eventId, clubId, tab: 'clubs',
      })
    write(DATA_KEY, current)
  },

  // The event's Owner (or a site Admin) creates a club that joins the event straight away.
  async createEventClub(eventId, name, ownerIds) {
    const current = data()
    requireClubManager(current, eventId, 'add clubs')
    if (!name?.trim()) throw new Error('Give the club a name')
    if (!ownerIds?.length) throw new Error('Choose at least one club owner')
    if (current.clubs.some((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())) throw new Error('There is already a club with that name. Invite it instead.')
    const club = { id: crypto.randomUUID(), name: name.trim() }
    current.clubs.push(club)
    ownerIds.forEach((userId) => putClubOwner(current, club.id, userId))
    current.eventClubs.push({ event_id: eventId, club_id: club.id, status: 'accepted', requested_at: now() })
    write(DATA_KEY, current)
    return club.id
  },

  async addEventClubOwner(eventId, clubId, userId) {
    const current = data()
    requireClubManager(current, eventId, 'add club owners')
    requireClubInEvent(current, eventId, clubId)
    putClubOwner(current, clubId, userId)
    write(DATA_KEY, current)
  },

  async removeEventClubOwner(eventId, clubId, userId) {
    const current = data()
    requireClubManager(current, eventId, 'remove club owners')
    requireClubInEvent(current, eventId, clubId)
    if (!current.clubMembers.some((m) => m.club_id === clubId && m.role === 'owner' && m.status === 'active' && m.user_id !== userId)) {
      throw new Error('A club needs at least one owner. Add another owner first.')
    }
    current.clubMembers = current.clubMembers.filter((m) => !(m.club_id === clubId && m.user_id === userId && m.role === 'owner'))
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
    resolveNotes(current, `join:${eventId}:${clubId}`)
    resolveNotes(current, `club-invite:${eventId}:${clubId}`)
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
    const request = {
      id: crypto.randomUUID(), event_id: eventId, athlete_id: athleteId, club_id: clubId, note: note?.trim() || null,
      status: 'pending', requested_by: currentUserId(), requested_at: now(),
    }
    current.lateEntries.push(request)
    notify(current, eventOwnerIds(current, eventId), 'late_entry', `Late entry: ${athleteName(current, athleteId)} for ${event.name}`, {
      body: `${clubName(current, clubId) ?? ''}${request.note ? `: "${request.note}"` : ''}`, eventId, clubId, tab: 'clubs', key: `late:${request.id}`,
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
    resolveNotes(current, `late:${request.id}`)
    notify(current, [request.requested_by, ...clubPeopleIds(current, request.club_id)], 'late_entry_answer',
      `Late entry ${request.status}: ${athleteName(current, request.athlete_id)}`, {
        body: eventName(current, request.event_id), eventId: request.event_id, clubId: request.club_id, tab: 'clubs',
      })
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
    resolveNotes(current, `late:${request.id}`)
    write(DATA_KEY, current)
  },

  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------

  async listNotifications() {
    const userId = currentUserId()
    return (data().notifications ?? [])
      .filter((n) => n.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 200)
  },

  // ids: the notifications to mark read, or null for all of them.
  async markNotificationsRead(ids) {
    const current = data()
    const userId = currentUserId()
    for (const n of current.notifications ?? []) {
      if (n.user_id === userId && !n.read_at && (!ids || ids.includes(n.id))) n.read_at = now()
    }
    write(DATA_KEY, current)
  },

  async markNotificationUnread(id) {
    const current = data()
    const note = (current.notifications ?? []).find((n) => n.id === id && n.user_id === currentUserId())
    if (note) note.read_at = null
    write(DATA_KEY, current)
  },

  async deleteNotifications(ids) {
    const current = data()
    const userId = currentUserId()
    current.notifications = (current.notifications ?? []).filter((n) => !(n.user_id === userId && ids.includes(n.id)))
    write(DATA_KEY, current)
  },

  // Calls back whenever the demo data changes. Returns a function that stops it.
  subscribeNotifications(userId, callback) {
    noteListeners.add(callback)
    return () => noteListeners.delete(callback)
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
        bout_officials: (b.bout_officials ?? []).map((o) => ({ ...o, user: findUser(current, o.user_id) })),
      }))
    return {
      officials, bouts, weighIns: current.weighIns.filter((w) => w.event_id === eventId), acceptedDays: myDays(current, eventId),
      myRoles: myEventRoles(current, eventId),
    }
  },

  async setEventOfficial(eventId, role, userId) {
    const current = data()
    if (role === 'chief') {
      requireSiteAdmin('Only a site Admin can choose the first Chief Official')
    } else {
      if (!canInviteOfficials(current, eventId)) throw new Error('Only a site Admin or a Chief Official of this event can choose the second Chief Official')
      if (!isSiteAdmin() && !eventOpen(findEvent(current, eventId))) throw new Error('Chief Officials can be changed while the event is Active')
    }
    if (userId && !userAccepted(current, eventId, userId)) throw new Error('Pick an official who has accepted the invitation to this event')
    current.eventOfficials = current.eventOfficials.filter((o) => !(o.event_id === eventId && o.role === role))
    if (userId) {
      if (current.eventOfficials.some((o) => o.event_id === eventId && o.user_id === userId)) {
        throw new Error('The two Chief Officials must be different people')
      }
      current.eventOfficials.push({ event_id: eventId, role, user_id: userId })
    }
    write(DATA_KEY, current)
  },

  // Official invitations: the same rules as the database functions in migrations 14 and 21.
  async listInvitableOfficials(eventId) {
    const current = data()
    if (!canAddOfficials(current, eventId)) throw new Error('Only a site Admin or an official on this event can invite officials')
    return current.officials
      .filter((o) => o.invite_email)
      .map((o) => ({ id: o.id, name: o.name, email: o.invite_email, signed_in: Boolean(o.user_id) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  async listEventInvitations(eventId) {
    const current = data()
    if (!isOwnerOf(current, eventId) && !officialRole(current, eventId) && !acceptedOfficial(current, eventId)) return []
    return current.officialInvitations
      .filter((i) => i.event_id === eventId)
      .map((i) => {
        const o = current.officials.find((x) => x.id === i.official_id)
        return { ...i, name: o?.name ?? '—', email: o?.invite_email ?? null, user_id: o?.user_id ?? null }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  async acceptedOfficialCounts(eventIds) {
    const current = data()
    return Object.fromEntries(eventIds.map((id) => [
      id,
      isOwnerOf(current, id) || officialRole(current, id) || acceptedOfficial(current, id)
        ? (current.officialInvitations ?? []).filter((i) => i.event_id === id && i.status === 'accepted').length
        : 0,
    ]))
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

  // Mirrors add_event_official: puts someone new on the Officials list (inviting the email as an
  // Official, or linking their account) and invites them to the event.
  async addEventOfficial(eventId, name, email, respondBy) {
    const current = data()
    if (!canAddOfficials(current, eventId)) throw new Error('Only a site Admin or an official on this event can invite officials')
    const clean = (email ?? '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('That email address doesn\'t look right')
    if (!name?.trim()) throw new Error('Give the official\'s name')
    const user = current.users.find((u) => u.email === clean)
    const newAccount = !user && clean !== adminUser.email.toLowerCase()
    let official = current.officials.find((o) => o.invite_email === clean || (user?.id && o.user_id === user.id))
    if (!official) {
      official = { id: crypto.randomUUID(), name: name.trim(), invite_email: clean, qualifications: null, user_id: user?.id ?? null }
      current.officials.push(official)
    }
    if (newAccount) current.users.push({ id: null, email: clean, name: name.trim(), role_id: 'member', state: 'Invited' })
    write(DATA_KEY, current)
    const [invitationId] = await mockApi.inviteOfficials(eventId, [official.id], respondBy)
    if (!invitationId) throw new Error('That official has already accepted this event')
    return { invitation_id: invitationId, official_id: official.id, new_account: newAccount }
  },

  async inviteOfficials(eventId, officialIds, respondBy) {
    const current = data()
    const event = findEvent(current, eventId)
    if (!canAddOfficials(current, eventId)) throw new Error('Only a site Admin or an official on this event can invite officials')
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
      resolveNotes(current, `invitation:${invite.id}`)
      notify(current, [current.officials.find((o) => o.id === officialId)?.user_id], 'availability', `Are you available for ${event.name}?`, {
        body: `${label(event.start_date)}${event.end_date > event.start_date ? ` to ${label(event.end_date)}` : ''}${event.venue ? ` · ${event.venue}` : ''}${respondBy ? `. Please answer by ${label(respondBy)}` : ''}`,
        eventId, tab: 'officials', key: `invitation:${invite.id}`,
      })
    }
    write(DATA_KEY, current)
    return sent
  },

  // roles: { judge, referee, supervisor, timekeeper }; accepting needs at least one (migration 42).
  async respondToInvitation(invitationId, accept, days, sessions, roles) {
    const current = data()
    const invite = current.officialInvitations.find((i) => i.id === invitationId)
    if (!invite) throw new Error('That invitation has been cancelled')
    const official = current.officials.find((o) => o.id === invite.official_id)
    if (!official?.user_id || official.user_id !== currentUserId()) throw new Error('Only the invited official can answer this invitation')
    const event = findEvent(current, invite.event_id)
    const today = todayIso(event.timezone)
    if (event.status !== 'active' || today >= event.start_date) throw new Error('Answers are locked once the event starts. Contact the event\'s Owner.')
    if (invite.status === 'pending' && invite.respond_by && today > invite.respond_by) {
      throw new Error('The respond-by date has passed. Ask a site Admin or one of the event\'s officials to invite you again.')
    }
    let chosen = null
    let parts = null
    if (accept) {
      if (!eventRoles.some((r) => roles?.[r.key])) throw new Error('Pick at least one role: Judge, Referee, Supervisor or Timekeeper')
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
    for (const r of eventRoles) invite[r.key] = Boolean(accept && roles?.[r.key])
    invite.responded_at = now()
    if (!accept) {
      current.eventOfficials = current.eventOfficials.filter((o) => !(o.event_id === event.id && o.user_id === official.user_id))
      for (const b of current.bouts) {
        if (b.event_id === event.id) b.bout_officials = (b.bout_officials ?? []).filter((o) => o.user_id !== official.user_id)
      }
    }
    resolveNotes(current, `invitation:${invite.id}`)
    notify(current, eventOwnerIds(current, event.id), 'invitation_answer', `${official.name} ${invite.status} ${event.name}`, {
      body: accept ? `Roles: ${rolesText(invite)} · Days: ${chosen.map(label).join(', ')}` : null, eventId: event.id, tab: 'officials',
    })
    write(DATA_KEY, current)
  },

  async cancelInvitation(invitationId) {
    const current = data()
    const invite = current.officialInvitations.find((i) => i.id === invitationId)
    if (!invite) return
    if (!canInviteOfficials(current, invite.event_id)) throw new Error('Only a site Admin or the event\'s Chief Official can remove officials')
    const userId = current.officials.find((o) => o.id === invite.official_id)?.user_id
    if (userId === currentUserId() && !isSiteAdmin()) throw new Error('Ask a site Admin to take you off this event')
    current.officialInvitations = current.officialInvitations.filter((i) => i.id !== invitationId)
    resolveNotes(current, `invitation:${invitationId}`)
    if (userId) current.eventOfficials = current.eventOfficials.filter((o) => !(o.event_id === invite.event_id && o.user_id === userId))
    write(DATA_KEY, current)
  },

  async emailOfficialInvitation() {
    throw new Error('Demo mode doesn\'t send email')
  },

  async saveBout({ id, eventId, day, redId, blueId, needsSupervisor, warnings, boutType = 'scored', blocks = [], overrideReason = null }) {
    const current = data()
    const event = findEvent(current, eventId)
    const old = id ? findBout(current, id) : null
    if (old?.winner) throw new Error('This bout has a result, so it can\'t be re-matched')
    if ((old && !canMatch(current, eventId, old.day)) || !canMatch(current, eventId, day)) {
      throw new Error(roleOn(current, eventId) === 'owner'
        ? 'The weigh-in for that day has started, so only a Chief Official can make bouts'
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
    if (!['scored', 'developmental', 'sparring'].includes(boutType)) throw new Error('Pick Scored, Developmental or Sparring')
    let reason = overrideReason?.trim() || null
    if (blocks.length) {
      if (boutType === 'scored') throw new Error('A Scored bout must follow every match rule')
      if (boutType === 'sparring') throw new Error('A Sparring bout must follow the match rules')
      if (!isOfficial(current, eventId)) throw new Error('Only a Chief Official can override the match rules')
      if (!reason) throw new Error('Give a reason for overriding the match rules')
    } else {
      reason = null
    }
    const nextPosition = Math.max(0, ...current.bouts.filter((b) => b.event_id === eventId && b.day === day).map((b) => b.position)) + 1
    const fields = {
      bout_type: boutType, override_blocks: reason ? blocks : [], override_reason: reason,
      override_by: reason ? currentUserId() : null, override_at: reason ? now() : null,
      red_athlete_id: redId, blue_athlete_id: blueId, red_club_id: red.club_id, blue_club_id: blue.club_id,
      needs_supervisor: Boolean(needsSupervisor), warnings: warnings ?? [], after_weigh_in: weighInStarted(current, eventId, day),
      status: boutType === 'sparring' ? 'approved' : 'pending', cancel_reason: null, cancelled_at: null, made_by: currentUserId(), made_at: now(), approvals: [],
      approval_requested_at: null, approval_requested_by: null,
    }
    let bout = old
    if (bout) resolveNotes(current, `bout:${bout.id}:%`)
    // Re-matched to a different boxer: the "needs discussion" flag goes (migration 34).
    if (bout && ![[redId, blueId], [blueId, redId]].some(([r, b]) => r === bout.red_athlete_id && b === bout.blue_athlete_id)) {
      Object.assign(bout, { review_reason: null, review_at: null })
      resolveNotes(current, `review:${bout.id}`)
    }
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

  // Mirrors request_bout_approvals (migration 26): only the Chief Official and Deputy are told.
  async requestBoutApprovals(boutIds) {
    const current = data()
    const bouts = boutIds.map((id) => findBout(current, id))
    for (const eventId of new Set(bouts.map((b) => b.event_id))) {
      if (!isOwnerOf(current, eventId) && !isOfficial(current, eventId)) {
        throw new Error('Only the event\'s Owner, a Chief Official or a site Admin can send bouts for approval')
      }
      if (!cardOpen(findEvent(current, eventId))) throw new Error('Bouts can be sent for approval only while the event is Active')
    }
    const rows = []
    for (const b of bouts.filter((x) => x.status === 'pending' && !x.winner)) {
      b.approval_requested_at = now()
      b.approval_requested_by = currentUserId()
      const event = findEvent(current, b.event_id)
      const live = current.bouts.filter((x) => x.event_id === b.event_id && x.day === b.day && x.status !== 'cancelled')
        .sort((x, y) => x.position - y.position)
      const name = (id) => current.athletes.find((a) => a.id === id)?.name ?? null
      const base = {
        bout_id: b.id, event_name: event.name, venue: event.venue, day: b.day, bout_number: live.findIndex((x) => x.id === b.id) + 1,
        red_name: name(b.red_athlete_id), red_club: clubName(current, b.red_club_id),
        blue_name: name(b.blue_athlete_id), blue_club: clubName(current, b.blue_club_id),
      }
      const key = `bout:${b.id}:official`
      const people = current.eventOfficials.filter((o) => o.event_id === b.event_id).map((o) => findUser(current, o.user_id))
      for (const u of people.filter((x) => x?.email)) rows.push({ ...base, side: 'official', recipient_name: u.name, recipient_email: u.email })
      // Sending again replaces the open to-do rather than adding a second one.
      current.notifications = (current.notifications ?? []).filter((n) => !(n.action_key === key && !n.done_at))
      notify(current, people.map((u) => u?.id), 'bout_approval', `Approve bout: ${boutLabel(current, b)}`, {
        body: boutWhere(current, b), eventId: b.event_id, boutId: b.id, tab: 'bouts', key,
      })
    }
    write(DATA_KEY, current)
    return rows
  },

  async emailBoutApprovals() {
    throw new Error('Demo mode doesn\'t send email')
  },

  async decideBout(boutId, side, approve, note) {
    const current = data()
    const bout = findBout(current, boutId)
    if (bout.bout_type === 'sparring') throw new Error('Sparring bouts don\'t need approval')
    if (bout.status === 'cancelled' || bout.winner) throw new Error('This bout can no longer be approved or rejected')
    if (!cardOpen(findEvent(current, bout.event_id))) throw new Error('The event isn\'t Active')
    // Only a Chief Official (or a site Admin) decides (migration 26).
    if ((side ?? 'official') !== 'official' || !isOfficial(current, bout.event_id)) {
      throw new Error('Only a Chief Official can approve or reject bouts')
    }
    side = 'official'
    const override = false
    bout.approvals = bout.approvals.filter((a) => a.side !== side)
    const before = bout.status
    bout.approvals.push({ side, decision: approve ? 'approved' : 'rejected', note: note?.trim() || null, override, decided_by: currentUserId(), decided_at: now() })
    refreshBoutStatus(bout)
    resolveNotes(current, `bout:${bout.id}:${side}`)
    if (bout.status !== 'pending') resolveNotes(current, `bout:${bout.id}:%`)
    if (!approve) {
      const who = 'The officials'
      notify(current, [...eventOwnerIds(current, bout.event_id), ...eventOfficialIds(current, bout.event_id),
        ...clubPeopleIds(current, bout.red_club_id), ...clubPeopleIds(current, bout.blue_club_id)],
      'bout_decision', `${who} rejected ${boutLabel(current, bout)}`, {
        body: `${boutWhere(current, bout)}${note?.trim() ? `: "${note.trim()}"` : ''}`, eventId: bout.event_id, boutId: bout.id, tab: 'bouts',
      })
    } else if (bout.status === 'approved' && before !== 'approved') {
      notify(current, [...clubPeopleIds(current, bout.red_club_id, true), ...clubPeopleIds(current, bout.blue_club_id, true), ...eventOwnerIds(current, bout.event_id)],
        'bout_decision', `Bout approved: ${boutLabel(current, bout)}`, { body: boutWhere(current, bout), eventId: bout.event_id, boutId: bout.id, tab: 'bouts' })
    }
    write(DATA_KEY, current)
  },

  // Mirrors migrations 41 and 42: the CO or Deputy, or an official who accepted the bout's day, takes
  // the bout. roles: { judge, referee, supervisor, timekeeper }, each one of their event roles.
  async acceptBout(boutId, roles) {
    const current = data()
    const bout = findBout(current, boutId)
    const picked = eventRoles.filter((r) => roles?.[r.key]).map((r) => r.key)
    if (picked.length === 0) throw new Error('Pick at least one role for this bout')
    if (!officialRole(current, bout.event_id) && !myDays(current, bout.event_id).includes(bout.day)) throw new Error('Only officials working this day can accept the bout')
    const mine = myEventRoles(current, bout.event_id)
    if (picked.some((k) => !mine[k])) throw new Error('You can only take roles you chose when you accepted the event')
    if (!cardOpen(findEvent(current, bout.event_id))) throw new Error('Bouts can be accepted only while the event is Active')
    if (bout.status === 'cancelled') throw new Error('This bout is cancelled')
    if (bout.winner) throw new Error('This bout already has a result')
    const me = currentUserId()
    bout.bout_officials = [...(bout.bout_officials ?? []).filter((o) => o.user_id !== me), { user_id: me, ...rolesFlags(picked), accepted_at: now() }]
    write(DATA_KEY, current)
  },

  async withdrawFromBout(boutId, userId) {
    const current = data()
    const bout = findBout(current, boutId)
    const who = userId || currentUserId()
    if (who !== currentUserId() && !isOwnerOf(current, bout.event_id) && !isOfficial(current, bout.event_id)) {
      throw new Error('Only the event\'s Owner or a Chief Official can take another official off a bout')
    }
    if (bout.winner && !isSiteAdmin()) throw new Error('This bout already has a result')
    bout.bout_officials = (bout.bout_officials ?? []).filter((o) => o.user_id !== who)
    write(DATA_KEY, current)
  },

  async swapBoutCorners(boutId) {
    const current = data()
    const bout = findBout(current, boutId)
    if (!canMatch(current, bout.event_id, bout.day)) throw new Error('Only the event\'s Owner (before the weigh-in) or officials can change bouts')
    if (bout.winner) throw new Error('This bout has a result, so its corners can\'t be swapped')
    if (bout.status === 'cancelled') throw new Error('This bout is cancelled')
    Object.assign(bout, {
      red_athlete_id: bout.blue_athlete_id, blue_athlete_id: bout.red_athlete_id,
      red_club_id: bout.blue_club_id, blue_club_id: bout.red_club_id,
    })
    write(DATA_KEY, current)
  },

  async cancelBout(boutId, reason) {
    const current = data()
    const bout = findBout(current, boutId)
    if (!canMatch(current, bout.event_id, bout.day)) throw new Error('Only the event\'s Owner (before the weigh-in) or officials can cancel bouts')
    if (bout.review_reason && !isOfficial(current, bout.event_id)) throw new Error('Only a Chief Official cancels a bout that needs discussing')
    if (bout.winner) throw new Error('This bout has a result, so it can\'t be cancelled')
    Object.assign(bout, { status: 'cancelled', cancel_reason: reason?.trim() || null, cancelled_at: now() })
    resolveNotes(current, `bout:${bout.id}:%`)
    resolveNotes(current, `review:${bout.id}`)
    notify(current, boutPeople(current, bout), 'bout_cancelled', `Bout cancelled: ${boutLabel(current, bout)}`, {
      body: `${boutWhere(current, bout)}${bout.cancel_reason ? ` · ${bout.cancel_reason}` : ''}`, eventId: bout.event_id, boutId: bout.id, tab: 'bouts',
    })
    write(DATA_KEY, current)
  },

  async setCardOrder(eventId, day, order) {
    const current = data()
    // Mirrors migration 29: the Owner or a Chief Official; every bout that day is renumbered,
    // the ones sent first in the order sent, then the rest in their old order.
    if (!isOwnerOf(current, eventId) && !isOfficial(current, eventId)) throw new Error('Only the event\'s Owner or a Chief Official sets the order of the card')
    if (!cardOpen(findEvent(current, eventId))) throw new Error('The card can change only while the event is Active')
    const sent = new Map()
    order.forEach(({ id, session }) => { if (!sent.has(id)) sent.set(id, { n: sent.size, session: session || null }) })
    const dayBouts = current.bouts.filter((b) => b.event_id === eventId && b.day === day)
    dayBouts
      .sort((x, y) => (sent.get(x.id)?.n ?? Infinity) - (sent.get(y.id)?.n ?? Infinity) || x.position - y.position)
      .forEach((bout, i) => {
        bout.position = i + 1
        if (sent.has(bout.id)) bout.session_starts_at = sent.get(bout.id).session
      })
    write(DATA_KEY, current)
  },

  async addBoutComment(boutId, body) {
    const current = data()
    const bout = findBout(current, boutId)
    if (!isInBout(current, bout)) throw new Error('Only people involved in this bout can comment on it')
    if (!body?.trim()) throw new Error('Write a comment first')
    bout.comments.push({ id: crypto.randomUUID(), body: body.trim(), created_at: now(), author_id: currentUserId() })
    notify(current, boutPeople(current, bout), 'bout_comment', `${personName(current, currentUserId())} commented on ${boutLabel(current, bout)}`, {
      body: `"${body.trim()}"`, eventId: bout.event_id, boutId: bout.id, tab: 'bouts',
    })
    write(DATA_KEY, current)
  },

  async flagBoutForReview(boutId, reason) {
    const current = data()
    const bout = findBout(current, boutId)
    if (!isOfficial(current, bout.event_id) && !myDays(current, bout.event_id).includes(bout.day)) throw new Error('Only the event\'s officials flag bouts at the weigh-in')
    if (!reason?.trim()) throw new Error('Say why this bout needs discussing')
    flagBout(current, bout, reason.trim().slice(0, 300))
    write(DATA_KEY, current)
  },

  async clearBoutReview(boutId) {
    const current = data()
    const bout = findBout(current, boutId)
    if (!isOfficial(current, bout.event_id)) throw new Error('Only a Chief Official decides on a bout that needs discussing')
    Object.assign(bout, { review_reason: null, review_at: null })
    resolveNotes(current, `review:${bout.id}`)
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
    // A failed medical or a no-show flags the bouts for the officials to discuss; it doesn't cancel them (migration 34).
    const name = athleteName(current, athleteId) ?? 'A boxer'
    if (medical === 'fail') flagAthleteBouts(current, eventId, athleteId, day, `${name} failed the medical.`)
    if (medical === 'absent') flagAthleteBouts(current, eventId, athleteId, day, `${name} didn't come to the weigh-in.`)
    write(DATA_KEY, current)
  },

  async recordResult(boutId, winner, method, note) {
    const current = data()
    const bout = findBout(current, boutId)
    if (!isOfficial(current, bout.event_id)) throw new Error('Only a Chief Official records results')
    if (bout.status !== 'approved') throw new Error('Only approved bouts get a result')
    if (bout.review_reason) throw new Error('This bout needs discussing first: keep it or cancel it')
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
    if (!isOfficial(current, bout.event_id)) throw new Error('Only a Chief Official changes results')
    if (!bout.winner) return
    for (const a of current.athletes) if ([bout.red_athlete_id, bout.blue_athlete_id].includes(a.id)) a.bouts = Math.max((a.bouts ?? 0) - 1, 0)
    Object.assign(bout, { winner: null, method: null, result_note: null, result_by: null, result_at: null })
    write(DATA_KEY, current)
  },
}
