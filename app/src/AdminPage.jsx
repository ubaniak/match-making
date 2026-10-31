import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import CsvImport from './CsvImport'

const tabs = [
  ['users', 'Users'],
  ['athletes', 'Athletes'],
  ['officials', 'Officials'],
]

export default function AdminPage() {
  const [tab, setTab] = useState('users')

  return (
    <main className="panel">
      <h1>Admin</h1>
      <nav className="tabs">
        {tabs.map(([key, label]) => (
          <button key={key} className={tab === key ? 'tab active' : 'tab'} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>
      {tab === 'users' && <Users />}
      {tab === 'athletes' && <Athletes />}
      {tab === 'officials' && <Officials />}
    </main>
  )
}

// Everyone with an account, plus invites waiting for a first sign-in.
function useUsers() {
  const [users, setUsers] = useState([])
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    try {
      setUsers(await api.listUsers())
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { users, error, reload }
}

function Users() {
  const { users, error, reload } = useUsers()
  const [form, setForm] = useState({ name: '', email: '' })
  const [message, setMessage] = useState(null)
  const [saving, setSaving] = useState(false)

  async function addUser(event) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    let data
    try {
      data = await api.addUser(form)
    } catch (err) {
      return setMessage({ error: true, text: err.message })
    } finally {
      setSaving(false)
    }
    setMessage({
      text: data === 'updated'
        ? `${form.email} already had an account and is now a user.`
        : `${form.email} is added. They can sign in with that email.`,
    })
    setForm({ name: '', email: '' })
    reload()
  }

  return (
    <section>
      <form onSubmit={addUser} className="row-form">
        <h2>Add a user</h2>
        <label>
          Name
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          Email
          <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add user'}</button>
      </form>
      {message && <p className={message.error ? 'error' : 'success'}>{message.text}</p>}
      <p className="muted">
        Users can create events. What they can do on someone else's event (Admin, Coach or Viewer) is set on that event.
      </p>
      <CsvImport kind="users" importRow={api.addUser} onDone={reload} />

      <h2>Users</h2>
      {error && <p className="error">{error}</p>}
      {users.length === 0 ? (
        <p className="muted">No users yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Account</th><th>Status</th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.email}>
                  <td>{u.name || '—'}</td>
                  <td>{u.email}</td>
                  <td>{u.role_name || '—'}</td>
                  <td><span className={`badge ${u.state.toLowerCase()}`}>{u.state}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

const emptyAthlete = { name: '', email: '', coachId: '', dateOfBirth: '', weightClass: '', club: '' }

function Athletes() {
  const { users, reload: reloadUsers } = useUsers()
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
  const activeUsers = users.filter((u) => u.id && u.state === 'Active')

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
            {activeUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name || u.email}</option>
            ))}
          </select>
        </label>
        <label>Date of birth<input type="date" {...field('dateOfBirth')} /></label>
        <label>Weight class<input {...field('weightClass')} /></label>
        <label>Club<input {...field('club')} /></label>
        <button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add athlete'}</button>
      </form>
      {message && <p className={message.error ? 'error' : 'success'}>{message.text}</p>}
      {users.some((u) => !u.id) && (
        <p className="muted">Invited users appear in the coach list once they've signed in.</p>
      )}
      <CsvImport
        kind="athletes"
        context={{
          usersByEmail: new Map(users.map((u) => [u.email, u])),
          existingEmails: new Set(athletes.map((a) => a.invite_email).filter(Boolean)),
        }}
        importRow={api.addAthlete}
        onDone={() => {
          reload()
          reloadUsers()
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
        invite_email: form.email.trim().toLowerCase(),
        qualifications: form.qualifications.trim() || null,
      })
    } catch (err) {
      return setMessage({ error: true, text: err.message })
    } finally {
      setSaving(false)
    }
    setMessage({ text: `${form.name} is added. They can sign in with ${form.email} to keep their profile up to date.` })
    setForm(emptyOfficial)
    reload()
  }

  const field = (key) => ({ value: form[key], onChange: (e) => setForm({ ...form, [key]: e.target.value }) })

  return (
    <section>
      <form onSubmit={addOfficial} className="row-form">
        <h2>Add an official</h2>
        <label>Name<input required {...field('name')} /></label>
        <label>Email<input type="email" required {...field('email')} /></label>
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
