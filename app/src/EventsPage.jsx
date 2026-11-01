import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Checkbox, Descriptions, Input, Space, Upload } from 'antd'
import { EditOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons'
import DataTable from './DataTable'
import { api } from './api'
import EventBouts from './Bouts'
import { MyInvitations } from './Officials'
import { formatBouts, formatWeight, genderLabel } from './athletes'
import { categorise, compareByCategory } from './categories'
import {
  DEFAULT_TIME_ZONE, MAX_EVENT_DAYS, browserTimeZone, daysBetween, formatDateRange, formatDay, formatInZone, isoToZonedInput,
  timeZoneOptions, yourTimes, zoneAbbr, zoneLabel, zonedInputToIso,
} from './dates'
import { dayProblems, effectiveStatus, hasProblems, isEditableStatus, isOpen, statusLabels } from './events'
import { askConfirm, dash, showError } from './dialogs'
import { BackLink, Badge, PageHeading, DateInput, DateTimeInput, ErrorAlert, Field, FormCard, FullRow, Muted, Pick, Section, Text, TimeInput, Title } from './ui'

const roleLabels = { owner: 'Owner', viewer: 'Viewer' }

const myRole = (event, profile) => event.members.find((m) => m.user_id === profile?.id)?.role ?? null
const ownerOf = (event) => event.members.find((m) => m.role === 'owner')?.user
const personName = (user) => (user ? user.name || user.email : '—')
const userLabel = (u) => (u.name ? `${u.name} (${u.email})` : u.email)
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
      {mine !== zone && <Text type="secondary"> ({formatInZone(event.entry_deadline, mine)} your time)</Text>}
    </>
  )
}

// day: the date the abbreviations are for (EST vs EDT), so they match the event's own label.
function TimeZoneSelect({ value, onChange, day }) {
  const options = useMemo(() => timeZoneOptions(value), [value])
  return (
    <Field label="Time zone">
      <Pick
        value={value}
        onChange={(tz) => tz && onChange(tz)}
        options={options.map((tz) => ({ value: tz, label: `${tz.replaceAll('_', ' ')} (${zoneAbbr(tz, day || undefined)})` }))}
      />
    </Field>
  )
}

// One line saying which time zone an event's times are in.
function ZoneNote({ event }) {
  const zone = zoneOf(event)
  const mine = browserTimeZone()
  return (
    <Muted>
      All times are in {zoneLabel(zone, event.start_date)}.
      {mine !== zone && ` Your browser is on ${zoneLabel(mine, event.start_date)}.`}
    </Muted>
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
          <BackLink onClick={back}>All events</BackLink>
          <PageHeading title="New event" />
          <Muted>
            The event starts as Requested. Its Owner is asked by email to add the poster and the weigh-in and bout times.
            If the email can't be sent automatically, you'll get a ready-made one to send yourself. Approve it whenever
            you're ready.
          </Muted>
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
      <PageHeading title="Events">
        <Button href="#upcoming">Public page</Button>
        {siteAdmin && <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>New event</Button>}
      </PageHeading>
      <ErrorAlert>{error}</ErrorAlert>
      <MyInvitations onOpen={onOpen} />
      {events === null && !error && <Muted>Loading…</Muted>}
      {events?.length === 0 && (
        <Muted>
          {siteAdmin ? 'No events yet. Create one and pick its Owner.' : 'You haven\'t been added to any events yet.'}
        </Muted>
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
  const columns = [
    { title: 'Event', key: 'name', value: (e) => e.name, render: (_, e) => <Button type="link" size="small" style={{ padding: 0 }} onClick={() => onOpen(e.id)}>{e.name}</Button> },
    { title: 'Status', key: 'status', value: (e) => statusLabels[e.shownStatus], render: (_, e) => <StatusBadge status={e.shownStatus} /> },
    { title: 'Dates', key: 'dates', value: (e) => e.start_date, render: (_, e) => formatDateRange(e.start_date, e.end_date) },
    { title: 'Location', key: 'venue', render: (_, e) => dash(e.venue) },
    { title: 'Owner', key: 'owner', render: (_, e) => personName(ownerOf(e)) },
    { title: 'Your role', key: 'role', value: (e) => roleLabels[myRole(e, profile)], render: (_, e) => <RoleBadge role={myRole(e, profile)} /> },
    { title: 'Athletes', dataIndex: 'athlete_count', key: 'athletes' },
  ]
  return (
    <Section title={title}>
      <DataTable rowKey="id" columns={columns} dataSource={events} />
    </Section>
  )
}

function StatusBadge({ status }) {
  return <Badge strong={status === 'active'} muted={status === 'cancelled'}>{statusLabels[status]}</Badge>
}

function RoleBadge({ role }) {
  if (!role) return '—'
  return <Badge>{roleLabels[role]}</Badge>
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
  return (
    <>
      <Field label="Start date"><DateInput value={form.startDate} onChange={(v) => setField('startDate', v)} /></Field>
      <Field label="End date" hint="same as start for one day">
        <DateInput value={form.endDate} min={form.startDate || undefined} onChange={(v) => setField('endDate', v)} />
      </Field>
      {datesBackwards && <FullRow><Text type="danger">The end date is before the start date.</Text></FullRow>}
      {tooLong && <FullRow><Text type="danger">An event can be at most {MAX_EVENT_DAYS} days long.</Text></FullRow>}
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

function FormButtons({ saving, savingText, text, onCancel, disabled }) {
  return (
    <Space wrap>
      <Button type="primary" htmlType="submit" loading={saving} disabled={disabled}>{saving ? savingText : text}</Button>
      <Button onClick={onCancel}>Cancel</Button>
    </Space>
  )
}

function NewEventForm({ onCancel, onCreated }) {
  const [form, setField] = useEventFields({ name: '', venue: '', startDate: '', endDate: '', ownerId: '', timezone: browserTimeZone() })
  const users = useActiveUsers()
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  async function save(e) {
    e.preventDefault()
    setError(null)
    if (!form.ownerId) return setError('Choose the event\'s Owner.')
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
    <form onSubmit={save}>
      <FormCard title="Details">
        <Field label="Name"><Input required {...field('name')} placeholder="e.g. Winter Box Cup" /></Field>
        <Field label="Location" hint="optional"><Input {...field('venue')} /></Field>
        <Field label="Owner">
          <Pick
            value={form.ownerId}
            onChange={(v) => setField('ownerId', v)}
            placeholder="Choose a user…"
            options={users.map((u) => ({ value: u.id, label: userLabel(u) }))}
          />
        </Field>
        <FullRow><Muted>Only people who have signed in at least once can own an event.</Muted></FullRow>
        <TimeZoneSelect value={form.timezone} day={form.startDate} onChange={(tz) => setField('timezone', tz)} />
        <FullRow><Muted>Weigh-in and bout times are in this time zone. We picked your browser's; change it if the event is somewhere else.</Muted></FullRow>
      </FormCard>
      <FormCard title="Dates">
        <DateFields form={form} setField={setField} />
      </FormCard>
      <ErrorAlert>{error}</ErrorAlert>
      <FormButtons saving={saving} savingText="Creating…" text="Create event" onCancel={onCancel} />
    </form>
  )
}

// After creating an event: did the Owner's email go out? If not, offer the Admin's email app.
function EmailNotice({ event, email, onDismiss }) {
  if (!email) return null
  const owner = ownerOf(event)
  if (email.sent) {
    return (
      <Alert
        className="gap"
        type="info"
        showIcon
        closable={{ onClose: onDismiss }}
        title={`We emailed ${personName(owner)} "You have Requested an event".`}
      />
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
    <Alert
      className="gap"
      type="warning"
      showIcon
      closable={{ onClose: onDismiss }}
      title={<>The email to {personName(owner)} wasn't sent automatically ({email.reason}). <a href={mailto}>Send it from your email app</a></>}
    />
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

  const backLink = <BackLink onClick={onBack}>All events</BackLink>

  if (event === undefined) return <>{backLink}{error ? <ErrorAlert>{error}</ErrorAlert> : <Muted>Loading…</Muted>}</>
  if (event === null) return <>{backLink}<p>That event no longer exists.</p></>

  const may = rightsFor(event, profile, siteAdmin)
  const status = effectiveStatus(event)

  async function changeStatus(next, question, options) {
    if (question && !(await askConfirm(question, options))) return
    run(() => api.setEventStatus(event.id, next))
  }

  async function remove() {
    if (!(await askConfirm(`Delete ${event.name} for good? Cancelling keeps a record; deleting doesn't.`, { okText: 'Delete', danger: true }))) return
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
        <PageHeading title={<>Edit {event.name}</>} />
        <DetailsForm event={event} siteAdmin={siteAdmin} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />
      </>
    )
  }
  if (editing === 'times') {
    return (
      <>
        {backLink}
        <PageHeading title={<>Times for {event.name}</>} />
        <TimesForm event={event} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />
      </>
    )
  }

  return (
    <>
      {backLink}
      <PageHeading title={<>{event.name} <StatusBadge status={status} /></>} subtitle={formatDateRange(event.start_date, event.end_date)}>
        {may.edit && <Button icon={<EditOutlined />} onClick={() => setEditing('details')}>Edit details</Button>}
      </PageHeading>
      <EmailNotice event={event} email={email} onDismiss={() => setEmail(null)} />
      <ErrorAlert>{error}</ErrorAlert>

      {siteAdmin && (status === 'requested' || status === 'active') && (
        <Space wrap className="gap">
          {status === 'requested' && (
            <Button type="primary" disabled={busy} onClick={() => changeStatus('active', `Approve ${event.name}? It goes on the public page and can take on people and athletes.`, { okText: 'Approve' })}>
              Approve
            </Button>
          )}
          <Button disabled={busy} onClick={() => changeStatus('done', `Mark ${event.name} as Done now? This can't be undone.`, { okText: 'Mark done' })}>
            Mark done
          </Button>
          <Button danger disabled={busy} onClick={() => changeStatus('cancelled', `Cancel ${event.name}? This can't be undone.`, { okText: 'Cancel event', danger: true })}>
            Cancel event
          </Button>
        </Space>
      )}
      {status === 'requested' && !siteAdmin && (
        <Muted>A site Admin will approve this event. Meanwhile, add the poster and the day times below.</Muted>
      )}
      {may.role === 'owner' && !siteAdmin && isEditableStatus(event) && (
        <Muted>Need this event cancelled? Ask a site Admin.</Muted>
      )}

      <Descriptions
        className="gap"
        size="small"
        column={{ xs: 1, sm: 2, md: 3 }}
        items={[
          { key: 'dates', label: 'Dates', children: formatDateRange(event.start_date, event.end_date) },
          { key: 'venue', label: 'Location', children: dash(event.venue) },
          { key: 'owner', label: 'Owner', children: personName(ownerOf(event)) },
          { key: 'zone', label: 'Time zone', children: zoneLabel(zoneOf(event), event.start_date) },
          { key: 'deadline', label: 'Entry deadline', children: <Deadline event={event} /> },
          { key: 'role', label: 'Your role', children: siteAdmin ? <Badge>Site admin</Badge> : <RoleBadge role={may.role} /> },
        ]}
      />
      {siteAdmin && <ChangeOwner event={event} busy={busy} run={run} />}

      <Poster event={event} canEdit={may.edit} run={run} busy={busy} />
      <Schedule event={event} canEdit={may.edit} onEdit={() => setEditing('times')} />
      <EventClubs event={event} may={may} clubs={clubs} profile={profile} onChange={reload} />
      <EventEntries event={event} may={may} clubs={clubs} profile={profile} onChange={reload} />
      <EventBouts event={event} may={may} clubs={clubs} profile={profile} onEntriesChange={reload} />
      <EventMembers event={event} may={may} onChange={reload} />

      {siteAdmin && (
        <div className="section"><Button danger onClick={remove}>Delete this event</Button></div>
      )}
    </>
  )
}

function ChangeOwner({ event, busy, run }) {
  const users = useActiveUsers()
  const current = ownerOf(event)
  const [choice, setChoice] = useState('')
  const candidates = users.filter((u) => u.id !== current?.id)

  async function save(e) {
    e.preventDefault()
    const user = users.find((u) => u.id === choice)
    if (!user || !(await askConfirm(`Make ${personName(user)} the Owner of ${event.name}? ${personName(current)} stays on as a Viewer.`, { okText: 'Change owner' }))) return
    run(async () => {
      await api.transferEventOwnership(event.id, choice)
      setChoice('')
    })
  }

  return (
    <FormCard compact onSubmit={save} actions={<Button htmlType="submit" disabled={busy || !choice}>Change</Button>}>
      <Field label="Change owner">
        <Pick value={choice} onChange={setChoice} placeholder="Choose a user…" options={candidates.map((u) => ({ value: u.id, label: userLabel(u) }))} />
      </Field>
    </FormCard>
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
    if (lostDays.length && !(await askConfirm(`The new dates drop the times for ${lostDays.map((d) => formatDay(d.day)).join(', ')}. Continue?`, { okText: 'Continue' }))) return
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
    <form onSubmit={save}>
      <FormCard title="Details">
        <Field label="Name"><Input required {...field('name')} /></Field>
        <Field label="Location" hint="optional"><Input {...field('venue')} /></Field>
        {siteAdmin && <TimeZoneSelect value={form.timezone} day={form.startDate} onChange={(tz) => setField('timezone', tz)} />}
      </FormCard>
      <FormCard title="Dates">
        <DateFields form={form} setField={setField} />
      </FormCard>
      <FormCard title={<>Entry deadline <Text type="secondary">(optional)</Text></>}>
        <Field label={`Entries close at (${zoneAbbr(form.timezone, form.endDate)})`}>
          <DateTimeInput value={form.deadline} onChange={(v) => setField('deadline', v)} allowClear placeholder="No deadline" />
        </Field>
        <FullRow><Muted>After the deadline, clubs can't enter athletes themselves; they can send you a late-entry request. Clear the field for no deadline.</Muted></FullRow>
      </FormCard>
      <ErrorAlert>{error}</ErrorAlert>
      <FormButtons saving={saving} savingText="Saving…" text="Save changes" onCancel={onCancel} />
    </form>
  )
}

function Poster({ event, canEdit, run, busy }) {
  const url = api.posterUrl(event.poster_path)
  if (!url && !canEdit) return null

  function upload(file) {
    if (!file) return
    if (!file.type.startsWith('image/')) return showError('Pick an image file (PNG, JPG, WebP or GIF).')
    if (file.size > 5 * 1024 * 1024) return showError('Posters must be under 5 MB.')
    run(() => api.uploadPoster(event.id, file, event.poster_path))
  }

  return (
    <Section title="Poster">
      {url ? <img className="poster" src={url} alt={`Poster for ${event.name}`} /> : <Muted>No poster yet. It's optional.</Muted>}
      {canEdit && (
        <Space wrap>
          <Upload
            accept="image/png,image/jpeg,image/webp,image/gif"
            showUploadList={false}
            disabled={busy}
            beforeUpload={(file) => { upload(file); return false }}
          >
            <Button icon={<UploadOutlined />} disabled={busy}>{url ? 'Replace poster' : 'Upload poster'}</Button>
          </Upload>
          {url && (
            <Button disabled={busy} onClick={() => run(() => api.removePoster(event.id, event.poster_path))}>Remove</Button>
          )}
        </Space>
      )}
    </Section>
  )
}

function Schedule({ event, canEdit, onEdit }) {
  const days = daysBetween(event.start_date, event.end_date)
  const byDay = Object.fromEntries(event.days.map((d) => [d.day, d]))
  const zone = zoneOf(event)
  const mine = browserTimeZone()
  const away = mine !== zone
  const columns = [
    { title: 'Day', key: 'day', value: (day) => day, render: (_, day) => formatDay(day) },
    {
      title: 'Weigh-in',
      key: 'weigh',
      value: (day) => byDay[day]?.weigh_in_start,
      render: (_, day) => {
        const d = byDay[day]
        if (!d) return <Text type="secondary">No bouts</Text>
        return (
          <>
            {`${d.weigh_in_start}–${d.weigh_in_end} ${zoneAbbr(zone, day)}`}
            {away && <div><Text type="secondary">{yourTimes(day, [d.weigh_in_start, d.weigh_in_end], zone, mine)} your time</Text></div>}
          </>
        )
      },
    },
    {
      title: 'Bout sessions',
      key: 'sessions',
      value: (day) => byDay[day]?.sessions.map((s) => `${s.label ?? ''} ${s.starts_at}`).join(' '),
      render: (_, day) => {
        const d = byDay[day]
        if (!d) return ''
        return (
          <>
            {`${d.sessions.map((s) => (s.label ? `${s.label} ${s.starts_at}` : s.starts_at)).join(', ')} ${zoneAbbr(zone, day)}`}
            {away && <div><Text type="secondary">{yourTimes(day, d.sessions.map((s) => s.starts_at), zone, mine, ', ')} your time</Text></div>}
          </>
        )
      },
    },
  ]
  return (
    <Section
      title="Day times"
      extra={canEdit && <Button onClick={onEdit}>{event.days.length ? 'Edit times' : 'Add times'}</Button>}
    >
      {event.days.length === 0 ? (
        <Muted>No times yet. Each day with bouts needs a weigh-in and at least one bout session.</Muted>
      ) : (
        <>
          <ZoneNote event={event} />
          <DataTable rowKey={(day) => day} columns={columns} dataSource={days} />
        </>
      )}
    </Section>
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
    <form onSubmit={save}>
      <ZoneNote event={event} />
      <Muted>
        Each day with bouts has one weigh-in and one or more bout sessions. The weigh-in lasts at least 2 hours and ends at least
        3 hours before that day's first bout.
      </Muted>
      {days.map((d, i) => (
        <FormCard key={d.day} title={formatDay(d.day)}>
          <FullRow>
            <Checkbox checked={d.bouts} onChange={(e) => update(i, () => ({ bouts: e.target.checked }))}>Bouts on this day</Checkbox>
          </FullRow>
          {d.bouts && (
            <>
              <Field label="Weigh-in starts">
                <TimeInput value={d.weigh_in_start} onChange={(v) => update(i, () => ({ weigh_in_start: v }))} status={problems[i].weighIn.length ? 'error' : undefined} />
              </Field>
              <Field label="Weigh-in ends">
                <TimeInput value={d.weigh_in_end} onChange={(v) => update(i, () => ({ weigh_in_end: v }))} status={problems[i].weighIn.length ? 'error' : undefined} />
              </Field>
              {problems[i].weighIn.map((p) => <FullRow key={p}><Text type="danger">{p}</Text></FullRow>)}
              <Field full label={<>Bout sessions <Text type="secondary">(name optional)</Text></>}>
                {d.sessions.map((s, j) => (
                  <div className="schedule-row" key={j}>
                    <Input
                      value={s.label}
                      maxLength={40}
                      placeholder={j === 0 ? 'e.g. Afternoon' : 'e.g. Evening'}
                      onChange={(e) => setSession(i, j, 'label', e.target.value)}
                      aria-label={`Session ${j + 1} name`}
                    />
                    <TimeInput
                      value={s.starts_at}
                      onChange={(v) => setSession(i, j, 'starts_at', v)}
                      aria-label={`Session ${j + 1} start`}
                      placeholder="Starts"
                      status={problems[i].sessions.length ? 'error' : undefined}
                    />
                    {d.sessions.length > 1 && (
                      <Button type="link" onClick={() => update(i, (day) => ({ sessions: day.sessions.filter((_, k) => k !== j) }))}>
                        Remove
                      </Button>
                    )}
                  </div>
                ))}
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => update(i, (day) => ({ sessions: [...day.sessions, { starts_at: '', label: '' }] }))}>
                  Add a session
                </Button>
              </Field>
              {problems[i].sessions.map((p) => <FullRow key={p}><Text type="danger">{p}</Text></FullRow>)}
            </>
          )}
        </FormCard>
      ))}
      <ErrorAlert>{error}</ErrorAlert>
      <FormButtons saving={saving} savingText="Saving…" text="Save times" onCancel={onCancel} disabled={blocked} />
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

  async function remove(ec) {
    const entered = event.athletes.filter((a) => a.entry_club_id === ec.club_id).length
    const withdrawing = ec.status === 'requested' && owns(ec.club_id) && !may.manageClubs
    const question = withdrawing
      ? `Withdraw ${ec.club?.name}'s request to join?`
      : `Take ${ec.club?.name} out of ${event.name}?${entered ? ` Its ${entered} entered athlete${entered === 1 ? ' is' : 's are'} withdrawn too.` : ''}`
    if (!(await askConfirm(question, { okText: withdrawing ? 'Withdraw' : 'Remove', danger: !withdrawing }))) return
    run(() => api.removeEventClub(event.id, ec.club_id))
  }

  if (!may.manageClubs && rows.length === 0 && canJoin.length === 0) return null

  const columns = [
    { title: 'Club', key: 'club', render: (_, ec) => ec.club?.name ?? '—' },
    { title: 'Status', key: 'status', value: (ec) => clubStatusLabels[ec.status], render: (_, ec) => <Badge strong={ec.status === 'accepted'} muted={ec.status === 'declined'}>{clubStatusLabels[ec.status]}</Badge> },
    { title: 'Athletes entered', key: 'count', render: (_, ec) => (ec.status === 'accepted' ? event.athletes.filter((a) => a.entry_club_id === ec.club_id).length : '') },
    {
      key: 'actions',
      className: 'actions',
      render: (_, ec) => (
        <Space>
          {may.manageClubs && ec.status === 'requested' && (
            <>
              <Button size="small" type="primary" disabled={busy} onClick={() => run(() => api.decideJoinRequest(event.id, ec.club_id, true))}>Accept</Button>
              <Button size="small" disabled={busy} onClick={() => run(() => api.decideJoinRequest(event.id, ec.club_id, false))}>Decline</Button>
            </>
          )}
          {(may.manageClubs || (owns(ec.club_id) && may.editable)) && ec.status !== 'declined' && (
            <Button size="small" disabled={busy} onClick={() => remove(ec)}>
              {ec.status === 'requested' && !may.manageClubs ? 'Withdraw request' : may.manageClubs ? 'Remove' : 'Leave event'}
            </Button>
          )}
        </Space>
      ),
    },
  ]

  return (
    <Section title={`Clubs (${event.clubs.filter((ec) => ec.status === 'accepted').length})`}>
      {effectiveStatus(event) === 'requested' && <Muted>Clubs can join once the event is approved.</Muted>}
      {may.manageClubs && may.open && (
        <FormCard compact onSubmit={invite} actions={<Button type="primary" htmlType="submit" disabled={busy || !choice}>Invite</Button>}>
          <Field label="Invite a club">
            <Pick
              value={choice}
              onChange={setChoice}
              placeholder={invitable.length ? 'Choose a club…' : 'Every club is already in'}
              options={invitable.map((c) => ({ value: c.id, label: `${c.name}${byClub[c.id]?.status === 'requested' ? ' (asked to join)' : ''}` }))}
            />
          </Field>
        </FormCard>
      )}
      {may.open && canJoin.length > 0 && (
        <Space wrap className="gap">
          {canJoin.map((c) => (
            <Button key={c.id} disabled={busy} onClick={() => run(() => api.requestToJoin(event.id, c.id))}>
              Ask to join for {c.name}
            </Button>
          ))}
        </Space>
      )}
      <ErrorAlert>{error}</ErrorAlert>
      {rows.length > 0 && <DataTable rowKey="club_id" columns={columns} dataSource={rows} />}
    </Section>
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

  async function withdraw(a) {
    if (!(await askConfirm(`Withdraw ${a.name} from ${event.name}?`, { okText: 'Withdraw' }))) return
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

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Age group', key: 'age', value: (a) => a.categories.age?.label, render: (_, a) => <AgeCell category={a.categories.age} /> },
    { title: 'Gender', key: 'gender', render: (_, a) => genderLabel(a.gender) },
    { title: 'Weight class', key: 'weight', value: (a) => a.weight_kg, render: (_, a) => <WeightCell category={a.categories.weight} weightKg={a.weight_kg} /> },
    { title: 'Experience', key: 'exp', value: (a) => a.bouts, render: (_, a) => <ExperienceCell category={a.categories.experience} bouts={a.bouts} /> },
    { title: 'Club', key: 'club', render: (_, a) => dash(a.club) },
    {
      title: 'Suggested opponent',
      key: 'suggestion',
      value: (a) => [a.suggested_opponent_name, a.suggested_opponent_club].filter(Boolean).join(', '),
      render: (_, a) => (editing === a.id ? (
        <Space.Compact>
          <Input size="small" aria-label="Opponent name" placeholder="Name" maxLength={100} value={suggestion.name} onChange={(e) => setSuggestion({ ...suggestion, name: e.target.value })} />
          <Input size="small" aria-label="Opponent club" placeholder="Club" maxLength={100} value={suggestion.club} onChange={(e) => setSuggestion({ ...suggestion, club: e.target.value })} />
          <Button size="small" type="primary" disabled={busy} onClick={() => saveSuggestion(a)}>Save</Button>
          <Button size="small" onClick={() => setEditing(null)}>Cancel</Button>
        </Space.Compact>
      ) : (
        [a.suggested_opponent_name, a.suggested_opponent_club].filter(Boolean).join(', ') || '—'
      )),
    },
    showActions && {
      key: 'actions',
      className: 'actions',
      render: (_, a) => canChange(a) && editing !== a.id && (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => { setEditing(a.id); setSuggestion({ name: a.suggested_opponent_name ?? '', club: a.suggested_opponent_club ?? '' }) }}>
            {a.suggested_opponent_name || a.suggested_opponent_club ? 'Edit suggestion' : 'Suggest opponent'}
          </Button>
          <Button type="link" size="small" disabled={busy} onClick={() => withdraw(a)}>Withdraw</Button>
        </Space>
      ),
    },
  ].filter(Boolean)

  return (
    <Section title={`Athletes (${event.athletes.length})`}>
      {effectiveStatus(event) === 'requested' && <Muted>Athletes can be entered once the event is approved.</Muted>}
      {canEnter && (
        <FormCard
          title={late ? 'Ask for a late entry' : 'Enter an athlete'}
          onSubmit={enter}
          actions={<Button type="primary" htmlType="submit" disabled={busy || !form.athleteId}>{late ? 'Send request' : 'Enter'}</Button>}
        >
          {late && <FullRow><Muted>The entry deadline has passed. The event's Owner will accept or decline your request.</Muted></FullRow>}
          <Field label="Athlete">
            <Pick
              value={form.athleteId}
              onChange={(athleteId) => setForm({ ...form, athleteId })}
              placeholder={available.length ? 'Choose an athlete…' : may.siteAdmin ? 'Every athlete in the event\'s clubs is entered' : 'All your club\'s athletes are entered'}
              options={available.map((a) => ({
                value: a.id,
                label: [a.name, a.club, genderLabel(a.gender), formatWeight(a.weight_kg)].filter((v) => v && v !== '—').join(' · '),
              }))}
            />
          </Field>
          {late ? (
            <Field label="Note" hint="optional"><Input maxLength={500} {...field('note')} /></Field>
          ) : (
            <>
              <Field label="Suggested opponent" hint="optional"><Input maxLength={100} placeholder="Name" {...field('opponentName')} /></Field>
              <Field label="Their club"><Input maxLength={100} placeholder="Club" {...field('opponentClub')} /></Field>
            </>
          )}
        </FormCard>
      )}
      <ErrorAlert>{error}</ErrorAlert>
      <LateEntries event={event} may={may} ownedIds={ownedIds} profile={profile} run={run} busy={busy} />
      {event.athletes.length === 0 ? (
        <Muted>No athletes entered yet.</Muted>
      ) : (
        <>
          <Muted>
            Age group is by year of birth as of {event.start_date.slice(0, 4)}. Weight class uses the athlete's current weight.
            Novice is 10 bouts or fewer, Open is more.
          </Muted>
          <DataTable rowKey="id" columns={columns} dataSource={athletes} />
        </>
      )}
    </Section>
  )
}

const lateLabels = { pending: 'Waiting', accepted: 'Accepted', declined: 'Declined', cancelled: 'Withdrawn' }

function LateEntries({ event, may, ownedIds, profile, run, busy }) {
  const requests = event.late_entries
  if (requests.length === 0) return null
  const canCancel = (r) => may.siteAdmin || r.requested_by === profile?.id || ownedIds.has(r.club_id)
  const columns = [
    { title: 'Athlete', key: 'athlete', render: (_, r) => r.athlete?.name ?? '—' },
    { title: 'Club', key: 'club', render: (_, r) => r.club?.name ?? '—' },
    { title: 'Note', key: 'note', render: (_, r) => r.note || '' },
    { title: 'Status', key: 'status', value: (r) => lateLabels[r.status], render: (_, r) => <Badge muted={['declined', 'cancelled'].includes(r.status)}>{lateLabels[r.status]}</Badge> },
    {
      key: 'actions',
      className: 'actions',
      render: (_, r) => (
        <Space>
          {r.status === 'pending' && may.manageClubs && (
            <>
              <Button size="small" type="primary" disabled={busy} onClick={() => run(() => api.decideLateEntry(r.id, true))}>Accept</Button>
              <Button size="small" disabled={busy} onClick={() => run(() => api.decideLateEntry(r.id, false))}>Decline</Button>
            </>
          )}
          {r.status === 'pending' && !may.manageClubs && canCancel(r) && (
            <Button size="small" disabled={busy} onClick={() => run(() => api.cancelLateEntry(r.id))}>Withdraw</Button>
          )}
        </Space>
      ),
    },
  ]
  return (
    <Card size="small" title="Late-entry requests" className="gap">
      <DataTable rowKey="id" columns={columns} dataSource={requests} />
    </Card>
  )
}

function AgeCell({ category }) {
  if (!category) return '—'
  return (
    <>
      <Badge muted={category.key === 'too-young'}>{category.label}</Badge>
      <Text type="secondary">{category.age}</Text>
    </>
  )
}

function WeightCell({ category, weightKg }) {
  if (!category) return <>{formatWeight(weightKg)}{weightKg != null && <Text type="secondary"> (no class)</Text>}</>
  return (
    <>
      <Badge muted={category.below} title={category.name}>{category.label}</Badge>
      <Text type="secondary">{formatWeight(weightKg)}</Text>
    </>
  )
}

function ExperienceCell({ category, bouts }) {
  if (!category) return '—'
  return (
    <>
      <Badge>{category.label}</Badge>
      <Text type="secondary">{formatBouts(bouts)}</Text>
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

  const columns = [
    { title: 'Name', key: 'name', render: (_, m) => m.user?.name || '—' },
    { title: 'Email', key: 'email', render: (_, m) => m.user?.email || '—' },
    { title: 'Role', key: 'role', value: (m) => roleLabels[m.role], render: (_, m) => <RoleBadge role={m.role} /> },
    may.members && {
      key: 'actions',
      className: 'actions',
      render: (_, m) => m.role !== 'owner' && (
        <Button size="small" disabled={busy} onClick={() => run(() => api.removeEventMember(event.id, m.user_id))}>Remove</Button>
      ),
    },
  ].filter(Boolean)

  return (
    <Section title={`People (${event.members.length})`}>
      <Muted>
        Viewers can see the event's details and times. Clubs enter athletes through the Clubs section above.
        {effectiveStatus(event) === 'requested' && ' People can be added once the event is approved.'}
      </Muted>
      {may.addMembers && (
        <FormCard compact onSubmit={add} actions={<Button type="primary" htmlType="submit" disabled={busy || !form.userId}>Add</Button>}>
          <Field label="Add a viewer">
            <Pick
              value={form.userId}
              onChange={(userId) => setForm({ ...form, userId })}
              placeholder={addable.length ? 'Choose a user…' : 'Everyone is already on this event'}
              options={addable.map((u) => ({ value: u.id, label: userLabel(u) }))}
            />
          </Field>
        </FormCard>
      )}
      <ErrorAlert>{error}</ErrorAlert>
      <DataTable rowKey="user_id" columns={columns} dataSource={members} />
    </Section>
  )
}
