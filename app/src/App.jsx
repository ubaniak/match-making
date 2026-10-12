import { useState } from 'react'
import { isConfigured, supabase } from './supabase'
import { useAuth } from './auth'
import AdminPage from './AdminPage'

export default function App() {
  if (!isConfigured) {
    return (
      <main className="card">
        <h1>Match Making</h1>
        <p className="error">
          Sign-in isn't set up yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
        </p>
      </main>
    )
  }

  return <SignedInApp />
}

function SignedInApp() {
  const { session, profile, can, loading } = useAuth()

  if (loading) {
    return <main className="card"><p>Loading…</p></main>
  }

  if (!session) return <Login />

  return (
    <div className="page">
      <header className="topbar">
        <strong>Match Making</strong>
        <span className="who">
          {profile?.name || session.user.email}
          {profile && <span className="badge">{profile.roles?.name}</span>}
        </span>
        <button className="secondary" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      {can('users:manage') ? <AdminPage /> : <Hello profile={profile} email={session.user.email} />}
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
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      // Come back to whatever URL the app is served from (local dev or GitHub Pages).
      options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    })
    setSending(false)
    if (error) setError(error.message)
    else setSentTo(email.trim())
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
