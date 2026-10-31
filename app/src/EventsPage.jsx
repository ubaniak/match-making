import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { MAX_EVENT_DAYS, daysBetween, formatDateRange, formatDay, formatTime, todayIso } from './dates'

// Events: Admins create them and pick the owning coach; that coach edits the event and enters athletes.
export default function EventsPage({ profile, can }) {
  const [view, setView] = useState({ name: 'list' })

  // Admins can do anything; coaches only change events they own.
  const canCreate = can('events:create')
  const canManage = useCallback(
    (event) => canCreate || (can('events:manage') && event.owner_id === profile?.id),
    [can, canCreate, profile],
  )

  const back = () => setView({ name: 'list' })

  return (
    <main className="panel">
      {view.name === 'list' && (
        <EventList
          canCreate={canCreate}
          profile={profile}
          onOpen={(id) => setView({ name: 'event', id })}
          onCreate={() => setView({ name: 'new' })}
        />
      )}
      {view.name === 'new' && (
        <>
          <button className="link back" onClick={back}>← All events</button>
          <h1>New event</h1>
          <EventForm canChooseOwner onCancel={back} onSaved={(id) => setView({ name: 'event', id })} />
        </>
      )}
      {view.name === 'event' && (
        <EventDetail id={view.id} canCreate={canCreate} canManage={canManage} onBack={back} />
      )}
    </main>
  )
}

function EventList({ canCreate, profile, onOpen, onCreate }) {
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
        <p className="muted">{canCreate ? 'No events yet. Create one to get started.' : 'No events yet.'}</p>
      )}
      {upcoming.length > 0 && <EventTable title="Upcoming" events={upcoming} profile={profile} onOpen={onOpen} />}
      {past.length > 0 && <EventTable title="Past" events={past} profile={profile} onOpen={onOpen} />}
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
            <tr><th>Event</th><th>Dates</th><th>Venue</th><th>Owner</th><th>Athletes</th></tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>
                  <button className="link" onClick={() => onOpen(e.id)}>{e.name}</button>
                  {e.owner_id === profile?.id && <span className="badge active">Yours</span>}
                </td>
                <td>
                  {formatDateRange(e.start_date, e.end_date)}
                  {e.days.length > 1 && <span className="muted"> ({e.days.length} days)</span>}
                </td>
                <td>{e.venue || '—'}</td>
                <td>{e.owner ? e.owner.name || e.owner.email : '—'}</td>
                <td>{e.athlete_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function EventDetail({ id, canCreate, canManage, onBack }) {
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

  const manage = canManage(event)

  if (editing) {
    return (
      <>
        {backLink}
        <h1>Edit {event.name}</h1>
        <EventForm
          event={event}
          canChooseOwner={canCreate}
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
        {manage && <button className="secondary" onClick={() => setEditing(true)}>Edit event</button>}
        {canCreate && <button className="secondary danger" onClick={remove}>Delete</button>}
      </div>
      {error && <p className="error">{error}</p>}
      <dl className="facts">
        <div><dt>Dates</dt><dd>{formatDateRange(event.start_date, event.end_date)}</dd></div>
        <div><dt>Venue</dt><dd>{event.venue || '—'}</dd></div>
        <div><dt>Owner</dt><dd>{event.owner ? event.owner.name || event.owner.email : '—'}</dd></div>
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

      <EventAthletes event={event} canManage={manage} onChange={reload} />
    </>
  )
}

function EventAthletes({ event, canManage, onChange }) {
  const [allAthletes, setAllAthletes] = useState([])
  const [choice, setChoice] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (canManage) api.listAthletes().then(setAllAthletes, (err) => setError(err.message))
  }, [canManage])

  const entered = useMemo(() => new Set(event.athletes.map((a) => a.id)), [event.athletes])
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
      {canManage && (
        <form onSubmit={add} className="row-form">
          <label>
            Add an athlete
            <select value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">{available.length ? 'Choose an athlete…' : 'Every athlete is already entered'}</option>
              {available.map((a) => (
                <option key={a.id} value={a.id}>
                  {[a.name, a.weight_class, a.club].filter(Boolean).join(' · ')}
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
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Name</th><th>Weight class</th><th>Club</th><th>Coach</th>{canManage && <th />}</tr>
            </thead>
            <tbody>
              {event.athletes.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td>{a.weight_class || '—'}</td>
                  <td>{a.club || '—'}</td>
                  <td>{a.coach ? a.coach.name || a.coach.email : '—'}</td>
                  {canManage && (
                    <td className="actions">
                      <button className="link" disabled={busy} onClick={() => run(() => api.removeEventAthlete(event.id, a.id))}>
                        Remove
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

const defaultTimes = { weigh_in_time: '08:00', bouts_time: '12:00' }

function EventForm({ event, canChooseOwner, onCancel, onSaved }) {
  const [form, setForm] = useState({
    name: event?.name ?? '',
    venue: event?.venue ?? '',
    startDate: event?.start_date ?? '',
    endDate: event?.end_date ?? '',
    ownerId: event?.owner_id ?? '',
  })
  // Times typed so far, by day, so changing the dates keeps them.
  const [times, setTimes] = useState(() => Object.fromEntries((event?.days ?? []).map((d) => [d.day, d])))
  const [coaches, setCoaches] = useState([])
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (canChooseOwner) api.listCoaches().then(setCoaches, (err) => setError(err.message))
  }, [canChooseOwner])

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
    if (canChooseOwner && !form.ownerId) return setError('Choose the coach who owns this event.')
    setSaving(true)
    try {
      const id = await api.saveEvent({ id: event?.id, ...form, days: schedule })
      onSaved(id)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const activeCoaches = coaches.filter((c) => c.id && c.state === 'Active')
  const field = (key) => ({ value: form[key], onChange: (e) => setField(key, e.target.value) })

  return (
    <form onSubmit={save} className="event-form">
      <div className="row-form">
        <h2>Details</h2>
        <label>Name<input required {...field('name')} placeholder="e.g. Winter Box Cup" /></label>
        <label>Venue <span className="muted">(optional)</span><input {...field('venue')} /></label>
        {canChooseOwner && (
          <label>
            Owner (coach)
            <select required {...field('ownerId')}>
              <option value="">Choose a coach…</option>
              {activeCoaches.map((c) => (
                <option key={c.id} value={c.id}>{c.name || c.email}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {canChooseOwner && coaches.length > 0 && activeCoaches.length === 0 && (
        <p className="muted">No coach has signed in yet. Invited coaches can own events once they've signed in.</p>
      )}

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
