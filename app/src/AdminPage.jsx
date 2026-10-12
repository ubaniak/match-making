import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export default function AdminPage() {
  const [tab, setTab] = useState('coaches')

  return (
    <main className="panel">
      <h1>Admin</h1>
      <nav className="tabs">
        <button className={tab === 'coaches' ? 'tab active' : 'tab'} onClick={() => setTab('coaches')}>Coaches</button>
        <button className={tab === 'athletes' ? 'tab active' : 'tab'} onClick={() => setTab('athletes')}>Athletes</button>
      </nav>
      {tab === 'coaches' ? <Coaches /> : <Athletes />}
    </main>
  )
}

// Coaches who have signed in, plus invites waiting for a first sign-in.
function useCoaches() {
  const [coaches, setCoaches] = useState([])
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    const [profiles, invites] = await Promise.all([
      supabase.from('profiles').select('id, email, name, status').eq('role_id', 'coach').order('name'),
      supabase.from('invites').select('email, name').eq('role_id', 'coach').order('name'),
    ])
    const failed = profiles.error || invites.error
    if (failed) return setError(failed.message)
    setError(null)
    setCoaches([
      ...profiles.data.map((p) => ({ ...p, state: p.status === 'active' ? 'Active' : 'Disabled' })),
      ...invites.data.map((i) => ({ ...i, id: null, state: 'Invited' })),
    ])
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { coaches, error, reload }
}

function Coaches() {
  const { coaches, error, reload } = useCoaches()
  const [form, setForm] = useState({ name: '', email: '' })
  const [message, setMessage] = useState(null)
  const [saving, setSaving] = useState(false)

  async function addCoach(event) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    const { data, error } = await supabase.rpc('invite_user', {
      p_email: form.email,
      p_name: form.name,
      p_role: 'coach',
    })
    setSaving(false)
    if (error) return setMessage({ error: true, text: error.message })
    setMessage({
      text: data === 'updated'
        ? `${form.email} already had an account and is now a coach.`
        : `${form.email} is added. They become a coach when they first sign in with that email.`,
    })
    setForm({ name: '', email: '' })
    reload()
  }

  return (
    <section>
      <form onSubmit={addCoach} className="row-form">
        <h2>Add a coach</h2>
        <label>
          Name
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          Email
          <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add coach'}</button>
      </form>
      {message && <p className={message.error ? 'error' : 'success'}>{message.text}</p>}

      <h2>Coaches</h2>
      {error && <p className="error">{error}</p>}
      {coaches.length === 0 ? (
        <p className="muted">No coaches yet.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Status</th></tr>
          </thead>
          <tbody>
            {coaches.map((c) => (
              <tr key={c.email}>
                <td>{c.name || '—'}</td>
                <td>{c.email}</td>
                <td><span className={`badge ${c.state.toLowerCase()}`}>{c.state}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

const emptyAthlete = { name: '', email: '', coachId: '', dateOfBirth: '', weightClass: '', club: '' }

function Athletes() {
  const { coaches } = useCoaches()
  const [athletes, setAthletes] = useState([])
  const [error, setError] = useState(null)
  const [form, setForm] = useState(emptyAthlete)
  const [message, setMessage] = useState(null)
  const [saving, setSaving] = useState(false)

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('athletes')
      .select('id, name, date_of_birth, weight_class, club, invite_email, user_id, coach:profiles!athletes_coach_id_fkey(name, email)')
      .order('name')
    if (error) return setError(error.message)
    setError(null)
    setAthletes(data)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function addAthlete(event) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    const { error } = await supabase.from('athletes').insert({
      name: form.name.trim(),
      invite_email: form.email.trim().toLowerCase() || null,
      coach_id: form.coachId || null,
      date_of_birth: form.dateOfBirth || null,
      weight_class: form.weightClass.trim() || null,
      club: form.club.trim() || null,
    })
    setSaving(false)
    if (error) return setMessage({ error: true, text: error.message })
    setMessage({
      text: form.email
        ? `${form.name} is added. They can sign in with ${form.email} to see their profile.`
        : `${form.name} is added.`,
    })
    setForm(emptyAthlete)
    reload()
  }

  const field = (key) => ({ value: form[key], onChange: (e) => setForm({ ...form, [key]: e.target.value }) })
  const activeCoaches = coaches.filter((c) => c.id && c.state === 'Active')

  return (
    <section>
      <form onSubmit={addAthlete} className="row-form">
        <h2>Add an athlete</h2>
        <label>Name<input required {...field('name')} /></label>
        <label>Email <span className="muted">(optional, lets them sign in)</span><input type="email" {...field('email')} /></label>
        <label>
          Coach
          <select {...field('coachId')}>
            <option value="">No coach</option>
            {activeCoaches.map((c) => (
              <option key={c.id} value={c.id}>{c.name || c.email}</option>
            ))}
          </select>
        </label>
        <label>Date of birth<input type="date" {...field('dateOfBirth')} /></label>
        <label>Weight class<input {...field('weightClass')} /></label>
        <label>Club<input {...field('club')} /></label>
        <button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add athlete'}</button>
      </form>
      {message && <p className={message.error ? 'error' : 'success'}>{message.text}</p>}
      {coaches.some((c) => !c.id) && (
        <p className="muted">Invited coaches appear in the coach list once they've signed in.</p>
      )}

      <h2>Athletes</h2>
      {error && <p className="error">{error}</p>}
      {athletes.length === 0 ? (
        <p className="muted">No athletes yet.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Name</th><th>Coach</th><th>Weight class</th><th>Club</th><th>Login</th></tr>
          </thead>
          <tbody>
            {athletes.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{a.coach ? a.coach.name || a.coach.email : '—'}</td>
                <td>{a.weight_class || '—'}</td>
                <td>{a.club || '—'}</td>
                <td>
                  {a.user_id ? (
                    <span className="badge active">{a.invite_email || 'Linked'}</span>
                  ) : a.invite_email ? (
                    <span className="badge invited">{a.invite_email}</span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
