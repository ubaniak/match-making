import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { formatBouts, formatWeight, genderLabel } from './athletes'
import { categorise, compareByCategory } from './categories'
import {
  DEFAULT_TIME_ZONE, MAX_EVENT_DAYS, browserTimeZone, daysBetween, formatDateRange, formatDay, formatInZone, isoToZonedInput,
  timeZoneOptions, zoneAbbr, zoneLabel, zonedInputToIso,
} from './dates'
import { dayProblems, effectiveStatus, hasProblems, isEditableStatus, isOpen, statusLabels } from './events'

const roleLabels = { owner: 'Owner', viewer: 'Viewer' }

const myRole = (event, profile) => event.members.find((m) => m.user_id === profile?.id)?.role ?? null
const ownerOf = (event) => event.members.find((m) => m.role === 'owner')?.user
const personName = (user) => (user ? user.name || user.email : '—')
const siteUrl = () => window.location.origin + import.meta.env.BASE_URL

// What the signed-in user can do on an event (plan/events.md, "Who can do what").
function rightsFor(event, profile, siteAdmin) {
  const role = myRole(event, profile)
  const editable = isEditableStatus(event)
  const open = isOpen(event)
  const owner = role === 'owner'
  return {
    role,
    siteAdmin,
    edit: siteAdmin || (owner && editable),
    members: siteAdmin || (owner && editable),
    addMembers: open && (siteAdmin || owner),
    // Invite clubs and answer join and late-entry requests.
    manageClubs: siteAdmin || (owner && editable),
    open,
    editable,
    entriesOpen: open && (!event.entry_deadline || new Date() <= new Date(event.entry_deadline)),
  }
}

const zoneOf = (event) => event.timezone || DEFAULT_TIME_ZONE

// Shown in the event's time zone, plus the viewer's own time when their browser is elsewhere.
function Deadline({ event }) {
  if (!event.entry_deadline) return 'None'
  const zone = zoneOf(event)
  const mine = browserTimeZone()
  return (
    <>
      {formatInZone(event.entry_deadline, zone)}
      {mine !== zone && <span className="muted"> ({formatInZone(event.entry_deadline, mine)} your time)</span>}
    </>
  )
}

function TimeZoneSelect({ value, onChange }) {
  const options = useMemo(() => timeZoneOptions(value), [value])
  return (
    <label>
      Time zone
      <select required value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((tz) => <option key={tz} value={tz}>{tz.replaceAll('_', ' ')} ({zoneAbbr(tz)})</option>)}
      </select>
    </label>
  )
}

// One line saying which time zone an event's times are in.
function ZoneNote({ event }) {
  const zone = zoneOf(event)
  const mine = browserTimeZone()
  return (
    <p className="muted">
      All times are in {zoneLabel(zone, event.start_date)}.
      {mine !== zone && ` Your browser is on ${zoneLabel(mine)}.`}
    </p>
  )
}

// Events: site Admins create them and pick the Owner. The Owner fills in the poster and
// day times; a site Admin approves, cancels or closes the event.
export default function EventsPage({ profile, can }) {
  const siteAdmin = can('users:manage')
  const [view, setView] = useState({ name: 'list' })
  const back = () => setView({ name: 'list' })

  return (
    <main className="panel">
      {view.name === 'list' && (
        <EventList
          siteAdmin={siteAdmin}
          profile={profile}
          onOpen={(id) => setView({ name: 'event', id })}
          onCreate={() => setView({ name: 'new' })}
        />
      )}
      {view.name === 'new' && (
        <>
          <button className="link back" onClick={back}>← All events</button>
          <h1>New event</h1>
          <p className="muted">
            The event starts as Requested. Its Owner is asked by email to add the poster and the weigh-in and bout times.
            If the email can't be sent automatically, you'll get a ready-made one to send yourself. Approve it whenever
            you're ready.
          </p>
          <NewEventForm onCancel={back} onCreated={(id, email) => setView({ name: 'event', id, email })} />
        </>
      )}
      {view.name === 'event' && (
        <EventDetail id={view.id} email={view.email} profile={profile} siteAdmin={siteAdmin} onBack={back} />
      )}
    </main>
  )
}

function EventList({ siteAdmin, profile, onOpen, onCreate }) {
  const [events, setEvents] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.listEvents().then(setEvents, (err) => setError(err.message))
  }, [])

  const withStatus = events?.map((e) => ({ ...e, shownStatus: effectiveStatus(e) })) ?? []
  const requested = withStatus.filter((e) => e.shownStatus === 'requested')
  const active = withStatus.filter((e) => e.shownStatus === 'active')
  const finished = withStatus.filter((e) => e.shownStatus === 'done' || e.shownStatus === 'cancelled').reverse()

  return (
    <>
      <div className="heading-row">
        <h1>Events</h1>
        {siteAdmin && <button onClick={onCreate}>New event</button>}
        <a className="link-button" href="#upcoming">Public page</a>
      </div>
      {error && <p className="error">{error}</p>}
      {events === null && !error && <p className="muted">Loading…</p>}
      {events?.length === 0 && (
        <p className="muted">
          {siteAdmin ? 'No events yet. Create one and pick its Owner.' : 'You haven\'t been added to any events yet.'}
        </p>
      )}
      {requested.length > 0 && (
        <EventTable title={siteAdmin ? 'Waiting for approval' : 'Requested'} events={requested} profile={profile} onOpen={onOpen} />
      )}
      {active.length > 0 && <EventTable title="Active" events={active} profile={profile} onOpen={onOpen} />}
      {finished.length > 0 && <EventTable title="Done and cancelled" events={finished} profile={profile} onOpen={onOpen} />}
    </>
  )
}

function EventTable({ title, events, profile, onOpen }) {
  return (
    <section>
      <h2>{title}</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>Event</th><th>Status</th><th>Dates</th><th>Location</th><th>Owner</th><th>Your role</th><th>Athletes</th></tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td><button className="link" onClick={() => onOpen(e.id)}>{e.name}</button></td>
                <td><StatusBadge status={e.shownStatus} /></td>
                <td>{formatDateRange(e.start_date, e.end_date)}</td>
                <td>{e.venue || '—'}</td>
                <td>{personName(ownerOf(e))}</td>
                <td><RoleBadge role={myRole(e, profile)} /></td>
                <td>{e.athlete_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function StatusBadge({ status }) {
  return <span className={`badge status-${status}`}>{statusLabels[status]}</span>
}

function RoleBadge({ role }) {
  if (!role) return '—'
  return <span className={`badge role-${role}`}>{roleLabels[role]}</span>
}

// Active users who can be picked as an Owner.
function useActiveUsers(enabled = true) {
  const [users, setUsers] = useState([])
  useEffect(() => {
    if (enabled) api.listUsers().then((all) => setUsers(all.filter((u) => u.id && u.state === 'Active')), () => setUsers([]))
  }, [enabled])
  return users
}

function DateFields({ form, setField }) {
  const datesBackwards = form.startDate && form.endDate && form.endDate < form.startDate
  const tooLong = form.startDate && form.endDate && !datesBackwards && daysBetween(form.startDate, form.endDate).length === 0
  const field = (key) => ({ value: form[key], onChange: (e) => setField(key, e.target.value) })
  return (
    <>
      <label>Start date<input type="date" required {...field('startDate')} /></label>
      <label>
        End date <span className="muted">(same as start for one day)</span>
        <input type="date" required min={form.startDate || undefined} {...field('endDate')} />
      </label>
      {datesBackwards && <p className="error full">The end date is before the start date.</p>}
      {tooLong && <p className="error full">An event can be at most {MAX_EVENT_DAYS} days long.</p>}
    </>
  )
}

// Picking a start date fills the end date, so a one-day event needs one pick.
function useEventFields(initial) {
  const [form, setForm] = useState(initial)
  function setField(key, value) {
    setForm((current) => {
      const next = { ...current, [key]: value }
      if (key === 'startDate' && (!current.endDate || current.endDate === current.startDate || current.endDate < value)) {
        next.endDate = value
      }
      return next
    })
  }
  return [form, setField]
}

function NewEventForm({ onCancel, onCreated }) {
  const [form, setField] = useEventFields({ name: '', venue: '', startDate: '', endDate: '', ownerId: '', timezone: browserTimeZone() })
  const users = useActiveUsers()
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  async function save(e) {
    e.preventDefault()
    setError(null)
    if (daysBetween(form.startDate, form.endDate).length === 0) return setError('Check the dates: the end date must be on or after the start date.')
    setSaving(true)
    let id
    try {
      id = await api.createEvent(form)
    } catch (err) {
      setError(err.message)
      setSaving(false)
      return
    }
    // The event exists now; a failed email shouldn't undo that.
    let email
    try {
      await api.emailEventOwner(id)
      email = { sent: true }
    } catch (err) {
      email = { sent: false, reason: err.message }
    }
    onCreated(id, email)
  }

  const field = (key) => ({ value: form[key], onChange: (e) => setField(key, e.target.value) })

  return (
    <form onSubmit={save} className="event-form">
      <div className="row-form">
        <h2>Details</h2>
        <label>Name<input required {...field('name')} placeholder="e.g. Winter Box Cup" /></label>
        <label>Location <span className="muted">(optional)</span><input {...field('venue')} /></label>
        <label>
          Owner
          <select required {...field('ownerId')}>
            <option value="">Choose a user…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name ? `${u.name} (${u.email})` : u.email}</option>
            ))}
          </select>
        </label>
        <p className="muted full">Only people who have signed in at least once can own an event.</p>
        <TimeZoneSelect value={form.timezone} onChange={(tz) => setField('timezone', tz)} />
        <p className="muted full">Weigh-in and bout times are in this time zone. We picked your browser's; change it if the event is somewhere else.</p>
      </div>
      <div className="row-form">
        <h2>Dates</h2>
        <DateFields form={form} setField={setField} />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create event'}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

// After creating an event: did the Owner's email go out? If not, offer the Admin's email app.
function EmailNotice({ event, email, onDismiss }) {
  if (!email) return null
  const owner = ownerOf(event)
  if (email.sent) {
    return (
      <p className="notice">
        We emailed {personName(owner)} "You have Requested an event". <button className="link" onClick={onDismiss}>Dismiss</button>
      </p>
    )
  }
  const body = [
    `Hi ${owner?.name || ''},`.trim(),
    '',
    `You have Requested an event: ${event.name} (${formatDateRange(event.start_date, event.end_date)}).`,
    '',
    `Sign in to add a poster and the weigh-in and bout times: ${siteUrl()}`,
  ].join('\n')
  const mailto = `mailto:${encodeURIComponent(owner?.email ?? '')}?subject=${encodeURIComponent('You have Requested an event')}&body=${encodeURIComponent(body)}`
  return (
    <p className="notice warning">
      The email to {personName(owner)} wasn't sent automatically ({email.reason}).{' '}
      <a href={mailto}>Send it from your email app</a> · <button className="link" onClick={onDismiss}>Dismiss</button>
    </p>
  )
}

function EventDetail({ id, email: initialEmail, profile, siteAdmin, onBack }) {
  const [event, setEvent] = useState(undefined)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null) // 'details' | 'times' | null
  const [email, setEmail] = useState(initialEmail)
  const [busy, setBusy] = useState(false)
  const [clubs, setClubs] = useState([])

  useEffect(() => {
    api.listClubs().then(setClubs, () => setClubs([]))
  }, [])

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

  async function run(action) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const backLink = <button className="link back" onClick={onBack}>← All events</button>

  if (event === undefined) return <>{backLink}{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</>
  if (event === null) return <>{backLink}<p>That event no longer exists.</p></>

  const may = rightsFor(event, profile, siteAdmin)
  const status = effectiveStatus(event)

  function changeStatus(next, question) {
    if (question && !window.confirm(question)) return
    run(() => api.setEventStatus(event.id, next))
  }

  async function remove() {
    if (!window.confirm(`Delete ${event.name} for good? Cancelling keeps a record; deleting doesn't.`)) return
    try {
      await api.deleteEvent(event.id)
      onBack()
    } catch (err) {
      setError(err.message)
    }
  }

  if (editing === 'details') {
    return (
      <>
        {backLink}
        <h1>Edit {event.name}</h1>
        <DetailsForm event={event} siteAdmin={siteAdmin} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />
      </>
    )
  }
  if (editing === 'times') {
    return (
      <>
        {backLink}
        <h1>Times for {event.name}</h1>
        <TimesForm event={event} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />
      </>
    )
  }

  return (
    <>
      {backLink}
      <div className="heading-row">
        <h1>{event.name}</h1>
        <StatusBadge status={status} />
        {may.edit && <button className="secondary" onClick={() => setEditing('details')}>Edit details</button>}
      </div>
      <EmailNotice event={event} email={email} onDismiss={() => setEmail(null)} />
      {error && <p className="error">{error}</p>}

      {siteAdmin && (status === 'requested' || status === 'active') && (
        <div className="admin-actions">
          {status === 'requested' && (
            <button disabled={busy} onClick={() => changeStatus('active', `Approve ${event.name}? It goes on the public page and can take on people and athletes.`)}>
              Approve
            </button>
          )}
          <button className="secondary" disabled={busy} onClick={() => changeStatus('done', `Mark ${event.name} as Done now? This can't be undone.`)}>
            Mark done
          </button>
          <button className="secondary danger" disabled={busy} onClick={() => changeStatus('cancelled', `Cancel ${event.name}? This can't be undone.`)}>
            Cancel event
          </button>
        </div>
      )}
      {status === 'requested' && !siteAdmin && (
        <p className="muted">A site Admin will approve this event. Meanwhile, add the poster and the day times below.</p>
      )}
      {may.role === 'owner' && !siteAdmin && isEditableStatus(event) && (
        <p className="muted">Need this event cancelled? Ask a site Admin.</p>
      )}

      <dl className="facts">
        <div><dt>Dates</dt><dd>{formatDateRange(event.start_date, event.end_date)}</dd></div>
        <div><dt>Location</dt><dd>{event.venue || '—'}</dd></div>
        <div><dt>Owner</dt><dd>{personName(ownerOf(event))}</dd></div>
        <div><dt>Time zone</dt><dd>{zoneLabel(zoneOf(event), event.start_date)}</dd></div>
        <div><dt>Entry deadline</dt><dd><Deadline event={event} /></dd></div>
        <div><dt>Your role</dt><dd>{siteAdmin ? <span className="badge">Site admin</span> : <RoleBadge role={may.role} />}</dd></div>
      </dl>
      {siteAdmin && <ChangeOwner event={event} busy={busy} run={run} />}

      <Poster event={event} canEdit={may.edit} run={run} busy={busy} />
      <Schedule event={event} canEdit={may.edit} onEdit={() => setEditing('times')} />
      <EventClubs event={event} may={may} clubs={clubs} profile={profile} onChange={reload} />
      <EventEntries event={event} may={may} clubs={clubs} profile={profile} onChange={reload} />
      <EventMembers event={event} may={may} onChange={reload} />

      {siteAdmin && (
        <p><button className="link danger" onClick={remove}>Delete this event</button></p>
      )}
    </>
  )
}

function ChangeOwner({ event, busy, run }) {
  const users = useActiveUsers()
  const current = ownerOf(event)
  const [choice, setChoice] = useState('')
  const candidates = users.filter((u) => u.id !== current?.id)

  function save(e) {
    e.preventDefault()
    const user = users.find((u) => u.id === choice)
    if (!user || !window.confirm(`Make ${personName(user)} the Owner of ${event.name}? ${personName(current)} stays on as a Viewer.`)) return
    run(async () => {
      await api.transferEventOwnership(event.id, choice)
      setChoice('')
    })
  }

  return (
    <form onSubmit={save} className="row-form compact">
      <label>
        Change owner
        <select value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Choose a user…</option>
          {candidates.map((u) => (
            <option key={u.id} value={u.id}>{u.name ? `${u.name} (${u.email})` : u.email}</option>
          ))}
        </select>
      </label>
      <button type="submit" className="secondary" disabled={busy || !choice}>Change</button>
    </form>
  )
}

function DetailsForm({ event, siteAdmin, onCancel, onSaved }) {
  const [form, setField] = useEventFields({
    name: event.name, venue: event.venue ?? '', startDate: event.start_date, endDate: event.end_date, timezone: zoneOf(event),
    deadline: isoToZonedInput(event.entry_deadline, zoneOf(event)),
  })
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const lostDays = event.days.filter((d) => d.day < form.startDate || d.day > form.endDate)

  async function save(e) {
    e.preventDefault()
    setError(null)
    if (daysBetween(form.startDate, form.endDate).length === 0) return setError('Check the dates: the end date must be on or after the start date.')
    if (lostDays.length && !window.confirm(`The new dates drop the times for ${lostDays.map((d) => formatDay(d.day)).join(', ')}. Continue?`)) return
    setSaving(true)
    try {
      await api.updateEventDetails(event.id, {
        ...form,
        timezone: siteAdmin ? form.timezone : undefined,
        entryDeadline: zonedInputToIso(form.deadline, form.timezone),
      })
      onSaved()
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
        <label>Name<input required {...field('name')} /></label>
        <label>Location <span className="muted">(optional)</span><input {...field('venue')} /></label>
        {siteAdmin && <TimeZoneSelect value={form.timezone} onChange={(tz) => setField('timezone', tz)} />}
      </div>
      <div className="row-form">
        <h2>Dates</h2>
        <DateFields form={form} setField={setField} />
      </div>
      <div className="row-form">
        <h2>Entry deadline <span className="muted">(optional)</span></h2>
        <label>
          Entries close at ({zoneAbbr(form.timezone, form.endDate)})
          <input type="datetime-local" {...field('deadline')} />
        </label>
        {form.deadline && <button type="button" className="secondary" onClick={() => setField('deadline', '')}>No deadline</button>}
        <p className="muted full">After the deadline, clubs can't enter athletes themselves; they can send you a late-entry request.</p>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function Poster({ event, canEdit, run, busy }) {
  const url = api.posterUrl(event.poster_path)
  if (!url && !canEdit) return null

  function upload(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return window.alert('Pick an image file (PNG, JPG, WebP or GIF).')
    if (file.size > 5 * 1024 * 1024) return window.alert('Posters must be under 5 MB.')
    run(() => api.uploadPoster(event.id, file, event.poster_path))
  }

  return (
    <section>
      <h2>Poster</h2>
      {url ? <img className="poster" src={url} alt={`Poster for ${event.name}`} /> : <p className="muted">No poster yet. It's optional.</p>}
      {canEdit && (
        <div className="form-actions">
          <label className={`file-button${busy ? ' disabled' : ''}`}>
            {url ? 'Replace poster' : 'Upload poster'}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={upload} disabled={busy} hidden />
          </label>
          {url && (
            <button className="secondary" disabled={busy} onClick={() => run(() => api.removePoster(event.id, event.poster_path))}>
              Remove
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function Schedule({ event, canEdit, onEdit }) {
  const days = daysBetween(event.start_date, event.end_date)
  const byDay = Object.fromEntries(event.days.map((d) => [d.day, d]))
  return (
    <section>
      <div className="heading-row">
        <h2>Day times</h2>
        {canEdit && <button className="secondary" onClick={onEdit}>{event.days.length ? 'Edit times' : 'Add times'}</button>}
      </div>
      {event.days.length === 0 ? (
        <p className="muted">No times yet. Each day with bouts needs a weigh-in and at least one bout session.</p>
      ) : (
        <>
        <ZoneNote event={event} />
        <table>
          <thead>
            <tr><th>Day</th><th>Weigh-in</th><th>Bout sessions</th></tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const d = byDay[day]
              return (
                <tr key={day}>
                  <td>{formatDay(day)}</td>
                  <td>{d ? `${d.weigh_in_start}–${d.weigh_in_end} ${zoneAbbr(zoneOf(event), day)}` : <span className="muted">No bouts</span>}</td>
                  <td>{d ? `${d.sessions.map((s) => (s.label ? `${s.label} ${s.starts_at}` : s.starts_at)).join(', ')} ${zoneAbbr(zoneOf(event), day)}` : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </>
      )}
    </section>
  )
}

const newDay = (day) => ({ day, bouts: true, weigh_in_start: '08:00', weigh_in_end: '10:00', sessions: [{ starts_at: '13:00', label: '' }] })

// One weigh-in and one or more bout sessions per day with bouts. The rules are checked as you type.
function TimesForm({ event, onCancel, onSaved }) {
  const [days, setDays] = useState(() => {
    const saved = Object.fromEntries(event.days.map((d) => [d.day, d]))
    const firstTime = event.days.length === 0
    return daysBetween(event.start_date, event.end_date).map((day) =>
      saved[day]
        ? { ...saved[day], bouts: true, sessions: saved[day].sessions.map((s) => ({ ...s })) }
        : { ...newDay(day), bouts: firstTime },
    )
  })
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const problems = days.map((d) => (d.bouts ? dayProblems(d) : { weighIn: [], sessions: [] }))
  const blocked = problems.some(hasProblems)

  function update(index, change) {
    setDays((current) => current.map((d, i) => (i === index ? { ...d, ...change(d) } : d)))
  }
  const setSession = (index, s, key, value) =>
    update(index, (d) => ({ sessions: d.sessions.map((session, j) => (j === s ? { ...session, [key]: value } : session)) }))

  async function save(e) {
    e.preventDefault()
    setError(null)
    if (blocked) return setError('Fix the highlighted times first.')
    setSaving(true)
    try {
      await api.saveEventTimes(
        event.id,
        days.filter((d) => d.bouts).map(({ day, weigh_in_start, weigh_in_end, sessions }) => ({ day, weigh_in_start, weigh_in_end, sessions })),
      )
      onSaved()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="event-form">
      <ZoneNote event={event} />
      <p className="muted">
        Each day with bouts has one weigh-in and one or more bout sessions. The weigh-in lasts at least 2 hours and ends at least
        3 hours before that day's first bout.
      </p>
      {days.map((d, i) => (
        <div className="row-form day-times" key={d.day}>
          <h2>{formatDay(d.day)}</h2>
          <label className="checkbox full">
            <input type="checkbox" checked={d.bouts} onChange={(e) => update(i, () => ({ bouts: e.target.checked }))} />
            Bouts on this day
          </label>
          {d.bouts && (
            <>
              <label>
                Weigh-in starts
                <input type="time" required value={d.weigh_in_start} onChange={(e) => update(i, () => ({ weigh_in_start: e.target.value }))} />
              </label>
              <label>
                Weigh-in ends
                <input type="time" required value={d.weigh_in_end} onChange={(e) => update(i, () => ({ weigh_in_end: e.target.value }))} />
              </label>
              {problems[i].weighIn.map((p) => <p key={p} className="error full">{p}</p>)}
              <div className="full">
                <table className="schedule">
                  <thead>
                    <tr><th>Bout session <span className="muted">(name optional)</span></th><th>Starts</th><th /></tr>
                  </thead>
                  <tbody>
                    {d.sessions.map((s, j) => (
                      <tr key={j}>
                        <td>
                          <input value={s.label} maxLength={40} placeholder={j === 0 ? 'e.g. Afternoon' : 'e.g. Evening'}
                            onChange={(e) => setSession(i, j, 'label', e.target.value)} aria-label={`Session ${j + 1} name`} />
                        </td>
                        <td>
                          <input type="time" required value={s.starts_at}
                            onChange={(e) => setSession(i, j, 'starts_at', e.target.value)} aria-label={`Session ${j + 1} start`} />
                        </td>
                        <td className="actions">
                          {d.sessions.length > 1 && (
                            <button type="button" className="link" onClick={() => update(i, (day) => ({ sessions: day.sessions.filter((_, k) => k !== j) }))}>
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" className="link"
                  onClick={() => update(i, (day) => ({ sessions: [...day.sessions, { starts_at: '', label: '' }] }))}>
                  + Add a session
                </button>
              </div>
              {problems[i].sessions.map((p) => <p key={p} className="error full">{p}</p>)}
            </>
          )}
        </div>
      ))}
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button type="submit" disabled={saving || blocked}>{saving ? 'Saving…' : 'Save times'}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

const clubStatusLabels = { accepted: 'In', requested: 'Asked to join', declined: 'Declined' }

// Clubs in the event. The Owner invites clubs and answers requests; club owners ask to join.
function EventClubs({ event, may, clubs, profile, onChange }) {
  const [choice, setChoice] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const byClub = Object.fromEntries(event.clubs.map((ec) => [ec.club_id, ec]))
  const ownedClubs = clubs.filter((c) => c.members.some((m) => m.user_id === profile?.id && m.role === 'owner' && m.status === 'active'))
  const canJoin = ownedClubs.filter((c) => !['accepted', 'requested'].includes(byClub[c.id]?.status))
  const invitable = clubs.filter((c) => byClub[c.id]?.status !== 'accepted')
  const order = { requested: 0, accepted: 1, declined: 2 }
  const rows = [...event.clubs].sort((a, b) => order[a.status] - order[b.status] || (a.club?.name ?? '').localeCompare(b.club?.name ?? ''))
  const owns = (clubId) => ownedClubs.some((c) => c.id === clubId)

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

  function invite(e) {
    e.preventDefault()
    if (!choice) return
    run(async () => {
      await api.inviteClub(event.id, choice)
      setChoice('')
    })
  }

  function remove(ec) {
    const entered = event.athletes.filter((a) => a.entry_club_id === ec.club_id).length
    const question = ec.status === 'requested' && owns(ec.club_id) && !may.manageClubs
      ? `Withdraw ${ec.club?.name}'s request to join?`
      : `Take ${ec.club?.name} out of ${event.name}?${entered ? ` Its ${entered} entered athlete${entered === 1 ? ' is' : 's are'} withdrawn too.` : ''}`
    if (!window.confirm(question)) return
    run(() => api.removeEventClub(event.id, ec.club_id))
  }

  if (!may.manageClubs && rows.length === 0 && canJoin.length === 0) return null

  return (
    <section>
      <h2>Clubs ({event.clubs.filter((ec) => ec.status === 'accepted').length})</h2>
      {effectiveStatus(event) === 'requested' && <p className="muted">Clubs can join once the event is approved.</p>}
      {may.manageClubs && may.open && (
        <form onSubmit={invite} className="row-form">
          <label>
            Invite a club
            <select value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">{invitable.length ? 'Choose a club…' : 'Every club is already in'}</option>
              {invitable.map((c) => <option key={c.id} value={c.id}>{c.name}{byClub[c.id]?.status === 'requested' ? ' (asked to join)' : ''}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy || !choice}>Invite</button>
        </form>
      )}
      {may.open && canJoin.length > 0 && (
        <div className="admin-actions">
          {canJoin.map((c) => (
            <button key={c.id} className="secondary" disabled={busy} onClick={() => run(() => api.requestToJoin(event.id, c.id))}>
              Ask to join for {c.name}
            </button>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {rows.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Club</th><th>Status</th><th>Athletes entered</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((ec) => (
                <tr key={ec.club_id}>
                  <td>{ec.club?.name ?? '—'}</td>
                  <td><span className={`badge club-${ec.status}`}>{clubStatusLabels[ec.status]}</span></td>
                  <td>{ec.status === 'accepted' ? event.athletes.filter((a) => a.entry_club_id === ec.club_id).length : ''}</td>
                  <td className="actions">
                    {may.manageClubs && ec.status === 'requested' && (
                      <>
                        <button className="link" disabled={busy} onClick={() => run(() => api.decideJoinRequest(event.id, ec.club_id, true))}>Accept</button>
                        <button className="link" disabled={busy} onClick={() => run(() => api.decideJoinRequest(event.id, ec.club_id, false))}>Decline</button>
                      </>
                    )}
                    {(may.manageClubs || (owns(ec.club_id) && may.editable)) && ec.status !== 'declined' && (
                      <button className="link" disabled={busy} onClick={() => remove(ec)}>
                        {ec.status === 'requested' && !may.manageClubs ? 'Withdraw request' : may.manageClubs ? 'Remove' : 'Leave event'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// Entered athletes. Club owners enter and withdraw their own club's athletes and suggest opponents.
function EventEntries({ event, may, clubs, profile, onChange }) {
  const [allAthletes, setAllAthletes] = useState([])
  const [form, setForm] = useState({ athleteId: '', opponentName: '', opponentClub: '', note: '' })
  const [editing, setEditing] = useState(null) // athlete id whose suggestion is being edited
  const [suggestion, setSuggestion] = useState({ name: '', club: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const inClubs = new Set(event.clubs.filter((ec) => ec.status === 'accepted').map((ec) => ec.club_id))
  const ownedIds = new Set(clubs.filter((c) => c.members.some((m) => m.user_id === profile?.id && m.role === 'owner' && m.status === 'active')).map((c) => c.id))
  const myEntryClubs = may.siteAdmin ? inClubs : new Set([...ownedIds].filter((id) => inClubs.has(id)))
  const canEnter = may.open && myEntryClubs.size > 0
  const late = canEnter && !may.entriesOpen && !may.siteAdmin
  const canChange = (a) => may.siteAdmin || (ownedIds.has(a.entry_club_id) && may.editable)
  const showActions = event.athletes.some(canChange)

  useEffect(() => {
    if (canEnter) api.listAthletes().then(setAllAthletes, (err) => setError(err.message))
  }, [canEnter])

  const entered = useMemo(() => new Set(event.athletes.map((a) => a.id)), [event.athletes])
  const waitingLate = new Set(event.late_entries.filter((r) => r.status === 'pending').map((r) => r.athlete_id))
  const available = allAthletes.filter((a) => myEntryClubs.has(a.club_id) && !entered.has(a.id) && !waitingLate.has(a.id))
  // Each athlete's age group, weight class and experience level for this event, in division order.
  const athletes = useMemo(
    () => event.athletes.map((a) => ({ ...a, categories: categorise(a, event.start_date) })).sort(compareByCategory),
    [event.athletes, event.start_date],
  )

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

  async function enter(e) {
    e.preventDefault()
    if (!form.athleteId) return
    const ok = await run(() =>
      late
        ? api.requestLateEntry(event.id, form.athleteId, form.note)
        : api.enterAthlete(event.id, form.athleteId, form.opponentName, form.opponentClub),
    )
    if (ok) setForm({ athleteId: '', opponentName: '', opponentClub: '', note: '' })
  }

  function withdraw(a) {
    if (!window.confirm(`Withdraw ${a.name} from ${event.name}?`)) return
    run(() => api.withdrawAthlete(event.id, a.id))
  }

  async function saveSuggestion(a) {
    const ok = await run(() => api.suggestOpponent(event.id, a.id, suggestion.name, suggestion.club))
    if (ok) setEditing(null)
  }

  const field = (key) => ({ value: form[key], onChange: (e) => setForm({ ...form, [key]: e.target.value }) })
  // Entries come back only for people allowed to see them (the Owner, site Admins, clubs that are in).
  const canSeeEntries = may.siteAdmin || may.role === 'owner' || event.athletes.length > 0 || myEntryClubs.size > 0
  if (!canSeeEntries && !canEnter) return null

  return (
    <section>
      <h2>Athletes ({event.athletes.length})</h2>
      {effectiveStatus(event) === 'requested' && <p className="muted">Athletes can be entered once the event is approved.</p>}
      {canEnter && (
        <form onSubmit={enter} className="row-form">
          <h2>{late ? 'Ask for a late entry' : 'Enter an athlete'}</h2>
          {late && <p className="muted full">The entry deadline has passed. The event's Owner will accept or decline your request.</p>}
          <label>
            Athlete
            <select value={form.athleteId} onChange={(e) => setForm({ ...form, athleteId: e.target.value })}>
              <option value="">{available.length ? 'Choose an athlete…' : may.siteAdmin ? 'Every athlete in the event\'s clubs is entered' : 'All your club\'s athletes are entered'}</option>
              {available.map((a) => (
                <option key={a.id} value={a.id}>
                  {[a.name, a.club, genderLabel(a.gender), formatWeight(a.weight_kg)].filter((v) => v && v !== '—').join(' · ')}
                </option>
              ))}
            </select>
          </label>
          {late ? (
            <label>Note <span className="muted">(optional)</span><input maxLength={500} {...field('note')} /></label>
          ) : (
            <>
              <label>Suggested opponent <span className="muted">(optional)</span><input maxLength={100} placeholder="Name" {...field('opponentName')} /></label>
              <label>Their club<input maxLength={100} placeholder="Club" {...field('opponentClub')} /></label>
            </>
          )}
          <button type="submit" disabled={busy || !form.athleteId}>{late ? 'Send request' : 'Enter'}</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      <LateEntries event={event} may={may} ownedIds={ownedIds} profile={profile} run={run} busy={busy} />
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
              <tr><th>Name</th><th>Age group</th><th>Gender</th><th>Weight class</th><th>Experience</th><th>Club</th><th>Suggested opponent</th>{showActions && <th />}</tr>
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
                  <td>
                    {editing === a.id ? (
                      <span className="inline-edit">
                        <input aria-label="Opponent name" placeholder="Name" maxLength={100} value={suggestion.name} onChange={(e) => setSuggestion({ ...suggestion, name: e.target.value })} />
                        <input aria-label="Opponent club" placeholder="Club" maxLength={100} value={suggestion.club} onChange={(e) => setSuggestion({ ...suggestion, club: e.target.value })} />
                        <button className="link" disabled={busy} onClick={() => saveSuggestion(a)}>Save</button>
                        <button className="link" onClick={() => setEditing(null)}>Cancel</button>
                      </span>
                    ) : (
                      [a.suggested_opponent_name, a.suggested_opponent_club].filter(Boolean).join(', ') || '—'
                    )}
                  </td>
                  {showActions && (
                    <td className="actions">
                      {canChange(a) && editing !== a.id && (
                        <>
                          <button className="link" onClick={() => { setEditing(a.id); setSuggestion({ name: a.suggested_opponent_name ?? '', club: a.suggested_opponent_club ?? '' }) }}>
                            {a.suggested_opponent_name || a.suggested_opponent_club ? 'Edit suggestion' : 'Suggest opponent'}
                          </button>
                          <button className="link" disabled={busy} onClick={() => withdraw(a)}>Withdraw</button>
                        </>
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

const lateLabels = { pending: 'Waiting', accepted: 'Accepted', declined: 'Declined', cancelled: 'Withdrawn' }

function LateEntries({ event, may, ownedIds, profile, run, busy }) {
  const requests = event.late_entries
  if (requests.length === 0) return null
  const canCancel = (r) => may.siteAdmin || r.requested_by === profile?.id || ownedIds.has(r.club_id)
  return (
    <>
      <h3>Late-entry requests</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>Athlete</th><th>Club</th><th>Note</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td>{r.athlete?.name ?? '—'}</td>
                <td>{r.club?.name ?? '—'}</td>
                <td>{r.note || ''}</td>
                <td><span className={`badge late-${r.status}`}>{lateLabels[r.status]}</span></td>
                <td className="actions">
                  {r.status === 'pending' && may.manageClubs && (
                    <>
                      <button className="link" disabled={busy} onClick={() => run(() => api.decideLateEntry(r.id, true))}>Accept</button>
                      <button className="link" disabled={busy} onClick={() => run(() => api.decideLateEntry(r.id, false))}>Decline</button>
                    </>
                  )}
                  {r.status === 'pending' && !may.manageClubs && canCancel(r) && (
                    <button className="link" disabled={busy} onClick={() => run(() => api.cancelLateEntry(r.id))}>Withdraw</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
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


// Who's on the event: the Owner, plus Viewers once the event is Active.
// Only a site Admin changes the Owner (see ChangeOwner).
function EventMembers({ event, may, onChange }) {
  const users = useActiveUsers(may.addMembers)
  const [form, setForm] = useState({ userId: '', role: 'viewer' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const memberIds = new Set(event.members.map((m) => m.user_id))
  const addable = users.filter((u) => !memberIds.has(u.id))
  const order = ['owner', 'viewer']
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

  return (
    <section>
      <h2>People ({event.members.length})</h2>
      <p className="muted">
        Viewers can see the event's details and times. Clubs enter athletes through the Clubs section above.
        {effectiveStatus(event) === 'requested' && ' People can be added once the event is approved.'}
      </p>
      {may.addMembers && (
        <form onSubmit={add} className="row-form">
          <label>
            Add a viewer
            <select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
              <option value="">{addable.length ? 'Choose a user…' : 'Everyone is already on this event'}</option>
              {addable.map((u) => (
                <option key={u.id} value={u.id}>{u.name ? `${u.name} (${u.email})` : u.email}</option>
              ))}
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
                <td><RoleBadge role={m.role} /></td>
                {may.members && (
                  <td className="actions">
                    {m.role !== 'owner' && (
                      <button className="link" disabled={busy} onClick={() => run(() => api.removeEventMember(event.id, m.user_id))}>
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
    </section>
  )
}
