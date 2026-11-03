import { useCallback, useEffect, useState } from 'react'
import { Button, Checkbox, Descriptions, Input, Popconfirm, Space } from 'antd'
import { DeleteOutlined, EditOutlined } from '@ant-design/icons'
import DataTable from './DataTable'
import { api } from './api'
import AthleteForm from './AthleteForm'
import CsvImport from './CsvImport'
import { formatBouts, formatWeight, genderLabel } from './athletes'
import { askConfirm, dash } from './dialogs'
import { BackLink, Badge, PageHeading, ErrorAlert, Field, FormCard, FullRow, Muted, Pick, Section, SuccessAlert, Text, Title } from './ui'

const roleLabels = { owner: 'Owner', coach: 'Coach' }
const personName = (user) => (user ? user.name || user.email : '—')
const userLabel = (u) => (u.name ? `${u.name} (${u.email})` : u.email)
const transferLabels = { pending: 'Waiting', accepted: 'Accepted', declined: 'Declined', cancelled: 'Withdrawn', moved: 'Moved by Admin' }
const byEmail = (users) => new Map(users.map((u) => [u.email?.toLowerCase(), u]))
const formatWhen = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '')

function myClubRole(club, profile) {
  return club.members.find((m) => m.user_id === profile?.id && m.status === 'active')?.role ?? null
}

// Until the list arrives it is `usersLoading`, so a picker can say "Loading…" rather than "Everyone is already in".
const usersLoading = Object.freeze([])
function useUsers() {
  const [users, setUsers] = useState(usersLoading)
  useEffect(() => {
    api.listUsers().then(setUsers, () => setUsers([]))
  }, [])
  return users
}

// Clubs: site Admins create them and assign Owners. Owners invite people (a site Admin approves),
// look after the club's athletes and accept transfers in.
// clubId opens one club straight away (links from the Home page and alerts).
export default function ClubsPage({ profile, can, clubId }) {
  const siteAdmin = can('users:manage')
  const [view, setView] = useState(clubId ? { name: 'club', id: clubId } : { name: 'list' })

  return (
    <main className="panel">
      {view.name === 'list' && <ClubList siteAdmin={siteAdmin} profile={profile} onOpen={(id) => setView({ name: 'club', id })} />}
      {view.name === 'club' && (
        <ClubDetail
          id={view.id}
          siteAdmin={siteAdmin}
          profile={profile}
          onBack={() => setView({ name: 'list' })}
          onOpen={(id) => setView({ name: 'club', id })}
        />
      )}
    </main>
  )
}

function ClubList({ siteAdmin, profile, onOpen }) {
  const [clubs, setClubs] = useState(null)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    try {
      setClubs(await api.listClubs())
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const mine = clubs?.filter((c) => myClubRole(c, profile)) ?? []
  const others = clubs?.filter((c) => !myClubRole(c, profile)) ?? []

  return (
    <>
      <PageHeading title="Clubs" />
      {siteAdmin && <NewClubForm onCreated={onOpen} />}
      {siteAdmin && clubs && <ClubsImport clubs={clubs} onDone={reload} />}
      {siteAdmin && <PendingInvites onChange={reload} />}
      <ErrorAlert>{error}</ErrorAlert>
      {clubs === null && !error && <Muted>Loading…</Muted>}
      {clubs?.length === 0 && <Muted>{siteAdmin ? 'No clubs yet. Create one above.' : 'You aren\'t in a club yet. A site Admin adds you to one.'}</Muted>}
      {mine.length > 0 && <ClubTable title="Your clubs" clubs={mine} profile={profile} onOpen={onOpen} />}
      {/* Club owners and coaches only see their own clubs (migration 31). */}
      {siteAdmin && others.length > 0 && <ClubTable title={mine.length ? 'Other clubs' : 'All clubs'} clubs={others} profile={profile} onOpen={onOpen} />}
      {!siteAdmin && clubs?.length > 0 && mine.length === 0 && <Muted>You aren't in a club yet. A site Admin adds you to one.</Muted>}
    </>
  )
}

function ClubTable({ title, clubs, profile, onOpen }) {
  const columns = [
    { title: 'Club', key: 'name', value: (c) => c.name, render: (_, c) => <Button type="link" size="small" style={{ padding: 0 }} onClick={() => onOpen(c.id)}>{c.name}</Button> },
    { title: 'Owners', key: 'owners', render: (_, c) => c.members.filter((m) => m.role === 'owner' && m.status === 'active').map((m) => personName(m.user)).join(', ') || '—' },
    { title: 'Athletes', dataIndex: 'athlete_count', key: 'athletes' },
    { title: 'Your role', key: 'role', value: (c) => roleLabels[myClubRole(c, profile)], render: (_, c) => <RoleBadge role={myClubRole(c, profile)} /> },
  ]
  return (
    <Section title={title}>
      <DataTable rowKey="id" columns={columns} dataSource={clubs} csvName={title} />
    </Section>
  )
}

function RoleBadge({ role }) {
  if (!role) return '—'
  return <Badge>{roleLabels[role]}</Badge>
}

function NewClubForm({ onCreated }) {
  const users = useUsers().filter((u) => u.id && u.state === 'Active')
  const [form, setForm] = useState({ name: '', ownerId: '' })
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  async function save(e) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const id = await api.createClub({ name: form.name, ownerIds: form.ownerId ? [form.ownerId] : [] })
      onCreated(id)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <>
      <FormCard
        title="New club"
        onSubmit={save}
        actions={<Button type="primary" htmlType="submit" loading={saving}>{saving ? 'Creating…' : 'Create club'}</Button>}
      >
        <Field label="Name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Eastside BC" /></Field>
        <Field label="Owner" hint="add more on the club's page">
          <Pick
            allowEmpty
            value={form.ownerId}
            onChange={(ownerId) => setForm({ ...form, ownerId })}
            options={[{ value: '', label: 'No owner yet' }, ...users.map((u) => ({ value: u.id, label: userLabel(u) }))]}
          />
        </Field>
      </FormCard>
      <ErrorAlert>{error}</ErrorAlert>
    </>
  )
}

function ClubsImport({ clubs, onDone }) {
  const users = useUsers()
  return (
    <CsvImport
      kind="clubs"
      title="Create clubs from a CSV file"
      context={{ usersByEmail: byEmail(users), clubsByName: new Map(clubs.map((c) => [c.name.trim().toLowerCase(), c])) }}
      importRow={async ({ name, ownerIds }) => {
        await api.createClub({ name, ownerIds })
      }}
      onDone={onDone}
    />
  )
}

// Site Admins: invites from club owners waiting for approval, across all clubs.
function PendingInvites({ onChange }) {
  const [invites, setInvites] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      setInvites(await api.listPendingClubInvites())
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function run(action) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await reload()
      onChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (invites.length === 0 && !error) return null

  const columns = [
    { title: 'Person', key: 'person', render: (_, i) => personName(i.user) },
    { title: 'Club', key: 'club', render: (_, i) => i.club?.name },
    { title: 'As', key: 'as', render: (_, i) => roleLabels[i.role] },
    { title: 'Invited by', key: 'by', render: (_, i) => personName(i.inviter) },
    {
      key: 'actions',
      className: 'actions',
      render: (_, i) => (
        <Space>
          <Button size="small" type="primary" disabled={busy} onClick={() => run(() => api.approveClubMember(i.club_id, i.user_id))}>Approve</Button>
          <Button size="small" disabled={busy} onClick={() => run(() => api.removeClubMember(i.club_id, i.user_id))}>Decline</Button>
        </Space>
      ),
    },
  ]

  return (
    <Section title={`Club invites waiting for approval (${invites.length})`}>
      <ErrorAlert>{error}</ErrorAlert>
      <DataTable rowKey={(i) => `${i.club_id}-${i.user_id}`} columns={columns} dataSource={invites} csvName="Club invites" />
    </Section>
  )
}

function ClubDetail({ id, siteAdmin, profile, onBack }) {
  const [club, setClub] = useState(undefined)
  const [clubs, setClubs] = useState([])
  const [error, setError] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const users = useUsers()

  const reload = useCallback(async () => {
    try {
      // Only site Admins see every club; members get just the names they can transfer to.
      const [detail, all] = await Promise.all([api.getClub(id), siteAdmin ? api.listClubs() : api.listTransferClubs()])
      setClub(detail)
      setClubs(all)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [id, siteAdmin])

  useEffect(() => {
    reload()
  }, [reload])

  const backLink = <BackLink onClick={onBack}>{siteAdmin ? 'All clubs' : 'Your clubs'}</BackLink>
  if (club === undefined) return <>{backLink}{error ? <ErrorAlert>{error}</ErrorAlert> : <Muted>Loading…</Muted>}</>
  if (club === null) return <>{backLink}<p>{siteAdmin ? 'That club no longer exists.' : 'That club doesn\'t exist, or you aren\'t one of its members.'}</p></>

  const role = myClubRole(club, profile)
  const may = {
    siteAdmin,
    manage: siteAdmin || role === 'owner',
    member: siteAdmin || Boolean(role),
  }

  async function remove() {
    const n = club.athletes.length
    if (n > 0) {
      setError(`${club.name} still has ${n} athlete${n === 1 ? '' : 's'}. Move ${n === 1 ? 'them' : 'them all'} to another club or delete them first, then delete the club.`)
      return
    }
    if (!(await askConfirm(`Delete ${club.name}?`, { okText: 'Delete', danger: true }))) return
    try {
      await api.deleteClub(club.id)
      onBack()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      {backLink}
      {renaming ? (
        <RenameForm club={club} onDone={() => { setRenaming(false); reload() }} />
      ) : (
        <PageHeading title={club.name}>
          {siteAdmin && <Button icon={<EditOutlined />} onClick={() => setRenaming(true)}>Rename</Button>}
        </PageHeading>
      )}
      <ErrorAlert>{error}</ErrorAlert>
      {may.member ? (
        <>
          <Descriptions
            size="small"
            column={{ xs: 1, sm: 2, md: 4 }}
            items={[
              { key: 'athletes', label: 'Athletes', children: club.athletes.length },
              { key: 'role', label: 'Your role', children: siteAdmin ? <Badge>Site admin</Badge> : <RoleBadge role={role} /> },
            ]}
          />
          <ClubAthletes club={club} clubs={clubs} users={users} may={may} onChange={reload} />
          <Transfers club={club} may={may} role={role} profile={profile} onChange={reload} />
          <ClubPeople club={club} users={users} may={may} onChange={reload} />
        </>
      ) : (
        // Event Owners and officials still see a club's people and the athletes in their events.
        <>
          <Muted>A club's people and athletes are only shown to its own members.</Muted>
          {club.athletes.length > 0 && <ClubAthletes club={club} clubs={clubs} users={users} may={may} onChange={reload} />}
          {club.members.length > 0 && <ClubPeople club={club} users={users} may={may} onChange={reload} />}
        </>
      )}

      {siteAdmin && <div className="section"><Button danger onClick={remove}>Delete this club</Button></div>}
    </>
  )
}

function RenameForm({ club, onDone }) {
  const [name, setName] = useState(club.name)
  const [error, setError] = useState(null)
  async function save(e) {
    e.preventDefault()
    try {
      await api.renameClub(club.id, name)
      onDone()
    } catch (err) {
      setError(err.message)
    }
  }
  return (
    <>
      <FormCard
        compact
        onSubmit={save}
        actions={<><Button type="primary" htmlType="submit">Save</Button><Button onClick={onDone}>Cancel</Button></>}
      >
        <Field label="Club name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </FormCard>
      <ErrorAlert>{error}</ErrorAlert>
    </>
  )
}

function ClubAthletes({ club, clubs, users, may, onChange }) {
  const [editing, setEditing] = useState(null) // athlete id
  const [moving, setMoving] = useState(null) // { athlete, mode: 'transfer' | 'move' }
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const waiting = new Set(club.transfers.filter((t) => t.status === 'pending').map((t) => t.athlete?.id))
  const editingAthlete = club.athletes.find((a) => a.id === editing)

  async function run(action) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await onChange()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Born', key: 'born', render: (_, a) => dash(a.date_of_birth) },
    { title: 'Gender', key: 'gender', render: (_, a) => genderLabel(a.gender) },
    { title: 'Weight', key: 'weight', value: (a) => a.weight_kg, render: (_, a) => formatWeight(a.weight_kg) },
    { title: 'Experience', key: 'bouts', value: (a) => a.bouts, render: (_, a) => formatBouts(a.bouts) },
    { title: 'BC number', key: 'bc', value: (a) => a.bc_number, render: (_, a) => dash(a.bc_number) },
    { title: 'Last medical', key: 'medical', value: (a) => a.last_medical, render: (_, a) => dash(a.last_medical) },
    { title: 'Coach', key: 'coach', render: (_, a) => (a.coach ? a.coach.name || a.coach.email : '—') },
    may.member && {
      key: 'actions',
      className: 'actions',
      render: (_, a) => (
        <Space size={4}>
          {may.manage && (
            <Button size="small" shape="circle" icon={<EditOutlined />} aria-label={`Edit ${a.name}`} title="Edit" onClick={() => { setError(null); setMoving(null); setEditing(a.id) }} />
          )}
          {waiting.has(a.id) ? (
            <Text type="secondary">Transfer waiting</Text>
          ) : (
            <Button type="link" size="small" onClick={() => { setError(null); setEditing(null); setMoving({ athlete: a, mode: 'transfer' }) }}>Transfer</Button>
          )}
          {may.siteAdmin && <Button type="link" size="small" onClick={() => { setError(null); setEditing(null); setMoving({ athlete: a, mode: 'move' }) }}>Move</Button>}
          {may.manage && (
            <Popconfirm title={`Delete ${a.name}?`} description="This can't be undone." okText="Delete" okButtonProps={{ danger: true }} cancelText="Cancel" onConfirm={() => run(() => api.deleteAthlete(a.id))}>
              <Button size="small" shape="circle" danger icon={<DeleteOutlined />} aria-label={`Delete ${a.name}`} title="Delete" disabled={busy} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ].filter(Boolean)

  return (
    <Section title={`Athletes (${club.athletes.length})`}>
      {may.manage && !editing && (
        <AthleteForm
          clubId={club.id}
          users={users}
          title={`Add an athlete to ${club.name}`}
          onSave={async (record) => {
            await api.addAthlete(record)
            await onChange()
          }}
        />
      )}
      {may.manage && !editing && (
        <CsvImport
          kind="clubAthletes"
          templateName="athletes"
          title={`Add athletes to ${club.name} from a CSV file`}
          context={{
            clubId: club.id,
            clubName: club.name,
            usersByEmail: byEmail(users),
            existingEmails: new Set(club.athletes.map((a) => a.invite_email).filter(Boolean)),
          }}
          importRow={api.addAthlete}
          onDone={onChange}
        />
      )}
      {editingAthlete && (
        <AthleteForm
          key={editingAthlete.id}
          athlete={editingAthlete}
          users={users}
          onCancel={() => setEditing(null)}
          onSave={async (record) => {
            await api.updateAthlete(editingAthlete.id, record)
            setEditing(null)
            await onChange()
          }}
        />
      )}
      {moving && (
        <MoveForm
          key={`${moving.athlete.id}-${moving.mode}`}
          {...moving}
          clubs={clubs.filter((c) => c.id !== club.id)}
          busy={busy}
          onCancel={() => { setError(null); setMoving(null) }}
          onSubmit={async (toClubId, extra) => {
            const ok = await run(() =>
              moving.mode === 'move'
                ? api.moveAthlete(moving.athlete.id, toClubId, extra.override)
                : api.requestTransfer(moving.athlete.id, toClubId, extra.note),
            )
            if (ok) setMoving(null)
          }}
        />
      )}
      <ErrorAlert>{error}</ErrorAlert>
      {club.athletes.length === 0 ? (
        <Muted>No athletes in this club yet.</Muted>
      ) : (
        <DataTable rowKey="id" columns={columns} dataSource={club.athletes} csvName={`${club.name} athletes`} />
      )}
    </Section>
  )
}

// Ask another club to take an athlete, or (site Admins) move them straight away.
function MoveForm({ athlete, mode, clubs, busy, onCancel, onSubmit }) {
  const [toClubId, setToClubId] = useState('')
  const [note, setNote] = useState('')
  const [override, setOverride] = useState(false)
  const moving = mode === 'move'

  function submit(e) {
    e.preventDefault()
    if (!toClubId) return
    onSubmit(toClubId, { note, override })
  }

  return (
    <FormCard
      title={moving ? `Move ${athlete.name}` : `Transfer ${athlete.name}`}
      onSubmit={submit}
      actions={
        <>
          <Button type="primary" htmlType="submit" disabled={busy || !toClubId}>{moving ? 'Move' : 'Send request'}</Button>
          <Button onClick={onCancel}>Cancel</Button>
        </>
      }
    >
      <FullRow>
        <Muted>
          {moving
            ? 'Moves the athlete now, with their bout count and history. Any waiting transfer request is withdrawn.'
            : 'The other club\'s Owner accepts or declines. Their bout count and history go with them.'}
          {' '}Athletes entered in an Active event can't change clubs until it's Done.
        </Muted>
      </FullRow>
      <Field label="To club">
        <Pick value={toClubId} onChange={setToClubId} placeholder="Choose a club…" options={clubs.map((c) => ({ value: c.id, label: c.name }))} />
      </Field>
      {!moving && (
        <Field label="Note" hint="optional"><Input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      )}
      {moving && (
        <FullRow>
          <Checkbox checked={override} onChange={(e) => setOverride(e.target.checked)}>
            Move anyway, even during an Active event
          </Checkbox>
        </FullRow>
      )}
    </FormCard>
  )
}

function Transfers({ club, may, role, profile, onChange }) {
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [override, setOverride] = useState(false)
  if (!may.member) return null

  const incoming = club.transfers.filter((t) => t.status === 'pending' && t.to_club_id === club.id)
  const outgoing = club.transfers.filter((t) => t.status === 'pending' && t.from_club_id === club.id)
  const history = club.transfers.filter((t) => t.status !== 'pending').slice(0, 20)
  const canDecide = may.siteAdmin || role === 'owner'
  const canCancel = (t) => may.siteAdmin || role === 'owner' || t.requested_by === profile?.id

  async function run(action) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await onChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Transfers">
      <ErrorAlert>{error}</ErrorAlert>
      {incoming.length === 0 && outgoing.length === 0 && history.length === 0 && <Muted>No transfers yet.</Muted>}
      {incoming.length > 0 && (
        <>
          <Title level={5}>Asking to join {club.name}</Title>
          {may.siteAdmin && (
            <div className="gap">
              <Checkbox checked={override} onChange={(e) => setOverride(e.target.checked)}>Accept even during an Active event</Checkbox>
            </div>
          )}
          <TransferTable
            transfers={incoming}
            csvName={`${club.name} transfers in`}
            actions={(t) =>
              canDecide && (
                <Space>
                  <Button size="small" type="primary" disabled={busy} onClick={() => run(() => api.decideTransfer(t.id, true, override))}>Accept</Button>
                  <Button size="small" disabled={busy} onClick={() => run(() => api.decideTransfer(t.id, false))}>Decline</Button>
                </Space>
              )
            }
          />
        </>
      )}
      {outgoing.length > 0 && (
        <>
          <Title level={5}>Waiting for the other club</Title>
          <TransferTable
            transfers={outgoing}
            csvName={`${club.name} transfers out`}
            actions={(t) => canCancel(t) && <Button size="small" disabled={busy} onClick={() => run(() => api.cancelTransfer(t.id))}>Withdraw</Button>}
          />
        </>
      )}
      {history.length > 0 && (
        <>
          <Title level={5}>History</Title>
          <TransferTable transfers={history} showStatus csvName={`${club.name} transfer history`} />
        </>
      )}
    </Section>
  )
}

function TransferTable({ transfers, actions, showStatus, csvName = 'Transfers' }) {
  const columns = [
    { title: 'Athlete', key: 'athlete', render: (_, t) => t.athlete?.name ?? '—' },
    { title: 'From', key: 'from', render: (_, t) => t.from_club?.name ?? '—' },
    { title: 'To', key: 'to', render: (_, t) => t.to_club?.name ?? '—' },
    { title: 'Asked by', key: 'by', render: (_, t) => personName(t.requester) },
    { title: 'When', key: 'when', value: (t) => t.decided_at ?? t.requested_at, render: (_, t) => formatWhen(t.decided_at ?? t.requested_at) },
    { title: 'Note', key: 'note', render: (_, t) => t.note || '' },
    showStatus && { title: 'Outcome', key: 'status', value: (t) => transferLabels[t.status], render: (_, t) => <Badge muted={['declined', 'cancelled'].includes(t.status)}>{transferLabels[t.status]}</Badge> },
    actions && { key: 'actions', className: 'actions', render: (_, t) => actions(t) },
  ].filter(Boolean)
  return <DataTable rowKey="id" columns={columns} dataSource={transfers} className="gap" csvName={csvName} />
}

// Owners and Coaches. Club owners invite people; a site Admin approves each invite.
function ClubPeople({ club, users, may, onChange }) {
  // Site Admins pick from everyone; club owners only see their own club's people, so they type an email.
  const [form, setForm] = useState({ userId: '', email: '', role: 'coach' })
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  const memberIds = new Set(club.members.map((m) => m.user_id))
  const addable = users.filter((u) => u.id && u.state === 'Active' && !memberIds.has(u.id))
  const order = { owner: 0, coach: 1 }
  const members = [...club.members].sort(
    (a, b) => (a.status === b.status ? 0 : a.status === 'pending' ? 1 : -1) || order[a.role] - order[b.role] || personName(a.user).localeCompare(personName(b.user)),
  )

  async function run(action, done) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await action()
      await onChange()
      if (done) setMessage(typeof done === 'function' ? done() : done)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function invite(e) {
    e.preventDefault()
    if (may.siteAdmin) {
      if (!form.userId) return
      run(async () => {
        await api.addClubMember(club.id, form.userId, form.role, { approved: true })
        setForm({ ...form, userId: '' })
      })
      return
    }
    if (!form.email.trim()) return
    let name = form.email.trim()
    run(async () => {
      name = (await api.inviteClubMember(club.id, form.email.trim(), form.role)) || name
      setForm({ ...form, email: '' })
    }, () => `${name} is invited. A site Admin has to approve it before they join.`)
  }

  const roleOptions = [{ value: 'owner', label: 'Owner' }, { value: 'coach', label: 'Coach' }]
  const columns = [
    { title: 'Name', key: 'name', render: (_, m) => m.user?.name || '—' },
    { title: 'Email', key: 'email', render: (_, m) => m.user?.email || '—' },
    {
      title: 'Role',
      key: 'role',
      value: (m) => roleLabels[m.role],
      render: (_, m) => (may.siteAdmin ? (
        <Pick
          size="small"
          style={{ width: 110 }}
          value={m.role}
          disabled={busy}
          aria-label={`Role for ${personName(m.user)}`}
          onChange={(value) => run(() => api.setClubMemberRole(club.id, m.user_id, value))}
          options={roleOptions}
        />
      ) : (
        <RoleBadge role={m.role} />
      )),
    },
    { title: 'Status', key: 'status', value: (m) => (m.status === 'pending' ? 'Waiting for Admin' : 'Member'), render: (_, m) => (m.status === 'pending' ? <Badge muted>Waiting for Admin</Badge> : <Badge>Member</Badge>) },
    may.manage && {
      key: 'actions',
      className: 'actions',
      render: (_, m) => (
        <Space>
          {may.siteAdmin && m.status === 'pending' && (
            <Button size="small" type="primary" disabled={busy} onClick={() => run(() => api.approveClubMember(club.id, m.user_id))}>Approve</Button>
          )}
          <Button size="small" disabled={busy} onClick={() => run(() => api.removeClubMember(club.id, m.user_id))}>
            {m.status === 'pending' ? (may.siteAdmin ? 'Decline' : 'Withdraw') : 'Remove'}
          </Button>
        </Space>
      ),
    },
  ].filter(Boolean)

  return (
    <Section title="People">
      <Muted>Owners look after the club's athletes, invite people and accept transfers. Coaches see the athletes and can ask to transfer them.</Muted>
      {may.manage && (
        <FormCard
          onSubmit={invite}
          actions={<Button type="primary" htmlType="submit" disabled={busy || (may.siteAdmin ? !form.userId : !form.email.trim())}>{may.siteAdmin ? 'Add' : 'Invite'}</Button>}
        >
          {may.siteAdmin ? (
            <Field label="Add a person">
              <Pick
                value={form.userId}
                onChange={(userId) => setForm({ ...form, userId })}
                placeholder={users === usersLoading ? 'Loading people…' : addable.length ? 'Choose a user…' : 'Everyone is already in this club'}
                options={addable.map((u) => ({ value: u.id, label: userLabel(u) }))}
              />
            </Field>
          ) : (
            <Field label="Invite a person" hint="the email they sign in with">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" />
            </Field>
          )}
          <Field label="As">
            <Pick value={form.role} onChange={(role) => setForm({ ...form, role })} options={[{ value: 'coach', label: 'Coach' }, { value: 'owner', label: 'Owner' }]} />
          </Field>
        </FormCard>
      )}
      {may.manage && (
        <CsvImport
          kind="clubPeople"
          title={`${may.siteAdmin ? 'Add' : 'Invite'} people from a CSV file`}
          context={{ usersByEmail: byEmail(users), memberIds, byEmail: !may.siteAdmin }}
          importRow={({ userId, email, role }) => (may.siteAdmin
            ? api.addClubMember(club.id, userId, role, { approved: true })
            : api.inviteClubMember(club.id, email, role))}
          onDone={onChange}
        >
          {!may.siteAdmin && <Muted>A site Admin has to approve each invitation before they join.</Muted>}
        </CsvImport>
      )}
      <SuccessAlert>{message}</SuccessAlert>
      <ErrorAlert>{error}</ErrorAlert>
      {members.length === 0 ? (
        <Muted>Nobody yet.{may.siteAdmin && ' Add an Owner above.'}</Muted>
      ) : (
        <DataTable rowKey="user_id" columns={columns} dataSource={members} csvName={`${club.name} people`} />
      )}
    </Section>
  )
}
