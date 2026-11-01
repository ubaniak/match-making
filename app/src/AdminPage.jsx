import { useCallback, useEffect, useState } from 'react'
import { Button, Input, Popconfirm, Space, Tabs } from 'antd'
import { DeleteOutlined, EditOutlined } from '@ant-design/icons'
import DataTable from './DataTable'
import { api } from './api'
import CsvImport from './CsvImport'
import AthleteForm from './AthleteForm'
import { formatBouts, formatWeight, genderLabel } from './athletes'
import { dash } from './dialogs'
import { Badge, ErrorAlert, Field, FormCard, FormMessage, FullRow, Muted, PageHeading, Pick, Section } from './ui'

const accountTypes = [
  { value: 'admin', label: 'Admin' },
  { value: 'user', label: 'User' },
  { value: 'official', label: 'Official' },
  { value: 'public', label: 'Public (no access yet)' },
]

// Edit and delete buttons for a table row, as the frontend-style skill describes.
function RowActions({ name, onEdit, onDelete, deleteText, busy }) {
  return (
    <Space size={4}>
      <Button size="small" shape="circle" icon={<EditOutlined />} aria-label={`Edit ${name}`} title="Edit" onClick={onEdit} />
      <Popconfirm title={`Delete ${name}?`} description={deleteText} okText="Delete" okButtonProps={{ danger: true }} cancelText="Cancel" onConfirm={onDelete}>
        <Button size="small" shape="circle" danger icon={<DeleteOutlined />} aria-label={`Delete ${name}`} title="Delete" disabled={busy} />
      </Popconfirm>
    </Space>
  )
}

// Runs a change and reloads, keeping its error for the section's alert.
function useRunner(reload) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function run(action) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await reload()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

const tabs = [
  ['users', 'Users'],
  ['athletes', 'Athletes'],
  ['officials', 'Officials'],
  ['test-data', 'Test data'],
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
      {tab === 'test-data' && <TestData />}
    </main>
  )
}

// One click to load or remove the TEST events, clubs and athletes (migration 17).
function TestData() {
  const [busy, setBusy] = useState(null) // 'seed' or 'clear' while running
  const [message, setMessage] = useState(null)
  const counts = (c) => `${c.events} events, ${c.clubs} clubs and ${c.athletes} athletes`

  async function run(kind) {
    setBusy(kind)
    setMessage(null)
    try {
      const c = kind === 'seed' ? await api.seedTestData() : await api.clearTestData()
      setMessage({ text: kind === 'seed' ? `Loaded ${counts(c)}.` : `Removed ${counts(c)}.` })
    } catch (err) {
      setMessage({ error: true, text: err.message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section title="Test data">
      <Muted>
        Loads two Active events you own: TEST One-Day Card on 1 January 3000 with 20 athletes entered, and
        TEST Multi-Day Open from 8 to 10 January 3000 with 100. Both have the same 5 TEST clubs. Birth dates
        are in the 2950s to 2990s so the athletes fall into every age group in year 3000. Clearing removes
        every event, athlete and club whose name starts with &ldquo;TEST &rdquo;, with their bouts and results.
      </Muted>
      <Space style={{ marginTop: 16 }}>
        <Popconfirm title="Load test data?" okText="Load" cancelText="Cancel" onConfirm={() => run('seed')}>
          <Button type="primary" loading={busy === 'seed'} disabled={Boolean(busy)}>Load test data</Button>
        </Popconfirm>
        <Popconfirm
          title="Clear test data?"
          description="Everything named TEST is deleted, including bouts and results. This can't be undone."
          okText="Clear"
          okButtonProps={{ danger: true }}
          cancelText="Cancel"
          onConfirm={() => run('clear')}
        >
          <Button danger loading={busy === 'clear'} disabled={Boolean(busy)}>Clear test data</Button>
        </Popconfirm>
      </Space>
      <FormMessage message={message} />
    </Section>
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
  const [editing, setEditing] = useState(null) // the user row being edited
  const changes = useRunner(reload)

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
    { title: 'Status', key: 'state', value: (u) => u.state, render: (_, u) => <Badge muted={u.state !== 'Active'}>{u.state}</Badge> },
    {
      key: 'actions',
      className: 'actions',
      render: (_, u) => (
        <RowActions
          name={u.name || u.email}
          busy={changes.busy}
          onEdit={() => { changes.setError(null); setEditing(u) }}
          deleteText={u.id ? 'Their account is removed for good. To keep their history, disable them instead.' : 'The invite is withdrawn.'}
          onDelete={() => changes.run(() => api.deleteUser(u))}
        />
      ),
    },
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
        <ErrorAlert>{error || changes.error}</ErrorAlert>
        {editing && (
          <UserForm
            key={editing.id ?? editing.email}
            user={editing}
            busy={changes.busy}
            onCancel={() => setEditing(null)}
            onSave={async (fields) => {
              if (await changes.run(() => api.updateUser(editing, fields))) setEditing(null)
            }}
          />
        )}
        {users.length === 0 ? (
          <Muted>No users yet.</Muted>
        ) : (
          <DataTable rowKey="email" columns={columns} dataSource={users} />
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
  const [editing, setEditing] = useState(null) // the athlete being edited

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
  const changes = useRunner(reload)

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Born', key: 'born', render: (_, a) => dash(a.date_of_birth) },
    { title: 'Gender', key: 'gender', render: (_, a) => genderLabel(a.gender) },
    { title: 'Weight', key: 'weight', value: (a) => a.weight_kg, render: (_, a) => formatWeight(a.weight_kg) },
    { title: 'Experience', key: 'bouts', value: (a) => a.bouts, render: (_, a) => formatBouts(a.bouts) },
    { title: 'Club', key: 'club', render: (_, a) => dash(a.club) },
    { title: 'Coach', key: 'coach', render: (_, a) => (a.coach ? a.coach.name || a.coach.email : '—') },
    { title: 'Login', key: 'login', value: (a) => a.invite_email, render: (_, a) => <LoginBadge record={a} /> },
    {
      key: 'actions',
      className: 'actions',
      render: (_, a) => (
        <RowActions
          name={a.name}
          busy={changes.busy}
          onEdit={() => { changes.setError(null); setEditing(a) }}
          deleteText="This can't be undone. Athletes in an Active event or with a recorded result can't be deleted."
          onDelete={() => changes.run(() => api.deleteAthlete(a.id))}
        />
      ),
    },
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
        <ErrorAlert>{error || changes.error}</ErrorAlert>
        {editing && (
          <AthleteForm
            key={editing.id}
            athlete={editing}
            users={users}
            onCancel={() => setEditing(null)}
            onSave={async (record) => {
              await api.updateAthlete(editing.id, record)
              setEditing(null)
              await reload()
            }}
          />
        )}
        {athletes.length === 0 ? (
          <Muted>No athletes yet.</Muted>
        ) : (
          <DataTable rowKey="id" columns={columns} dataSource={athletes} />
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
  const [editing, setEditing] = useState(null) // the official being edited

  const reload = useCallback(async () => {
    try {
      setOfficials(await api.listOfficials())
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [])
  const changes = useRunner(reload)

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
    { title: 'Login', key: 'login', value: (o) => o.invite_email, render: (_, o) => <LoginBadge record={o} /> },
    {
      key: 'actions',
      className: 'actions',
      render: (_, o) => (
        <RowActions
          name={o.name}
          busy={changes.busy}
          onEdit={() => { changes.setError(null); setEditing(o) }}
          deleteText="Their event invitations are removed too, and they stop being Chief Official or Deputy on those events."
          onDelete={() => changes.run(() => api.deleteOfficial(o.id))}
        />
      ),
    },
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
        <ErrorAlert>{error || changes.error}</ErrorAlert>
        {editing && (
          <OfficialForm
            key={editing.id}
            official={editing}
            busy={changes.busy}
            onCancel={() => setEditing(null)}
            onSave={async (fields) => {
              if (await changes.run(() => api.updateOfficial(editing, fields))) setEditing(null)
            }}
          />
        )}
        {officials.length === 0 ? (
          <Muted>No officials yet.</Muted>
        ) : (
          <DataTable rowKey="id" columns={columns} dataSource={officials} />
        )}
      </Section>
    </section>
  )
}

// Edit a user. Accounts: name, account type and status (the email is their login). Invites:
// name, email and account type.
function UserForm({ user, busy, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: user.name ?? '',
    email: user.email,
    roleId: user.role_id ?? 'user',
    status: user.status ?? (user.state === 'Disabled' ? 'disabled' : 'active'),
  })
  const set = (key) => (value) => setForm({ ...form, [key]: value })
  return (
    <FormCard
      title={`Edit ${user.name || user.email}`}
      onSubmit={(e) => { e.preventDefault(); onSave(form) }}
      actions={
        <>
          <Button type="primary" htmlType="submit" loading={busy}>Save</Button>
          <Button onClick={onCancel}>Cancel</Button>
        </>
      }
    >
      <Field label="Name"><Input value={form.name} onChange={(e) => set('name')(e.target.value)} /></Field>
      <Field label="Email">
        <Input type="email" required value={form.email} disabled={Boolean(user.id)} onChange={(e) => set('email')(e.target.value)} />
      </Field>
      <Field label="Account"><Pick value={form.roleId} onChange={set('roleId')} options={accountTypes} /></Field>
      {user.id && (
        <Field label="Status">
          <Pick value={form.status} onChange={set('status')} options={[{ value: 'active', label: 'Active' }, { value: 'disabled', label: 'Disabled (can\'t sign in to anything)' }]} />
        </Field>
      )}
      {user.id && <FullRow><Muted>The email is their sign-in, so it can't be changed here. There must always be at least one active Admin.</Muted></FullRow>}
    </FormCard>
  )
}

function OfficialForm({ official, busy, onSave, onCancel }) {
  const [form, setForm] = useState({ name: official.name, email: official.invite_email ?? '', qualifications: official.qualifications ?? '' })
  const field = (key) => ({ value: form[key], onChange: (e) => setForm({ ...form, [key]: e.target.value }) })
  function save(e) {
    e.preventDefault()
    onSave({ name: form.name.trim(), invite_email: form.email.trim().toLowerCase(), qualifications: form.qualifications.trim() || null })
  }
  return (
    <FormCard
      title={`Edit ${official.name}`}
      onSubmit={save}
      actions={
        <>
          <Button type="primary" htmlType="submit" loading={busy}>Save</Button>
          <Button onClick={onCancel}>Cancel</Button>
        </>
      }
    >
      <Field label="Name"><Input required {...field('name')} /></Field>
      <Field label="Email"><Input type="email" required {...field('email')} /></Field>
      <Field label="Qualifications"><Input {...field('qualifications')} /></Field>
      <FullRow><Muted>Changing the email links the official to the account with the new address, or invites it.</Muted></FullRow>
    </FormCard>
  )
}
