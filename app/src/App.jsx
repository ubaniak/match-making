import { useEffect, useState } from 'react'
import { api } from './api'
import { useAuth } from './auth'
import AdminPage from './AdminPage'
import EventsPage from './EventsPage'
import PublicEvents from './PublicEvents'

export default function App() {
  const { session, profile, can, loading } = useAuth()
  const [page, setPage] = useState('events')
  const hash = useHash()

  // The public page needs no sign-in.
  if (hash === '#upcoming') return <PublicEvents signedIn={Boolean(session)} />

  if (loading) {
    return <main className="card"><p>Loading…</p></main>
  }

  if (!session) return api.mode === 'mock' ? <MockLogin /> : <Login />

  const pages = [
    can('pages:read') && ['events', 'Events'],
    can('users:manage') && ['admin', 'Admin'],
  ].filter(Boolean)
  const current = pages.find(([key]) => key === page)?.[0] ?? pages[0]?.[0]

  return (
    <div className="page">
      {api.mode === 'mock' && <DemoBanner userId={session.user.id} />}
      <header className="topbar">
        <strong>Match Making</strong>
        {pages.length > 1 && (
          <nav className="nav">
            {pages.map(([key, label]) => (
              <button key={key} className={current === key ? 'tab active' : 'tab'} onClick={() => setPage(key)}>{label}</button>
            ))}
          </nav>
        )}
        <span className="who">
          {profile?.name || session.user.email}
          {profile && <span className="badge">{profile.roles?.name}</span>}
        </span>
        <button className="secondary" onClick={() => api.signOut()}>Sign out</button>
      </header>
      {current === 'events' && <EventsPage key={profile?.id} profile={profile} can={can} />}
      {current === 'admin' && <AdminPage />}
      {!current && <Hello profile={profile} email={session.user.email} />}
    </div>
  )
}

function useHash() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

const publicLink = <p className="muted"><a href="#upcoming">See upcoming events</a></p>

function DemoBanner({ userId }) {
  const [users, setUsers] = useState([])

  useEffect(() => {
    api.listUsers().then((all) => setUsers(all.filter((u) => u.id && u.id !== api.adminId && u.state === 'Active')))
  }, [])

  function reset() {
    api.resetDemoData()
    window.location.reload()
  }

  return (
    <div className="demo-banner">
      Demo mode: sample data, saved only in this browser.
      <label>
        Viewing as{' '}
        <select value={userId} onChange={(e) => api.viewAs(e.target.value)}>
          <option value={api.adminId}>Demo Admin</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </label>
      <button className="link" onClick={reset}>Reset sample data</button>
    </div>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState(null)
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)

  async function sendLink(event) {
    event.preventDefault()
    setError(null)
    setSending(true)
    try {
      await api.sendMagicLink(email.trim())
      setSentTo(email.trim())
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  if (sentTo) {
    return (
      <main className="card">
        <h1>Check your email</h1>
        <p>We sent a sign-in link to <strong>{sentTo}</strong>. Open it on this device to sign in.</p>
        <button className="secondary" onClick={() => setSentTo(null)}>Use a different email</button>
      </main>
    )
  }

  return (
    <main className="card">
      <h1>Match Making</h1>
      <form onSubmit={sendLink} className="stack">
        <p>Enter your email and we'll send you a sign-in link.</p>
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button type="submit" disabled={sending}>{sending ? 'Sending…' : 'Email me a sign-in link'}</button>
      </form>
      {error && <p className="error">{error}</p>}
      {publicLink}
    </main>
  )
}

// Demo mode: only the one special account configured for the build can sign in.
function MockLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)

  async function signIn(event) {
    event.preventDefault()
    setError(null)
    try {
      await api.signInWithPassword(email, password)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <main className="card">
      <h1>Match Making</h1>
      <form onSubmit={signIn} className="stack">
        <p>Demo mode. Sign in with the demo admin account.</p>
        <input
          type="email"
          required
          autoComplete="username"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <input
          type="password"
          required
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit">Sign in</button>
      </form>
      {error && <p className="error">{error}</p>}
      {publicLink}
    </main>
  )
}

function Hello({ profile, email }) {
  return (
    <main className="card">
      <h1>Hello world</h1>
      <p>Signed in as {email}</p>
      {profile?.role_id === 'public' && (
        <p className="muted">You don't have a role yet. Ask an Admin to add you as a user.</p>
      )}
    </main>
  )
}
