import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import CsvImport from './CsvImport'
import AthleteForm from './AthleteForm'
import { formatBouts, formatWeight, genderLabel } from './athletes'

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
        Site Admins create events and clubs. What a user can do on an event (Owner, Coach or Viewer) or in a club (Owner or Coach) is set there.
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

function Athletes() {
  const { users, reload: reloadUsers } = useUsers()
  const [athletes, setAthletes] = useState([])
  const [clubs, setClubs] = useState([])
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    try {
      const [athleteList, clubList] = await Promise.all([api.listAthletes(), api.listClubs()])
      setAthletes(athleteList)
      setClubs(clubList)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return (
    <section>
      <AthleteForm
        clubs={clubs}
        users={users}
        onSave={async (record) => {
          await api.addAthlete(record)
          reload()
        }}
      />
      {users.some((u) => !u.id) && (
        <p className="muted">Invited users appear in the coach list once they've signed in.</p>
      )}
      <p className="muted">Clubs are made on the Clubs page. To move an athlete to another club, open their club there.</p>
      <CsvImport
        kind="athletes"
        context={{
          usersByEmail: new Map(users.map((u) => [u.email, u])),
          clubsByName: new Map(clubs.map((c) => [c.name.trim().toLowerCase(), c])),
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
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Name</th><th>Born</th><th>Gender</th><th>Weight</th><th>Experience</th><th>Club</th><th>Coach</th><th>Login</th></tr>
            </thead>
            <tbody>
              {athletes.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td>{a.date_of_birth || '—'}</td>
                  <td>{genderLabel(a.gender)}</td>
                  <td>{formatWeight(a.weight_kg)}</td>
                  <td>{formatBouts(a.bouts)}</td>
                  <td>{a.club || '—'}</td>
                  <td>{a.coach ? a.coach.name || a.coach.email : '—'}</td>
                  <td><LoginBadge record={a} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
