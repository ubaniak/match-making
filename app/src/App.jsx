import { useEffect, useState } from 'react'
import { isConfigured, supabase } from './supabase'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(isConfigured)

  useEffect(() => {
    if (!isConfigured) return

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => data.subscription.unsubscribe()
  }, [])

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

  if (loading) {
    return <main className="card"><p>Loading…</p></main>
  }

  return session ? <Hello session={session} /> : <Login />
}

function Login() {
  const [error, setError] = useState(null)

  async function signIn(event) {
    event.preventDefault()
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      // Come back to whatever URL the app is served from (local dev or GitHub Pages).
      options: { redirectTo: window.location.origin + import.meta.env.BASE_URL },
    })
    if (error) setError(error.message)
  }

  return (
    <main className="card">
      <h1>Match Making</h1>
      <form onSubmit={signIn}>
        <p>Sign in to continue.</p>
        <button type="submit">Sign in with Google</button>
      </form>
      {error && <p className="error">{error}</p>}
    </main>
  )
}

function Hello({ session }) {
  return (
    <main className="card">
      <h1>Hello world</h1>
      <p>Signed in as {session.user.email}</p>
      <button onClick={() => supabase.auth.signOut()}>Sign out</button>
    </main>
  )
}
