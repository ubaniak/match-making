import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { formatBouts, formatWeight, genderLabel } from './athletes'
import { categorise, compareByCategory } from './categories'
import { MAX_EVENT_DAYS, daysBetween, formatDateRange, formatDay, formatTime, todayIso } from './dates'

const roleLabels = { owner: 'Owner', admin: 'Admin', coach: 'Coach', viewer: 'Viewer' }

// What each event role can do. Site Admins count as Owner everywhere.
const rights = {
  owner: { edit: true, members: true, athletes: true, removeAnyAthlete: true, transfer: true, remove: true },
  admin: { edit: true, members: true, athletes: true, removeAnyAthlete: true },
  coach: { athletes: true },
  viewer: {},
}

function myEventRole(event, profile, can) {
  if (can('users:manage')) return 'owner'
  return event.members.find((m) => m.user_id === profile?.id)?.role ?? null
}

const ownerOf = (event) => event.members.find((m) => m.role === 'owner')?.user
const personName = (user) => (user ? user.name || user.email : '—')

// Events: any user can create one and becomes its Owner. People are added to an event
// as Admin, Coach or Viewer, and only see the events they belong to.
export default function EventsPage({ profile, can }) {
  const [view, setView] = useState({ name: 'list' })
  const back = () => setView({ name: 'list' })

  return (
    <main className="panel">
      {view.name === 'list' && (
        <EventList
          canCreate={can('events:create')}
          profile={profile}
          can={can}
          onOpen={(id) => setView({ name: 'event', id })}
          onCreate={() => setView({ name: 'new' })}
        />
      )}
      {view.name === 'new' && (
        <>
          <button className="link back" onClick={back}>← All events</button>
          <h1>New event</h1>
          <p className="muted">You'll be the event's Owner. You can add Admins, Coaches and Viewers once it's created.</p>
          <EventForm onCancel={back} onSaved={(id) => setView({ name: 'event', id })} />
        </>
      )}
      {view.name === 'event' && <EventDetail id={view.id} profile={profile} can={can} onBack={back} />}
    </main>
  )
}

function EventList({ canCreate, profile, can, onOpen, onCreate }) {
  const [events, setEvents] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.listEvents().then(setEvents, (err) => setError(err.message))
  }, [])

  const today = todayIso()
  const upcoming = events?.filter((e) => e.end_date >= today) ?? []
  const past = (events?.filter((e) => e.end_date < today) ?? []).reverse()

  return (
    <>
      <div className="heading-row">
        <h1>Events</h1>
        {canCreate && <button onClick={onCreate}>New event</button>}
      </div>
      {error && <p className="error">{error}</p>}
      {events === null && !error && <p className="muted">Loading…</p>}
      {events?.length === 0 && (
        <p className="muted">
          {canCreate ? 'No events yet. Create one, or ask an event\'s Owner to add you.' : 'You haven\'t been added to any events yet.'}
        </p>
      )}
      {upcoming.length > 0 && <EventTable title="Upcoming" events={upcoming} profile={profile} can={can} onOpen={onOpen} />}
      {past.length > 0 && <EventTable title="Past" events={past} profile={profile} can={can} onOpen={onOpen} />}
    </>
  )
}

function EventTable({ title, events, profile, can, onOpen }) {
  return (
    <section>
      <h2>{title}</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>Event</th><th>Dates</th><th>Venue</th><th>Owner</th><th>Your role</th><th>Athletes</th></tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td><button className="link" onClick={() => onOpen(e.id)}>{e.name}</button></td>
                <td>
                  {formatDateRange(e.start_date, e.end_date)}
                  {e.days.length > 1 && <span className="muted"> ({e.days.length} days)</span>}
                </td>
                <td>{e.venue || '—'}</td>
                <td>{personName(ownerOf(e))}</td>
                <td><RoleBadge role={e.members.find((m) => m.user_id === profile?.id)?.role ?? (can('users:manage') ? 'site-admin' : null)} /></td>
                <td>{e.athlete_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function EventDetail({ id, profile, can, onBack }) {
  const [event, setEvent] = useState(undefined)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)

  const reload = useCallback(async () => {
    try {
      setEvent(await api.getEvent(id))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [id])

  useEffect(() => {
    reload()
  }, [reload])

  async function remove() {
    if (!window.confirm(`Delete ${event.name}? Its schedule and athlete list go with it.`)) return
    try {
      await api.deleteEvent(id)
      onBack()
    } catch (err) {
      setError(err.message)
    }
  }

  const backLink = <button className="link back" onClick={onBack}>← All events</button>

  if (event === undefined) return <>{backLink}{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</>
  if (event === null) return <>{backLink}<p>That event no longer exists.</p></>

  const role = myEventRole(event, profile, can)
  const may = rights[role] ?? {}

  if (editing) {
    return (
      <>
        {backLink}
        <h1>Edit {event.name}</h1>
        <EventForm
          event={event}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            reload()
          }}
        />
      </>
    )
  }

  return (
    <>
      {backLink}
      <div className="heading-row">
        <h1>{event.name}</h1>
        {may.edit && <button className="secondary" onClick={() => setEditing(true)}>Edit event</button>}
        {may.remove && <button className="secondary danger" onClick={remove}>Delete</button>}
      </div>
      {error && <p className="error">{error}</p>}
      <dl className="facts">
        <div><dt>Dates</dt><dd>{formatDateRange(event.start_date, event.end_date)}</dd></div>
        <div><dt>Venue</dt><dd>{event.venue || '—'}</dd></div>
        <div><dt>Owner</dt><dd>{personName(ownerOf(event))}</dd></div>
        <div><dt>Your role</dt><dd><RoleBadge role={event.members.find((m) => m.user_id === profile?.id)?.role ?? 'site-admin'} /></dd></div>
      </dl>

      <h2>Schedule</h2>
      <table>
        <thead>
          <tr><th>Day</th><th>Weigh-in</th><th>Bouts start</th></tr>
        </thead>
        <tbody>
          {event.days.map((d) => (
            <tr key={d.day}>
              <td>{formatDay(d.day)}</td>
              <td>{formatTime(d.weigh_in_time)}</td>
              <td>{formatTime(d.bouts_time)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <EventAthletes event={event} may={may} profile={profile} onChange={reload} />
      <EventMembers event={event} may={may} onChange={reload} />
    </>
  )
}

function EventAthletes({ event, may, profile, onChange }) {
  const canAdd = Boolean(may.athletes)
  const canRemove = (athlete) => may.removeAnyAthlete || (may.athletes && athlete.added_by === profile?.id)
  const [allAthletes, setAllAthletes] = useState([])
  const [choice, setChoice] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (canAdd) api.listAthletes().then(setAllAthletes, (err) => setError(err.message))
  }, [canAdd])

  const entered = useMemo(() => new Set(event.athletes.map((a) => a.id)), [event.athletes])
  // Each athlete's age group, weight class and experience level for this event, in division order.
  const athletes = useMemo(
    () => event.athletes.map((a) => ({ ...a, categories: categorise(a, event.start_date) })).sort(compareByCategory),
    [event.athletes, event.start_date],
  )
  const available = allAthletes.filter((a) => !entered.has(a.id))

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

  function add(e) {
    e.preventDefault()
    if (!choice) return
    run(async () => {
      await api.addEventAthlete(event.id, choice)
      setChoice('')
    })
  }

  return (
    <section>
      <h2>Athletes ({event.athletes.length})</h2>
      {canAdd && (
        <form onSubmit={add} className="row-form">
          <label>
            Add an athlete
            <select value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">{available.length ? 'Choose an athlete…' : 'Every athlete is already entered'}</option>
              {available.map((a) => (
                <option key={a.id} value={a.id}>
                  {[a.name, genderLabel(a.gender), formatWeight(a.weight_kg), a.club].filter((v) => v && v !== '—').join(' · ')}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy || !choice}>Add</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      {event.athletes.length === 0 ? (
        <p className="muted">No athletes entered yet.</p>
      ) : (
        <>
        <p className="muted">
          Age group is by year of birth as of {event.start_date.slice(0, 4)}. Weight class uses the athlete's current weight.
          Novice is 10 bouts or fewer, Open is more.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Name</th><th>Age group</th><th>Gender</th><th>Weight class</th><th>Experience</th><th>Club</th><th>Coach</th>{canAdd && <th />}</tr>
            </thead>
            <tbody>
              {athletes.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td><AgeCell category={a.categories.age} /></td>
                  <td>{genderLabel(a.gender)}</td>
                  <td><WeightCell category={a.categories.weight} weightKg={a.weight_kg} /></td>
                  <td><ExperienceCell category={a.categories.experience} bouts={a.bouts} /></td>
                  <td>{a.club || '—'}</td>
                  <td>{a.coach ? a.coach.name || a.coach.email : '—'}</td>
                  {canAdd && (
                    <td className="actions">
                      {canRemove(a) && (
                        <button className="link" disabled={busy} onClick={() => run(() => api.removeEventAthlete(event.id, a.id))}>
                          Remove
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </section>
  )
}

function AgeCell({ category }) {
  if (!category) return '—'
  return (
    <>
      <span className={`badge category${category.key === 'too-young' ? ' warning' : ''}`}>{category.label}</span>
      <span className="muted"> {category.age}</span>
    </>
  )
}

function WeightCell({ category, weightKg }) {
  if (!category) return <>{formatWeight(weightKg)}{weightKg != null && <span className="muted"> (no class)</span>}</>
  return (
    <>
      <span className={`badge category${category.below ? ' warning' : ''}`} title={category.name}>{category.label}</span>
      <span className="muted"> {formatWeight(weightKg)}</span>
    </>
  )
}

function ExperienceCell({ category, bouts }) {
  if (!category) return '—'
  return (
    <>
      <span className={`badge category ${category.key}`}>{category.label}</span>
      <span className="muted"> {formatBouts(bouts)}</span>
    </>
  )
}

const defaultTimes = { weigh_in_time: '08:00', bouts_time: '12:00' }

function EventForm({ event, onCancel, onSaved }) {
  const [form, setForm] = useState({
    name: event?.name ?? '',
    venue: event?.venue ?? '',
    startDate: event?.start_date ?? '',
    endDate: event?.end_date ?? '',
  })
  // Times typed so far, by day, so changing the dates keeps them.
  const [times, setTimes] = useState(() => Object.fromEntries((event?.days ?? []).map((d) => [d.day, d])))
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const days = daysBetween(form.startDate, form.endDate)
  const datesBackwards = form.startDate && form.endDate && form.endDate < form.startDate
  const tooLong = form.startDate && form.endDate && !datesBackwards && days.length === 0

  // A new day starts with the times of the day before it.
  const schedule = []
  for (const day of days) {
    const previous = schedule.at(-1)
    schedule.push({ day, ...(times[day] ?? (previous ? { weigh_in_time: previous.weigh_in_time, bouts_time: previous.bouts_time } : defaultTimes)) })
  }

  function setField(key, value) {
    setForm((current) => {
      const next = { ...current, [key]: value }
      // Picking a start date fills the end date, so a one-day event needs one pick.
      if (key === 'startDate' && (!current.endDate || current.endDate === current.startDate || current.endDate < value)) {
        next.endDate = value
      }
      return next
    })
  }

  function setTime(day, key, value) {
    const row = schedule.find((d) => d.day === day)
    setTimes((current) => ({ ...current, [day]: { ...row, [key]: value } }))
  }

  async function save(e) {
    e.preventDefault()
    setError(null)
    if (days.length === 0) return setError('Check the dates: the end date must be on or after the start date.')
    setSaving(true)
    try {
      const id = await api.saveEvent({ id: event?.id, ...form, days: schedule })
      onSaved(id)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const field = (key) => ({ value: form[key], onChange: (e) => setField(key, e.target.value) })

  return (
    <form onSubmit={save} className="event-form">
      <div className="row-form">
        <h2>Details</h2>
        <label>Name<input required {...field('name')} placeholder="e.g. Winter Box Cup" /></label>
        <label>Venue <span className="muted">(optional)</span><input {...field('venue')} /></label>
      </div>

      <div className="row-form">
        <h2>Dates</h2>
        <label>Start date<input type="date" required {...field('startDate')} /></label>
        <label>
          End date <span className="muted">(same as start for one day)</span>
          <input type="date" required min={form.startDate || undefined} {...field('endDate')} />
        </label>
        {datesBackwards && <p className="error full">The end date is before the start date.</p>}
        {tooLong && <p className="error full">An event can be at most {MAX_EVENT_DAYS} days long.</p>}
      </div>

      {schedule.length > 0 && (
        <div className="row-form">
          <h2>Times {schedule.length > 1 && <span className="muted">for each of the {schedule.length} days</span>}</h2>
          <table className="schedule">
            <thead>
              <tr><th>Day</th><th>Weigh-in</th><th>Bouts start</th></tr>
            </thead>
            <tbody>
              {schedule.map((d) => (
                <tr key={d.day}>
                  <td>{formatDay(d.day)}</td>
                  <td><input type="time" required value={d.weigh_in_time} onChange={(e) => setTime(d.day, 'weigh_in_time', e.target.value)} aria-label={`Weigh-in on ${formatDay(d.day)}`} /></td>
                  <td><input type="time" required value={d.bouts_time} onChange={(e) => setTime(d.day, 'bouts_time', e.target.value)} aria-label={`Bouts on ${formatDay(d.day)}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : event ? 'Save changes' : 'Create event'}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function RoleBadge({ role }) {
  if (!role) return '—'
  if (role === 'site-admin') return <span className="badge">Site admin</span>
  return <span className={`badge role-${role}`}>{roleLabels[role]}</span>
}

// Who's on the event and in what role. Owners and Admins manage it; ownership moves with "Make owner".
function EventMembers({ event, may, onChange }) {
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({ userId: '', role: 'coach' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (may.members) api.listUsers().then(setUsers, (err) => setError(err.message))
  }, [may.members])

  const memberIds = new Set(event.members.map((m) => m.user_id))
  const addable = users.filter((u) => u.id && u.state === 'Active' && !memberIds.has(u.id))
  const order = ['owner', 'admin', 'coach', 'viewer']
  const members = [...event.members].sort(
    (a, b) => order.indexOf(a.role) - order.indexOf(b.role) || personName(a.user).localeCompare(personName(b.user)),
  )

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

  function add(e) {
    e.preventDefault()
    if (!form.userId) return
    run(async () => {
      await api.setEventMember(event.id, form.userId, form.role)
      setForm({ userId: '', role: form.role })
    })
  }

  function makeOwner(member) {
    if (!window.confirm(`Make ${personName(member.user)} the Owner of ${event.name}? You'll stay on as an Admin.`)) return
    run(() => api.transferEventOwnership(event.id, member.user_id))
  }

  return (
    <section>
      <h2>People ({event.members.length})</h2>
      <p className="muted">
        Admins edit the event and manage people. Coaches add athletes. Viewers can see the event.
      </p>
      {may.members && (
        <form onSubmit={add} className="row-form">
          <label>
            Add a person
            <select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
              <option value="">{addable.length ? 'Choose a user…' : 'Everyone is already on this event'}</option>
              {addable.map((u) => (
                <option key={u.id} value={u.id}>{u.name ? `${u.name} (${u.email})` : u.email}</option>
              ))}
            </select>
          </label>
          <label>
            As
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="admin">Admin</option>
              <option value="coach">Coach</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <button type="submit" disabled={busy || !form.userId}>Add</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th>{may.members && <th />}</tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id}>
                <td>{m.user?.name || '—'}</td>
                <td>{m.user?.email || '—'}</td>
                <td>
                  {may.members && m.role !== 'owner' ? (
                    <select
                      value={m.role}
                      disabled={busy}
                      aria-label={`Role for ${personName(m.user)}`}
                      onChange={(e) => run(() => api.setEventMember(event.id, m.user_id, e.target.value))}
                    >
                      <option value="admin">Admin</option>
                      <option value="coach">Coach</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  ) : (
                    <RoleBadge role={m.role} />
                  )}
                </td>
                {may.members && (
                  <td className="actions">
                    {m.role !== 'owner' && (
                      <>
                        {may.transfer && (
                          <button className="link" disabled={busy} onClick={() => makeOwner(m)}>Make owner</button>
                        )}
                        <button className="link" disabled={busy} onClick={() => run(() => api.removeEventMember(event.id, m.user_id))}>
                          Remove
                        </button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
