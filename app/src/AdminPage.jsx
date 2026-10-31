import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import CsvImport from './CsvImport'

const tabs = [
  ['coaches', 'Coaches'],
  ['athletes', 'Athletes'],
  ['officials', 'Officials'],
]

export default function AdminPage() {
  const [tab, setTab] = useState('coaches')

  return (
    <main className="panel">
      <h1>Admin</h1>
      <nav className="tabs">
        {tabs.map(([key, label]) => (
          <button key={key} className={tab === key ? 'tab active' : 'tab'} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>
      {tab === 'coaches' && <Coaches />}
      {tab === 'athletes' && <Athletes />}
      {tab === 'officials' && <Officials />}
    </main>
  )
}

// Coaches who have signed in, plus invites waiting for a first sign-in.
function useCoaches() {
  const [coaches, setCoaches] = useState([])
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    try {
      setCoaches(await api.listCoaches())
      setError(null)
    } catch (err) {
      setError(err.message)
    }
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
    let data
    try {
      data = await api.addCoach(form)
    } catch (err) {
      return setMessage({ error: true, text: err.message })
    } finally {
      setSaving(false)
    }
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
      <CsvImport kind="coaches" importRow={api.addCoach} onDone={reload} />

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
  const { coaches, reload: reloadCoaches } = useCoaches()
  const [athletes, setAthletes] = useState([])
  const [error, setError] = useState(null)
  const [form, setForm] = useState(emptyAthlete)
  const [message, setMessage] = useState(null)
  const [saving, setSaving] = useState(false)

  const reload = useCallback(async () => {
    try {
      setAthletes(await api.listAthletes())
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function addAthlete(event) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      await api.addAthlete({
        name: form.name.trim(),
        invite_email: form.email.trim().toLowerCase() || null,
        coach_id: form.coachId || null,
        date_of_birth: form.dateOfBirth || null,
        weight_class: form.weightClass.trim() || null,
        club: form.club.trim() || null,
      })
    } catch (err) {
      return setMessage({ error: true, text: err.message })
    } finally {
      setSaving(false)
    }
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
      <CsvImport
        kind="athletes"
        context={{
          coachesByEmail: new Map(coaches.map((c) => [c.email, c])),
          existingEmails: new Set(athletes.map((a) => a.invite_email).filter(Boolean)),
        }}
        importRow={api.addAthlete}
        onDone={() => {
          reload()
          reloadCoaches()
        }}
      />

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
                <td><LoginBadge record={a} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

// Whether a person's record is linked to a login yet.
function LoginBadge({ record }) {
  if (record.user_id) return <span className="badge active">{record.invite_email || 'Linked'}</span>
  if (record.invite_email) return <span className="badge invited">{record.invite_email}</span>
  return '—'
}

const emptyOfficial = { name: '', email: '', qualifications: '' }

function Officials() {
  const [officials, setOfficials] = useState([])
  const [error, setError] = useState(null)
  const [form, setForm] = useState(emptyOfficial)
  const [message, setMessage] = useState(null)
  const [saving, setSaving] = useState(false)

  const reload = useCallback(async () => {
    try {
      setOfficials(await api.listOfficials())
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function addOfficial(event) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      await api.addOfficial({
        name: form.name.trim(),
        invite_email: form.email.trim().toLowerCase() || null,
        qualifications: form.qualifications.trim() || null,
      })
    } catch (err) {
      return setMessage({ error: true, text: err.message })
    } finally {
      setSaving(false)
    }
    setMessage({
      text: form.email
        ? `${form.name} is added. They can sign in with ${form.email} to keep their profile up to date.`
        : `${form.name} is added.`,
    })
    setForm(emptyOfficial)
    reload()
  }

  const field = (key) => ({ value: form[key], onChange: (e) => setForm({ ...form, [key]: e.target.value }) })

  return (
    <section>
      <form onSubmit={addOfficial} className="row-form">
        <h2>Add an official</h2>
        <label>Name<input required {...field('name')} /></label>
        <label>Email <span className="muted">(optional, lets them sign in)</span><input type="email" {...field('email')} /></label>
        <label>Qualifications<input {...field('qualifications')} /></label>
        <button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add official'}</button>
      </form>
      {message && <p className={message.error ? 'error' : 'success'}>{message.text}</p>}
      <CsvImport
        kind="officials"
        context={{ existingEmails: new Set(officials.map((o) => o.invite_email).filter(Boolean)) }}
        importRow={api.addOfficial}
        onDone={reload}
      />

      <h2>Officials</h2>
      {error && <p className="error">{error}</p>}
      {officials.length === 0 ? (
        <p className="muted">No officials yet.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Name</th><th>Qualifications</th><th>Login</th></tr>
          </thead>
          <tbody>
            {officials.map((o) => (
              <tr key={o.id}>
                <td>{o.name}</td>
                <td>{o.qualifications || '—'}</td>
                <td><LoginBadge record={o} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
