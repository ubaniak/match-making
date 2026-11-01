import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import AthleteForm from './AthleteForm'
import { formatBouts, formatWeight, genderLabel } from './athletes'

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
      <h1>Clubs</h1>
      {siteAdmin && <NewClubForm onCreated={onOpen} />}
      {siteAdmin && <PendingInvites onChange={reload} />}
      {error && <p className="error">{error}</p>}
      {clubs === null && !error && <p className="muted">Loading…</p>}
      {clubs?.length === 0 && <p className="muted">{siteAdmin ? 'No clubs yet. Create one above.' : 'No clubs yet.'}</p>}
      {mine.length > 0 && <ClubTable title="Your clubs" clubs={mine} profile={profile} onOpen={onOpen} />}
      {others.length > 0 && <ClubTable title={mine.length ? 'Other clubs' : 'All clubs'} clubs={others} profile={profile} onOpen={onOpen} />}
    </>
  )
}

function ClubTable({ title, clubs, profile, onOpen }) {
  return (
    <section>
      <h2>{title}</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>Club</th><th>Owners</th><th>Athletes</th><th>Your role</th></tr>
          </thead>
          <tbody>
            {clubs.map((c) => (
              <tr key={c.id}>
                <td><button className="link" onClick={() => onOpen(c.id)}>{c.name}</button></td>
                <td>{c.members.filter((m) => m.role === 'owner' && m.status === 'active').map((m) => personName(m.user)).join(', ') || '—'}</td>
                <td>{c.athlete_count}</td>
                <td><RoleBadge role={myClubRole(c, profile)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function RoleBadge({ role }) {
  if (!role) return '—'
  return <span className={`badge role-${role}`}>{roleLabels[role]}</span>
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
      <form onSubmit={save} className="row-form">
        <h2>New club</h2>
        <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Eastside BC" /></label>
        <label>
          Owner <span className="muted">(add more on the club's page)</span>
          <select value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}>
            <option value="">No owner yet</option>
            {users.map((u) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
          </select>
        </label>
        <button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create club'}</button>
      </form>
      {error && <p className="error">{error}</p>}
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
  return (
    <section>
      <h2>Club invites waiting for approval ({invites.length})</h2>
      {error && <p className="error">{error}</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>Person</th><th>Club</th><th>As</th><th>Invited by</th><th /></tr>
          </thead>
          <tbody>
            {invites.map((i) => (
              <tr key={`${i.club_id}-${i.user_id}`}>
                <td>{personName(i.user)}</td>
                <td>{i.club?.name}</td>
                <td>{roleLabels[i.role]}</td>
                <td>{personName(i.inviter)}</td>
                <td className="actions">
                  <button className="link" disabled={busy} onClick={() => run(() => api.approveClubMember(i.club_id, i.user_id))}>Approve</button>
                  <button className="link" disabled={busy} onClick={() => run(() => api.removeClubMember(i.club_id, i.user_id))}>Decline</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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

  const backLink = <button className="link back" onClick={onBack}>← All clubs</button>
  if (club === undefined) return <>{backLink}{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</>
  if (club === null) return <>{backLink}<p>That club no longer exists.</p></>

  const role = myClubRole(club, profile)
  const may = {
    siteAdmin,
    manage: siteAdmin || role === 'owner',
    member: siteAdmin || Boolean(role),
  }

  async function remove() {
    if (!window.confirm(`Delete ${club.name}? This only works once it has no athletes.`)) return
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
        <div className="heading-row">
          <h1>{club.name}</h1>
          {siteAdmin && <button className="secondary" onClick={() => setRenaming(true)}>Rename</button>}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <dl className="facts">
        <div><dt>Athletes</dt><dd>{club.athletes.length}</dd></div>
        <div><dt>Your role</dt><dd>{siteAdmin ? <span className="badge">Site admin</span> : <RoleBadge role={role} />}</dd></div>
      </dl>

      <ClubAthletes club={club} clubs={clubs} users={users} may={may} onChange={reload} />
      <Transfers club={club} may={may} role={role} profile={profile} onChange={reload} />
      <ClubPeople club={club} users={users} may={may} onChange={reload} />

      {siteAdmin && <p><button className="link danger" onClick={remove}>Delete this club</button></p>}
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
      <form onSubmit={save} className="row-form compact">
        <label>Club name<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button type="submit">Save</button>
        <button type="button" className="secondary" onClick={onDone}>Cancel</button>
      </form>
      {error && <p className="error">{error}</p>}
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

  return (
    <section>
      <h2>Athletes ({club.athletes.length})</h2>
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
      {error && <p className="error">{error}</p>}
      {club.athletes.length === 0 ? (
        <p className="muted">No athletes in this club yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Name</th><th>Born</th><th>Gender</th><th>Weight</th><th>Experience</th><th>Coach</th>{may.member && <th />}</tr>
            </thead>
            <tbody>
              {club.athletes.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td>{a.date_of_birth || '—'}</td>
                  <td>{genderLabel(a.gender)}</td>
                  <td>{formatWeight(a.weight_kg)}</td>
                  <td>{formatBouts(a.bouts)}</td>
                  <td>{a.coach ? a.coach.name || a.coach.email : '—'}</td>
                  {may.member && (
                    <td className="actions">
                      {may.manage && <button className="link" onClick={() => { setError(null); setMoving(null); setEditing(a.id) }}>Edit</button>}
                      {waiting.has(a.id) ? (
                        <span className="muted"> Transfer waiting</span>
                      ) : (
                        <button className="link" onClick={() => { setError(null); setEditing(null); setMoving({ athlete: a, mode: 'transfer' }) }}>Transfer</button>
                      )}
                      {may.siteAdmin && <button className="link" onClick={() => { setError(null); setEditing(null); setMoving({ athlete: a, mode: 'move' }) }}>Move</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
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
    onSubmit(toClubId, { note, override })
  }

  return (
    <form onSubmit={submit} className="row-form">
      <h2>{moving ? `Move ${athlete.name}` : `Transfer ${athlete.name}`}</h2>
      <p className="muted full">
        {moving
          ? 'Moves the athlete now, with their bout count and history. Any waiting transfer request is withdrawn.'
          : 'The other club\'s Owner accepts or declines. Their bout count and history go with them.'}
        {' '}Athletes entered in an Active event can't change clubs until it's Done.
      </p>
      <label>
        To club
        <select required value={toClubId} onChange={(e) => setToClubId(e.target.value)}>
          <option value="">Choose a club…</option>
          {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      {!moving && (
        <label>Note <span className="muted">(optional)</span><input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      )}
      {moving && (
        <label className="checkbox">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
          Move anyway, even during an Active event
        </label>
      )}
      <button type="submit" disabled={busy || !toClubId}>{moving ? 'Move' : 'Send request'}</button>
      <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
    </form>
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
    <section>
      <h2>Transfers</h2>
      {error && <p className="error">{error}</p>}
      {incoming.length === 0 && outgoing.length === 0 && history.length === 0 && <p className="muted">No transfers yet.</p>}
      {incoming.length > 0 && (
        <>
          <h3>Asking to join {club.name}</h3>
          {may.siteAdmin && (
            <label className="checkbox">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Accept even during an Active event
            </label>
          )}
          <TransferTable
            transfers={incoming}
            actions={(t) =>
              canDecide && (
                <>
                  <button className="link" disabled={busy} onClick={() => run(() => api.decideTransfer(t.id, true, override))}>Accept</button>
                  <button className="link" disabled={busy} onClick={() => run(() => api.decideTransfer(t.id, false))}>Decline</button>
                </>
              )
            }
          />
        </>
      )}
      {outgoing.length > 0 && (
        <>
          <h3>Waiting for the other club</h3>
          <TransferTable
            transfers={outgoing}
            actions={(t) => canCancel(t) && <button className="link" disabled={busy} onClick={() => run(() => api.cancelTransfer(t.id))}>Withdraw</button>}
          />
        </>
      )}
      {history.length > 0 && (
        <>
          <h3>History</h3>
          <TransferTable transfers={history} showStatus />
        </>
      )}
    </section>
  )
}

function TransferTable({ transfers, actions, showStatus }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr><th>Athlete</th><th>From</th><th>To</th><th>Asked by</th><th>When</th><th>Note</th>{showStatus && <th>Outcome</th>}{actions && <th />}</tr>
        </thead>
        <tbody>
          {transfers.map((t) => (
            <tr key={t.id}>
              <td>{t.athlete?.name ?? '—'}</td>
              <td>{t.from_club?.name ?? '—'}</td>
              <td>{t.to_club?.name ?? '—'}</td>
              <td>{personName(t.requester)}</td>
              <td>{formatWhen(t.decided_at ?? t.requested_at)}</td>
              <td>{t.note || ''}</td>
              {showStatus && <td><span className={`badge transfer-${t.status}`}>{transferLabels[t.status]}</span></td>}
              {actions && <td className="actions">{actions(t)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
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

  return (
    <section>
      <h2>People</h2>
      <p className="muted">Owners look after the club's athletes, invite people and accept transfers. Coaches see the athletes and can ask to transfer them.</p>
      {may.manage && (
        <form onSubmit={invite} className="row-form">
          <label>
            {may.siteAdmin ? 'Add a person' : 'Invite a person'}
            <select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
              <option value="">{addable.length ? 'Choose a user…' : 'Everyone is already in this club'}</option>
              {addable.map((u) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
            </select>
          </label>
          <label>
            As
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="coach">Coach</option>
              <option value="owner">Owner</option>
            </select>
          </label>
          <button type="submit" disabled={busy || !form.userId}>{may.siteAdmin ? 'Add' : 'Invite'}</button>
        </form>
      )}
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
      {members.length === 0 ? (
        <p className="muted">Nobody yet.{may.siteAdmin && ' Add an Owner above.'}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th>{may.manage && <th />}</tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id}>
                  <td>{m.user?.name || '—'}</td>
                  <td>{m.user?.email || '—'}</td>
                  <td>
                    {may.siteAdmin ? (
                      <select value={m.role} disabled={busy} aria-label={`Role for ${personName(m.user)}`}
                        onChange={(e) => run(() => api.setClubMemberRole(club.id, m.user_id, e.target.value))}>
                        <option value="owner">Owner</option>
                        <option value="coach">Coach</option>
                      </select>
                    ) : (
                      <RoleBadge role={m.role} />
                    )}
                  </td>
                  <td>{m.status === 'pending' ? <span className="badge invited">Waiting for Admin</span> : <span className="badge active">Member</span>}</td>
                  {may.manage && (
                    <td className="actions">
                      {may.siteAdmin && m.status === 'pending' && (
                        <button className="link" disabled={busy} onClick={() => run(() => api.approveClubMember(club.id, m.user_id))}>Approve</button>
                      )}
                      <button className="link" disabled={busy} onClick={() => run(() => api.removeClubMember(club.id, m.user_id))}>
                        {m.status === 'pending' ? (may.siteAdmin ? 'Decline' : 'Withdraw') : 'Remove'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
