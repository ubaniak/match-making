import { useState } from 'react'
import { api } from './api'
import { useAuth } from './auth'
import AdminPage from './AdminPage'

export default function App() {
  const { session, profile, can, loading } = useAuth()

  if (loading) {
    return <main className="card"><p>Loading…</p></main>
  }

  if (!session) return api.mode === 'mock' ? <MockLogin /> : <Login />

  return (
    <div className="page">
      {api.mode === 'mock' && <DemoBanner />}
      <header className="topbar">
        <strong>Match Making</strong>
        <span className="who">
          {profile?.name || session.user.email}
          {profile && <span className="badge">{profile.roles?.name}</span>}
        </span>
        <button className="secondary" onClick={() => api.signOut()}>Sign out</button>
      </header>
      {can('users:manage') ? <AdminPage /> : <Hello profile={profile} email={session.user.email} />}
    </div>
  )
}

function DemoBanner() {
  function reset() {
    api.resetDemoData()
    window.location.reload()
  }

  return (
    <div className="demo-banner">
      Demo mode: sample data, saved only in this browser.
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
    </main>
  )
}

function Hello({ profile, email }) {
  return (
    <main className="card">
      <h1>Hello world</h1>
      <p>Signed in as {email}</p>
      {profile?.role_id === 'public' && (
        <p className="muted">You don't have a role yet. Ask an Admin to add you as a coach or athlete.</p>
      )}
    </main>
  )
}
