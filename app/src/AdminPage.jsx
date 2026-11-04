import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Input, Popconfirm, Space } from 'antd'
import { DeleteOutlined, EditOutlined, EyeOutlined, MailOutlined } from '@ant-design/icons'
import DataTable from './DataTable'
import { api } from './api'
import CsvImport from './CsvImport'
import AthleteForm from './AthleteForm'
import { cleanText, formatBouts, formatLevel, formatWeight, genderLabel } from './athletes'
import { dash } from './dialogs'
import WelcomeNotice from './WelcomeNotice'
import { accountAs, sendWelcome } from './welcome'
import { Badge, ErrorAlert, Field, FormCard, FormMessage, FullRow, Muted, NumberInput, PageHeading, Pick, Section, Title } from './ui'

// Two account types (Bhavek, 2026-11-04, Option B). Everything else is a role on a club or an event.
const accountTypes = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
]
const blankUser = { name: '', email: '', roleId: 'member', official: false }

// Being an official means being on the Officials list, so they can be invited to events.
// Adds them there unless that email is already listed.
async function ensureOfficial({ name, email }) {
  const clean = email.trim().toLowerCase()
  const officials = await api.listOfficials()
  if (officials.some((o) => o.invite_email === clean)) return false
  await api.addOfficial({ name: name?.trim() || clean, invite_email: clean, qualifications: null })
  return true
}

// One row of the users CSV: the same steps as the Add a user form. Returns { note } when the
// welcome email didn't go out (the envelope on their row sends it again).
async function importUser(user) {
  await api.addUser(user)
  if (user.official) await ensureOfficial(user)
  const welcome = await sendWelcome(user)
  return welcome.sent ? null : { note: `the welcome email wasn't sent (${welcome.reason}). Use the envelope on their row to send it again` }
}

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

// Athletes and Officials have their own top-nav pages (Bhavek, 2026-11-02). Test data was
// removed (Bhavek, 2026-11-04), so Admin is just Users.
export default function AdminPage() {
  return (
    <main className="panel">
      <PageHeading title="Admin" />
      <Users />
    </main>
  )
}

// Site Admin's top-nav Athletes page.
export function AthletesPage() {
  return (
    <main className="panel">
      <PageHeading title="Athletes" />
      <Athletes />
    </main>
  )
}

// Site Admin's top-nav Officials page.
export function OfficialsPage() {
  return (
    <main className="panel">
      <PageHeading title="Officials" />
      <Officials />
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
  const [form, setForm] = useState(blankUser)
  const [message, setMessage] = useState(null)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(null) // the user row being edited
  const [welcome, setWelcome] = useState(null) // the last welcome email: who, and whether it went
  const [emailing, setEmailing] = useState(null) // email of the row whose welcome is sending
  const changes = useRunner(reload)
  const [viewingBusy, setViewingBusy] = useState(null) // id of the row whose View as is starting

  // View as: the whole app as this person sees it, read-only, until "Back to my account".
  async function viewAs(user) {
    setViewingBusy(user.id)
    changes.setError(null)
    try {
      await api.startViewAs(user)
      window.location.hash = 'home'
      window.scrollTo(0, 0)
    } catch (err) {
      changes.setError(err.message)
      setViewingBusy(null)
    }
  }

  async function addUser(event) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    setWelcome(null)
    let data
    let listed = false
    try {
      data = await api.addUser(form)
      if (form.official) listed = await ensureOfficial(form)
    } catch (err) {
      setSaving(false)
      return setMessage({ error: true, text: err.message })
    }
    const added = { name: form.name.trim(), email: form.email.trim().toLowerCase(), roleId: form.roleId }
    setWelcome(await sendWelcome(added))
    setSaving(false)
    const role = accountAs[form.roleId] ?? 'a Member'
    const officialNote = listed ? ' They are on the Officials list too.' : ''
    setMessage({
      text: data === 'updated'
        ? `${form.email} already had an account and is now ${role}.${officialNote}`
        : `${form.email} is added as ${role}.${officialNote}`,
    })
    setForm(blankUser)
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
        <Space size={4}>
          <Button
            size="small"
            shape="circle"
            icon={<MailOutlined />}
            aria-label={`Email ${u.name || u.email} how to sign in`}
            title="Email how to sign in"
            loading={emailing === u.email}
            disabled={Boolean(emailing)}
            onClick={async () => {
              setEmailing(u.email)
              setWelcome(await sendWelcome({ name: u.name, email: u.email, roleId: u.role_id }))
              setEmailing(null)
            }}
          />
          {/* Demo accounts are left out of View as (Bhavek, 2026-11-04): sign in as them instead. */}
          {api.mode === 'supabase' && u.id && !/@demo\.test$/i.test(u.email ?? '') && (
            <Button
              size="small"
              shape="circle"
              icon={<EyeOutlined />}
              aria-label={`View as ${u.name || u.email}`}
              title="View as (see exactly what they see, read-only)"
              disabled={Boolean(viewingBusy)}
              loading={viewingBusy === u.id}
              onClick={() => viewAs(u)}
            />
          )}
          <RowActions
            name={u.name || u.email}
            busy={changes.busy}
            onEdit={() => { changes.setError(null); setEditing(u) }}
            deleteText={u.id ? 'Their account is removed for good. To keep their history, disable them instead.' : 'The invite is withdrawn.'}
            onDelete={() => changes.run(() => api.deleteUser(u))}
          />
        </Space>
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
        <Field label="Account"><Pick value={form.roleId} onChange={(roleId) => setForm({ ...form, roleId })} options={accountTypes} /></Field>
        <FullRow>
          <Checkbox checked={form.official} onChange={(e) => setForm({ ...form, official: e.target.checked })}>
            Official: also add them to the Officials list, so they can be invited to events
          </Checkbox>
        </FullRow>
      </FormCard>
      <FormMessage message={message} />
      <WelcomeNotice welcome={welcome} onDismiss={() => setWelcome(null)} />
      <Muted>
        Adding someone emails them how to sign in; the envelope on their row sends it again.
        There are two accounts: Admins manage everything; everyone else is a Member. Any Member can request an event
        (and own it once a site Admin approves it). Everything else a Member does comes from their roles: Owner or Coach
        of a club, Owner of an event, or an official on an event (anyone on the Officials list can be invited).
      </Muted>
      <CsvImport kind="users" importRow={importUser} onDone={reload}>
        <Muted>Each person gets the same welcome email as adding them above. Put yes in the official column to add them to the Officials list too.</Muted>
      </CsvImport>

      <Section title="Users">
        <ErrorAlert>{error || changes.error}</ErrorAlert>
        {editing && (
          <UserForm
            key={editing.id ?? editing.email}
            user={editing}
            busy={changes.busy}
            onCancel={() => setEditing(null)}
            onSave={async (fields) => {
              const saved = await changes.run(() => api.updateUser(editing, fields))
              if (saved) setEditing(null)
            }}
          />
        )}
        {users.length === 0 ? (
          <Muted>No users yet.</Muted>
        ) : (
          <DataTable rowKey="email" columns={columns} dataSource={users} csvName="Users" />
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
    { title: 'BC number', key: 'bc', value: (a) => a.bc_number, render: (_, a) => dash(a.bc_number) },
    { title: 'Last medical', key: 'medical', value: (a) => a.last_medical, render: (_, a) => dash(a.last_medical) },
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
          <DataTable rowKey="id" columns={columns} dataSource={athletes} csvName="Athletes" />
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

const emptyOfficial = { name: '', email: '', phone: '', level: '', bcNumber: '', qualifications: '' }

// The form's values as an officials row (level, phone and BC number are migration 40).
const officialRecord = (form) => ({
  name: form.name.trim(),
  invite_email: form.email.trim().toLowerCase(),
  phone: cleanText(form.phone),
  level: form.level === '' || form.level == null ? null : Number(form.level),
  bc_number: cleanText(form.bcNumber),
  qualifications: cleanText(form.qualifications),
})

// The fields shared by the add and edit official forms.
function OfficialFields({ form, setForm }) {
  const field = (key) => ({ value: form[key], onChange: (e) => setForm({ ...form, [key]: e.target.value }) })
  return (
    <>
      <Field label="Name"><Input required {...field('name')} /></Field>
      <Field label="Email"><Input type="email" required {...field('email')} /></Field>
      <Field label="Phone" hint="optional"><Input type="tel" {...field('phone')} /></Field>
      <Field label="Level" hint="optional">
        <NumberInput min={0} max={100} step={1} precision={0} value={form.level} onChange={(v) => setForm({ ...form, level: v })} />
      </Field>
      <Field label="BC number" hint="Boxing Canada, optional"><Input {...field('bcNumber')} /></Field>
      <Field label="Qualifications" hint="optional"><Input {...field('qualifications')} /></Field>
    </>
  )
}

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
      await api.addOfficial(officialRecord(form))
    } catch (err) {
      return setMessage({ error: true, text: err.message })
    } finally {
      setSaving(false)
    }
    setMessage({ text: `${form.name} is added. They can sign in with ${form.email} to keep their profile up to date.` })
    setForm(emptyOfficial)
    reload()
  }

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Level', key: 'level', value: (o) => o.level, render: (_, o) => formatLevel(o.level) },
    { title: 'Email', key: 'login', value: (o) => o.invite_email, render: (_, o) => <LoginBadge record={o} /> },
    { title: 'Phone', key: 'phone', value: (o) => o.phone, render: (_, o) => dash(o.phone) },
    { title: 'BC number', key: 'bc', value: (o) => o.bc_number, render: (_, o) => dash(o.bc_number) },
    { title: 'Qualifications', key: 'q', value: (o) => o.qualifications, render: (_, o) => dash(o.qualifications) },
    {
      key: 'actions',
      className: 'actions',
      render: (_, o) => (
        <RowActions
          name={o.name}
          busy={changes.busy}
          onEdit={() => { changes.setError(null); setEditing(o) }}
          deleteText="Their event invitations are removed too, and they stop being Chief Official on those events."
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
        <OfficialFields form={form} setForm={setForm} />
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
          <DataTable rowKey="id" columns={columns} dataSource={officials} csvName="Officials" />
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
    roleId: user.role_id === 'admin' ? 'admin' : 'member',
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
  const [form, setForm] = useState({
    name: official.name,
    email: official.invite_email ?? '',
    phone: official.phone ?? '',
    level: official.level ?? '',
    bcNumber: official.bc_number ?? '',
    qualifications: official.qualifications ?? '',
  })
  function save(e) {
    e.preventDefault()
    onSave(officialRecord(form))
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
      <OfficialFields form={form} setForm={setForm} />
      <FullRow><Muted>Changing the email links the official to the account with the new address, or invites it.</Muted></FullRow>
    </FormCard>
  )
}
