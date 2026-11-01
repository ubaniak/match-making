import { useCallback, useEffect, useState } from 'react'
import { Button, Checkbox, Descriptions, Input, Popconfirm, Space, Table } from 'antd'
import { DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { api } from './api'
import AthleteForm from './AthleteForm'
import { formatBouts, formatWeight, genderLabel } from './athletes'
import { askConfirm, dash, tableProps } from './dialogs'
import { BackLink, Badge, PageHeading, ErrorAlert, Field, FormCard, FullRow, Muted, Pick, Section, SuccessAlert, Text, Title } from './ui'

const roleLabels = { owner: 'Owner', coach: 'Coach' }
const personName = (user) => (user ? user.name || user.email : '—')
const userLabel = (u) => (u.name ? `${u.name} (${u.email})` : u.email)
const transferLabels = { pending: 'Waiting', accepted: 'Accepted', declined: 'Declined', cancelled: 'Withdrawn', moved: 'Moved by Admin' }
const formatWhen = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '')

function myClubRole(club, profile) {
  return club.members.find((m) => m.user_id === profile?.id && m.status === 'active')?.role ?? null
}

function useUsers() {
  const [users, setUsers] = useState([])
  useEffect(() => {
    api.listUsers().then(setUsers, () => setUsers([]))
  }, [])
  return users
}

// Clubs: site Admins create them and assign Owners. Owners invite people (a site Admin approves),
// look after the club's athletes and accept transfers in.
export default function ClubsPage({ profile, can }) {
  const siteAdmin = can('users:manage')
  const [view, setView] = useState({ name: 'list' })

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
      {siteAdmin && <PendingInvites onChange={reload} />}
      <ErrorAlert>{error}</ErrorAlert>
      {clubs === null && !error && <Muted>Loading…</Muted>}
      {clubs?.length === 0 && <Muted>{siteAdmin ? 'No clubs yet. Create one above.' : 'No clubs yet.'}</Muted>}
      {mine.length > 0 && <ClubTable title="Your clubs" clubs={mine} profile={profile} onOpen={onOpen} />}
      {others.length > 0 && <ClubTable title={mine.length ? 'Other clubs' : 'All clubs'} clubs={others} profile={profile} onOpen={onOpen} />}
    </>
  )
}

function ClubTable({ title, clubs, profile, onOpen }) {
  const columns = [
    { title: 'Club', key: 'name', render: (_, c) => <Button type="link" size="small" style={{ padding: 0 }} onClick={() => onOpen(c.id)}>{c.name}</Button> },
    { title: 'Owners', key: 'owners', render: (_, c) => c.members.filter((m) => m.role === 'owner' && m.status === 'active').map((m) => personName(m.user)).join(', ') || '—' },
    { title: 'Athletes', dataIndex: 'athlete_count', key: 'athletes' },
    { title: 'Your role', key: 'role', render: (_, c) => <RoleBadge role={myClubRole(c, profile)} /> },
  ]
  return (
    <Section title={title}>
      <Table {...tableProps} rowKey="id" columns={columns} dataSource={clubs} />
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
      <Table {...tableProps} rowKey={(i) => `${i.club_id}-${i.user_id}`} columns={columns} dataSource={invites} />
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
      const [detail, all] = await Promise.all([api.getClub(id), api.listClubs()])
      setClub(detail)
      setClubs(all)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [id])

  useEffect(() => {
    reload()
  }, [reload])

  const backLink = <BackLink onClick={onBack}>All clubs</BackLink>
  if (club === undefined) return <>{backLink}{error ? <ErrorAlert>{error}</ErrorAlert> : <Muted>Loading…</Muted>}</>
  if (club === null) return <>{backLink}<p>That club no longer exists.</p></>

  const role = myClubRole(club, profile)
  const may = {
    siteAdmin,
    manage: siteAdmin || role === 'owner',
    member: siteAdmin || Boolean(role),
  }

  async function remove() {
    if (!(await askConfirm(`Delete ${club.name}? This only works once it has no athletes.`, { okText: 'Delete', danger: true }))) return
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
    { title: 'Weight', key: 'weight', render: (_, a) => formatWeight(a.weight_kg) },
    { title: 'Experience', key: 'bouts', render: (_, a) => formatBouts(a.bouts) },
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
        <Table {...tableProps} rowKey="id" columns={columns} dataSource={club.athletes} />
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
            actions={(t) => canCancel(t) && <Button size="small" disabled={busy} onClick={() => run(() => api.cancelTransfer(t.id))}>Withdraw</Button>}
          />
        </>
      )}
      {history.length > 0 && (
        <>
          <Title level={5}>History</Title>
          <TransferTable transfers={history} showStatus />
        </>
      )}
    </Section>
  )
}

function TransferTable({ transfers, actions, showStatus }) {
  const columns = [
    { title: 'Athlete', key: 'athlete', render: (_, t) => t.athlete?.name ?? '—' },
    { title: 'From', key: 'from', render: (_, t) => t.from_club?.name ?? '—' },
    { title: 'To', key: 'to', render: (_, t) => t.to_club?.name ?? '—' },
    { title: 'Asked by', key: 'by', render: (_, t) => personName(t.requester) },
    { title: 'When', key: 'when', render: (_, t) => formatWhen(t.decided_at ?? t.requested_at) },
    { title: 'Note', key: 'note', render: (_, t) => t.note || '' },
    showStatus && { title: 'Outcome', key: 'status', render: (_, t) => <Badge muted={['declined', 'cancelled'].includes(t.status)}>{transferLabels[t.status]}</Badge> },
    actions && { key: 'actions', className: 'actions', render: (_, t) => actions(t) },
  ].filter(Boolean)
  return <Table {...tableProps} rowKey="id" columns={columns} dataSource={transfers} className="gap" />
}

// Owners and Coaches. Club owners invite people; a site Admin approves each invite.
function ClubPeople({ club, users, may, onChange }) {
  const [form, setForm] = useState({ userId: '', role: 'coach' })
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
      if (done) setMessage(done)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function invite(e) {
    e.preventDefault()
    if (!form.userId) return
    const user = users.find((u) => u.id === form.userId)
    run(async () => {
      await api.addClubMember(club.id, form.userId, form.role, { approved: may.siteAdmin })
      setForm({ userId: '', role: form.role })
    }, may.siteAdmin ? null : `${personName(user)} is invited. A site Admin has to approve it before they join.`)
  }

  const roleOptions = [{ value: 'owner', label: 'Owner' }, { value: 'coach', label: 'Coach' }]
  const columns = [
    { title: 'Name', key: 'name', render: (_, m) => m.user?.name || '—' },
    { title: 'Email', key: 'email', render: (_, m) => m.user?.email || '—' },
    {
      title: 'Role',
      key: 'role',
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
    { title: 'Status', key: 'status', render: (_, m) => (m.status === 'pending' ? <Badge muted>Waiting for Admin</Badge> : <Badge>Member</Badge>) },
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
          actions={<Button type="primary" htmlType="submit" disabled={busy || !form.userId}>{may.siteAdmin ? 'Add' : 'Invite'}</Button>}
        >
          <Field label={may.siteAdmin ? 'Add a person' : 'Invite a person'}>
            <Pick
              value={form.userId}
              onChange={(userId) => setForm({ ...form, userId })}
              placeholder={addable.length ? 'Choose a user…' : 'Everyone is already in this club'}
              options={addable.map((u) => ({ value: u.id, label: userLabel(u) }))}
            />
          </Field>
          <Field label="As">
            <Pick value={form.role} onChange={(role) => setForm({ ...form, role })} options={[{ value: 'coach', label: 'Coach' }, { value: 'owner', label: 'Owner' }]} />
          </Field>
        </FormCard>
      )}
      <SuccessAlert>{message}</SuccessAlert>
      <ErrorAlert>{error}</ErrorAlert>
      {members.length === 0 ? (
        <Muted>Nobody yet.{may.siteAdmin && ' Add an Owner above.'}</Muted>
      ) : (
        <Table {...tableProps} rowKey="user_id" columns={columns} dataSource={members} />
      )}
    </Section>
  )
}
