// A stand-in for Supabase so the app can be tried before a project exists.
// Only one special user can sign in, and everything is kept in this browser's storage.
// The password ships inside the page's JavaScript, so this is for demos, not for protecting anything.

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
}

const allPermissions = [
  'public:read', 'pages:read', 'cards:read', 'cards:create', 'cards:manage', 'cards:submit-official',
  'cards:submit-athlete', 'athletes:read', 'athletes:create', 'athletes:write', 'officials:read',
  'officials:write', 'files:upload', 'users:manage', 'roles:manage', 'audit:read',
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
  return read(DATA_KEY) ?? structuredClone(seed)
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

  async loadMe() {
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

  resetDemoData() {
    write(DATA_KEY, null)
  },
}
