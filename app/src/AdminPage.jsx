import { useCallback, useEffect, useState } from 'react'
import { Button, Input, Table, Tabs } from 'antd'
import { api } from './api'
import CsvImport from './CsvImport'
import AthleteForm from './AthleteForm'
import { formatBouts, formatWeight, genderLabel } from './athletes'
import { dash, tableProps } from './dialogs'
import { Badge, ErrorAlert, Field, FormCard, FormMessage, Muted, PageHeading, Section } from './ui'

const tabs = [
  ['users', 'Users'],
  ['athletes', 'Athletes'],
  ['officials', 'Officials'],
]

export default function AdminPage() {
  const [tab, setTab] = useState('users')

  return (
    <main className="panel">
      <PageHeading title="Admin" />
      <Tabs activeKey={tab} onChange={setTab} items={tabs.map(([key, label]) => ({ key, label }))} />
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

  const columns = [
    { title: 'Name', key: 'name', render: (_, u) => dash(u.name) },
    { title: 'Email', dataIndex: 'email', key: 'email' },
    { title: 'Account', key: 'role', render: (_, u) => dash(u.role_name) },
    { title: 'Status', key: 'state', render: (_, u) => <Badge muted={u.state !== 'Active'}>{u.state}</Badge> },
  ]

  return (
    <section>
      <FormCard
        title="Add a user"
        onSubmit={addUser}
        actions={<Button type="primary" htmlType="submit" loading={saving}>{saving ? 'Adding…' : 'Add user'}</Button>}
      >
        <Field label="Name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
      </FormCard>
      <FormMessage message={message} />
      <Muted>
        Site Admins create events and clubs. What a user can do on an event (Owner, Coach or Viewer) or in a club (Owner or Coach) is set there.
      </Muted>
      <CsvImport kind="users" importRow={api.addUser} onDone={reload} />

      <Section title="Users">
        <ErrorAlert>{error}</ErrorAlert>
        {users.length === 0 ? (
          <Muted>No users yet.</Muted>
        ) : (
          <Table {...tableProps} rowKey="email" columns={columns} dataSource={users} />
        )}
      </Section>
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

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Born', key: 'born', render: (_, a) => dash(a.date_of_birth) },
    { title: 'Gender', key: 'gender', render: (_, a) => genderLabel(a.gender) },
    { title: 'Weight', key: 'weight', render: (_, a) => formatWeight(a.weight_kg) },
    { title: 'Experience', key: 'bouts', render: (_, a) => formatBouts(a.bouts) },
    { title: 'Club', key: 'club', render: (_, a) => dash(a.club) },
    { title: 'Coach', key: 'coach', render: (_, a) => (a.coach ? a.coach.name || a.coach.email : '—') },
    { title: 'Login', key: 'login', render: (_, a) => <LoginBadge record={a} /> },
  ]

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
        <Muted>Invited users appear in the coach list once they've signed in.</Muted>
      )}
      <Muted>Clubs are made on the Clubs page. To move an athlete to another club, open their club there.</Muted>
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

      <Section title="Athletes">
        <ErrorAlert>{error}</ErrorAlert>
        {athletes.length === 0 ? (
          <Muted>No athletes yet.</Muted>
        ) : (
          <Table {...tableProps} rowKey="id" columns={columns} dataSource={athletes} />
        )}
      </Section>
    </section>
  )
}

// Whether a person's record is linked to a login yet.
function LoginBadge({ record }) {
  if (record.user_id) return <Badge>{record.invite_email || 'Linked'}</Badge>
  if (record.invite_email) return <Badge muted>{record.invite_email}</Badge>
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

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Qualifications', key: 'q', render: (_, o) => dash(o.qualifications) },
    { title: 'Login', key: 'login', render: (_, o) => <LoginBadge record={o} /> },
  ]

  return (
    <section>
      <FormCard
        title="Add an official"
        onSubmit={addOfficial}
        actions={<Button type="primary" htmlType="submit" loading={saving}>{saving ? 'Adding…' : 'Add official'}</Button>}
      >
        <Field label="Name"><Input required {...field('name')} /></Field>
        <Field label="Email"><Input type="email" required {...field('email')} /></Field>
        <Field label="Qualifications"><Input {...field('qualifications')} /></Field>
      </FormCard>
      <FormMessage message={message} />
      <CsvImport
        kind="officials"
        context={{ existingEmails: new Set(officials.map((o) => o.invite_email).filter(Boolean)) }}
        importRow={api.addOfficial}
        onDone={reload}
      />

      <Section title="Officials">
        <ErrorAlert>{error}</ErrorAlert>
        {officials.length === 0 ? (
          <Muted>No officials yet.</Muted>
        ) : (
          <Table {...tableProps} rowKey="id" columns={columns} dataSource={officials} />
        )}
      </Section>
    </section>
  )
}
