// Officials on an event (plan/events.md, "Inviting officials"): the Owner or a site Admin
// invites officials, officials accept or decline, and the CO and Deputy are picked from
// those who accepted. Also the "Your invitations" list on the Events page.
import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card as AntCard, Checkbox, Modal, Segmented, Select, Space, Tabs } from 'antd'
import DataTable from './DataTable'
import { api } from './api'
import { daysBetween, formatDateRange, formatDay, formatShortDay, todayIso } from './dates'
import { effectiveStatus } from './events'
import { askConfirm } from './dialogs'
import { Badge, DateInput, ErrorAlert, Field, FormCard, FullRow, Muted, Pick, Section, Text } from './ui'

const officialLabels = { chief: 'Chief Official', deputy: 'Deputy' }
const answerLabels = { accepted: 'Accepted', declined: 'Declined', pending: 'Waiting', expired: 'No response' }
const personName = (user) => (user ? user.name || user.email : '—')
const siteUrl = () => window.location.origin + import.meta.env.BASE_URL

// 'accepted', 'declined', 'pending' or 'expired' (pending past its respond-by date).
function answerOf(invitation, timeZone) {
  if (invitation.status === 'pending' && invitation.respond_by && todayIso(timeZone) > invitation.respond_by) return 'expired'
  return invitation.status
}

// Can the official still answer? Until the event's first day, and not after an unanswered respond-by date.
function canAnswer(invitation, event) {
  if (effectiveStatus(event) !== 'active' || event.status !== 'active') return false
  if (todayIso(event.timezone) >= event.start_date) return false
  return answerOf(invitation, event.timezone) !== 'expired'
}

function AnswerBadge({ answer }) {
  return <Badge strong={answer === 'accepted'} muted={answer === 'declined' || answer === 'expired'}>{answerLabels[answer]}</Badge>
}

// "Accepted 3 · Declined 1 · Waiting 2"
function countAnswers(invitations, timeZone) {
  const counts = { accepted: 0, declined: 0, waiting: 0 }
  for (const i of invitations) {
    const answer = answerOf(i, timeZone)
    if (answer === 'accepted') counts.accepted += 1
    else if (answer === 'declined') counts.declined += 1
    else counts.waiting += 1
  }
  return counts
}

const sessionKey = (day, startsAt) => `${day} ${startsAt.slice(0, 5)}`
const sessionName = (session) => `${session.starts_at.slice(0, 5)}${session.label ? ` ${session.label}` : ''}`

// What an accepted official works, as text: "All days", "Whole event", or
// "Sun, Nov 15 (18:30 Evening), Mon, Nov 16". Sessions show by start time and label when known.
function daysText(invitation, event) {
  const all = daysBetween(event.start_date, event.end_date)
  const days = (invitation.days ?? all).filter((d) => all.includes(d))
  const sessions = invitation.sessions ?? []
  if (sessions.length === 0 && days.length === all.length) return all.length > 1 ? 'All days' : 'Whole event'
  return days.map((d) => {
    const times = sessions.filter((k) => k.startsWith(d)).map((k) => {
      const time = k.slice(11)
      const session = event.days?.find((x) => x.day === d)?.sessions?.find((x) => x.starts_at.slice(0, 5) === time)
      return session ? sessionName(session) : time
    })
    return times.length ? `${formatShortDay(d)} (${times.join(', ')})` : formatShortDay(d)
  }).join(', ')
}

// Accepting asks which days, and on days with more than one bout session, whole day or which
// sessions. ask(event, invitation) resolves to { days, sessions } or null when cancelled.
// The event needs its days and sessions; pass { id } alone and they are loaded.
function useAcceptDays() {
  const [asking, setAsking] = useState(null) // { event, all, picked: { [day]: 'all' | [times] }, resolve }
  async function ask(eventOrId, invitation) {
    const event = eventOrId.days ? eventOrId : await api.getEvent(eventOrId.id)
    const all = daysBetween(event.start_date, event.end_date)
    const sessionsOf = (d) => event.days?.find((x) => x.day === d)?.sessions ?? []
    if (all.length <= 1 && sessionsOf(all[0]).length <= 1) return { days: all, sessions: [] }
    const picked = {}
    const days = invitation?.status === 'accepted' && invitation.days?.length ? invitation.days : all
    for (const d of days.filter((x) => all.includes(x))) {
      const times = (invitation?.sessions ?? []).filter((k) => k.startsWith(d)).map((k) => k.slice(11))
      picked[d] = times.length ? times : 'all'
    }
    return new Promise((resolve) => setAsking({ event, all, sessionsOf, picked, resolve }))
  }
  function close(value) {
    asking?.resolve(value)
    setAsking(null)
  }
  function result() {
    const days = asking.all.filter((d) => asking.picked[d] && (asking.picked[d] === 'all' || asking.picked[d].length))
    const sessions = days.flatMap((d) => (asking.picked[d] === 'all' ? [] : asking.picked[d].map((t) => sessionKey(d, t))))
    return { days, sessions }
  }
  const pick = (d, value) => setAsking({ ...asking, picked: { ...asking.picked, [d]: value } })
  const ready = asking ? result().days.length > 0 : false

  const dialog = (
    <Modal
      open={Boolean(asking)}
      title="When can you officiate?"
      okText="Accept"
      okButtonProps={{ disabled: !ready }}
      onOk={() => close(result())}
      onCancel={() => close(null)}
    >
      {asking && (
        <>
          <Muted>
            {asking.event.name} runs {formatDateRange(asking.event.start_date, asking.event.end_date)}. Pick the days you can
            work, and on a day with more than one bout session, the whole day or just some sessions. Working any part of a day
            lets you record that day's weigh-in.
          </Muted>
          <Space orientation="vertical" size="middle" style={{ width: '100%', marginTop: 12 }}>
            {asking.all.map((d) => {
              const sessions = asking.sessionsOf(d)
              const value = asking.picked[d]
              return (
                <div key={d}>
                  <Checkbox checked={Boolean(value)} onChange={(e) => pick(d, e.target.checked ? 'all' : undefined)}>
                    {formatDay(d)}
                  </Checkbox>
                  {value && sessions.length > 1 && (
                    <div style={{ marginLeft: 24, marginTop: 8 }}>
                      <Segmented
                        size="small"
                        value={value === 'all' ? 'all' : 'some'}
                        onChange={(mode) => pick(d, mode === 'all' ? 'all' : [])}
                        options={[{ value: 'all', label: 'Whole day' }, { value: 'some', label: 'Some sessions' }]}
                      />
                      {value !== 'all' && (
                        <Checkbox.Group
                          style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}
                          value={value}
                          onChange={(times) => pick(d, times)}
                          options={sessions.map((x) => ({ value: x.starts_at.slice(0, 5), label: sessionName(x) }))}
                        />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </Space>
        </>
      )}
    </Modal>
  )
  return { ask, dialog }
}

// ---------------------------------------------------------------------------
// The event's Officials section
// ---------------------------------------------------------------------------

// officials: the event's CO and Deputy rows. run: the bouts section's runner, which reloads them.
export function EventOfficials({ event, may, profile, officials, busy, run }) {
  const manager = may.siteAdmin || may.role === 'owner'
  // The Chief Official and Deputy see the lists too, but can't invite or remove.
  const seesLists = manager || officials.some((o) => o.user_id === profile?.id)
  const [invitations, setInvitations] = useState([])
  const [mine, setMine] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      if (seesLists) {
        setInvitations(await api.listEventInvitations(event.id))
      }
      const own = await api.listMyInvitations()
      setMine(own.find((i) => i.event_id === event.id) ?? null)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [event.id, seesLists])

  useEffect(() => {
    load()
  }, [load])

  const act = (action) => run(async () => {
    await action()
    await load()
  })

  const byRole = Object.fromEntries(officials.map((o) => [o.role, o]))
  const missing = ['chief', 'deputy'].filter((r) => !byRole[r])
  const counts = countAnswers(invitations, event.timezone)
  const extra = seesLists && invitations.length > 0
    ? <Text type="secondary">{counts.accepted} accepted · {counts.declined} declined · {counts.waiting} waiting</Text>
    : null

  return (
    <Section title={seesLists ? `Officials (${counts.accepted})` : 'Officials'} extra={extra}>
      <ErrorAlert>{error}</ErrorAlert>
      {mine && <MyAnswer invitation={mine} event={event} busy={busy} act={act} />}
      {missing.length > 0 && (
        <Muted>Every event needs a Chief Official and a Deputy. They approve bouts, run the weigh-in and record results.</Muted>
      )}
      {seesLists ? (
        <Manage event={event} may={may} manager={manager} invitations={invitations} byRole={byRole} busy={busy} act={act} />
      ) : (
        <AntCard size="small" className="form-card">
          <Space size="large" wrap>
            {['chief', 'deputy'].map((role) => (
              <span key={role}>
                <Text type="secondary">{officialLabels[role]}: </Text>
                <Text strong>{byRole[role] ? personName(byRole[role].user) : 'Not chosen'}</Text>
              </span>
            ))}
          </Space>
        </AntCard>
      )}
    </Section>
  )
}

// The signed-in official's own invitation to this event.
function MyAnswer({ invitation, event, busy, act }) {
  const answer = answerOf(invitation, event.timezone)
  const open = canAnswer(invitation, event)
  // Something to choose: more than one day, or more than one bout session.
  const choice = daysBetween(event.start_date, event.end_date).length > 1 || event.days.some((d) => d.sessions.length > 1)
  const { ask, dialog } = useAcceptDays()
  async function accept() {
    const parts = await ask(event, invitation)
    if (parts) act(() => api.respondToInvitation(invitation.id, true, parts.days, parts.sessions))
  }
  return (
    <AntCard size="small" className="form-card gap">
      {dialog}
      <Space wrap>
        <Text>You're invited to officiate this event.</Text>
        <AnswerBadge answer={answer} />
        {answer === 'accepted' && choice && <Text type="secondary">{daysText(invitation, event)}</Text>}
        {invitation.respond_by && answer === 'pending' && <Text type="secondary">Please answer by {formatDay(invitation.respond_by)}.</Text>}
        {open && (answer !== 'accepted' || choice) && (
          <Button size="small" type={answer === 'accepted' ? 'default' : 'primary'} disabled={busy} onClick={accept}>{answer === 'accepted' ? 'Change days' : 'Accept'}</Button>
        )}
        {open && answer !== 'declined' && (
          <Button size="small" disabled={busy} onClick={() => act(() => api.respondToInvitation(invitation.id, false))}>Decline</Button>
        )}
      </Space>
      {!open && answer === 'expired' && <Muted>The respond-by date has passed. Ask the event's Owner to invite you again.</Muted>}
    </AntCard>
  )
}

// Owner and site Admin view: invite, pick the CO and Deputy, see who answered what.
// The CO and Deputy get the same lists without the buttons.
function Manage({ event, may, manager, invitations, byRole, busy, act }) {
  const [officialsList, setOfficialsList] = useState([])
  const [choice, setChoice] = useState([])
  const [respondBy, setRespondBy] = useState('')
  const [tab, setTab] = useState('accepted')
  const [email, setEmail] = useState(null) // { sent, failed: [{ name, email }], reason }
  const canInvite = manager && may.open

  useEffect(() => {
    if (canInvite) api.listInvitableOfficials(event.id).then(setOfficialsList, () => setOfficialsList([]))
  }, [canInvite, event.id])

  const byOfficial = Object.fromEntries(invitations.map((i) => [i.official_id, i]))
  const accepted = invitations.filter((i) => answerOf(i, event.timezone) === 'accepted')
  const declined = invitations.filter((i) => answerOf(i, event.timezone) === 'declined')
  const waiting = invitations.filter((i) => ['pending', 'expired'].includes(answerOf(i, event.timezone)))
  const invitable = officialsList.filter((o) => byOfficial[o.id]?.status !== 'accepted')
  const eventDays = daysBetween(event.start_date, event.end_date)
  const multiDay = eventDays.length > 1
  const onDay = (day) => accepted.filter((i) => (i.days ?? eventDays).includes(day)).length
  const roleOf = (userId) => Object.entries(byRole).find(([, o]) => o.user_id === userId)?.[0]
  const today = todayIso(event.timezone)

  async function send(officialIds, deadline) {
    let ids = []
    const ok = await act(async () => {
      ids = await api.inviteOfficials(event.id, officialIds, deadline)
    })
    if (!ok) return false
    if (ids.length === 0) {
      setEmail(null)
      return true
    }
    const results = await Promise.allSettled(ids.map((id) => api.emailOfficialInvitation(id)))
    const failedIds = ids.filter((_, n) => results[n].status === 'rejected')
    const reason = results.find((r) => r.status === 'rejected')?.reason?.message
    const latest = await api.listEventInvitations(event.id).catch(() => invitations)
    const failed = latest.filter((i) => failedIds.includes(i.id)).map((i) => ({ name: i.name, email: i.email, respondBy: i.respond_by }))
    setEmail({ sent: ids.length - failedIds.length, failed, reason })
    return true
  }

  async function invite(e) {
    e.preventDefault()
    if (choice.length === 0) return
    if (await send(choice, respondBy)) {
      setChoice([])
      setTab('waiting')
    }
  }

  async function reinvite(i) {
    const when = respondBy ? ` They have until ${formatDay(respondBy)} to answer.` : ''
    if (!(await askConfirm(`Invite ${i.name} again?${when}`, { okText: 'Invite again' }))) return
    send([i.official_id], respondBy)
  }

  async function remove(i) {
    const answer = answerOf(i, event.timezone)
    const role = roleOf(i.user_id)
    const question = answer === 'accepted'
      ? `Take ${i.name} off ${event.name}?${role ? ` They stop being ${officialLabels[role]}.` : ''}`
      : `Cancel the invitation to ${i.name}?`
    if (!(await askConfirm(question, { okText: answer === 'accepted' ? 'Remove' : 'Cancel invitation', danger: true }))) return
    act(() => api.cancelInvitation(i.id))
  }

  const pickable = accepted.filter((i) => i.user_id)
  const roleOptions = [{ value: '', label: 'Not chosen' }, ...pickable.map((i) => ({ value: i.user_id, label: i.email ? `${i.name} (${i.email})` : i.name }))]

  const columns = [
    { title: 'Name', key: 'name', dataIndex: 'name' },
    { title: 'Email', key: 'email', render: (_, i) => i.email ?? '—' },
    {
      title: 'Answer', key: 'answer', value: (i) => answerLabels[answerOf(i, event.timezone)],
      render: (_, i) => (
        <Space size={4} wrap>
          <AnswerBadge answer={answerOf(i, event.timezone)} />
          {roleOf(i.user_id) && <Badge strong>{officialLabels[roleOf(i.user_id)]}</Badge>}
        </Space>
      ),
    },
    (multiDay || event.days.some((d) => d.sessions.length > 1)) && {
      title: 'Days', key: 'days', value: (i) => (i.status === 'accepted' ? daysText(i, event) : ''),
      render: (_, i) => (i.status === 'accepted' ? daysText(i, event) : '—'),
    },
    {
      title: 'Respond by', key: 'respond_by', value: (i) => i.respond_by ?? '',
      render: (_, i) => (i.respond_by ? formatDay(i.respond_by) : '—'),
    },
    {
      title: 'Invited', key: 'invited_at', value: (i) => i.invited_at,
      render: (_, i) => formatDay(i.invited_at.slice(0, 10)),
    },
    may.edit && {
      key: 'actions',
      className: 'actions',
      render: (_, i) => {
        const answer = answerOf(i, event.timezone)
        return (
          <Space>
            {canInvite && answer !== 'accepted' && (
              <Button size="small" disabled={busy} onClick={() => reinvite(i)}>{answer === 'pending' ? 'Resend' : 'Invite again'}</Button>
            )}
            <Button size="small" disabled={busy} onClick={() => remove(i)}>{answer === 'accepted' ? 'Remove' : 'Cancel'}</Button>
          </Space>
        )
      },
    },
  ].filter(Boolean)

  const list = (rows, empty) => (rows.length ? <DataTable rowKey="id" columns={columns} dataSource={rows} /> : <Muted>{empty}</Muted>)

  return (
    <>
      {manager && effectiveStatus(event) === 'requested' && <Muted>Officials can be invited once the event is approved.</Muted>}
      {canInvite && (
        <FormCard
          onSubmit={invite}
          actions={<Button type="primary" htmlType="submit" disabled={busy || choice.length === 0}>Send invitations</Button>}
        >
          <Field label="Invite officials">
            <Select
              mode="multiple"
              aria-label="Officials to invite"
              value={choice}
              onChange={setChoice}
              placeholder={officialsList.length === 0 ? 'Add officials on the Admin page first' : invitable.length ? 'Choose officials…' : 'Every official has accepted'}
              optionFilterProp="label"
              style={{ width: '100%' }}
              options={invitable.map((o) => {
                const status = byOfficial[o.id] ? answerOf(byOfficial[o.id], event.timezone) : null
                const notes = [status && `${answerLabels[status].toLowerCase()}`, !o.signed_in && 'hasn\'t signed in yet'].filter(Boolean)
                return { value: o.id, label: `${o.name}${notes.length ? ` (${notes.join(', ')})` : ''}` }
              })}
            />
          </Field>
          <Field label="Respond by" hint="optional">
            <DateInput value={respondBy} onChange={setRespondBy} min={today} />
          </Field>
          <FullRow>
            <Muted>Each official gets an email with a link to accept or decline. Anyone who hasn't signed in before can sign in with that email address.</Muted>
          </FullRow>
        </FormCard>
      )}
      <EmailNotice email={email} event={event} onDismiss={() => setEmail(null)} />

      <FormCard compact>
        {['chief', 'deputy'].map((role) => (
          <Field key={role} label={officialLabels[role]}>
            {may.edit ? (
              <Pick
                allowEmpty
                aria-label={officialLabels[role]}
                value={byRole[role]?.user_id ?? ''}
                disabled={busy}
                onChange={(value) => act(() => api.setEventOfficial(event.id, role, value))}
                options={roleOptions}
              />
            ) : (
              <Text strong>{byRole[role] ? personName(byRole[role].user) : 'Not chosen'}</Text>
            )}
          </Field>
        ))}
        {may.edit && pickable.length === 0 && (
          <FullRow><Muted>Pick the Chief Official and Deputy from the officials who accepted.</Muted></FullRow>
        )}
      </FormCard>

      {invitations.length > 0 && (
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'accepted',
              label: `Accepted (${accepted.length})`,
              children: (
                <>
                  {multiDay && accepted.length > 0 && (
                    <Muted>Officials each day: {eventDays.map((d) => `${formatShortDay(d)}: ${onDay(d)}`).join(' · ')}</Muted>
                  )}
                  {list(accepted, 'No one has accepted yet.')}
                </>
              ),
            },
            { key: 'declined', label: `Declined (${declined.length})`, children: list(declined, 'No one has declined.') },
            { key: 'waiting', label: `Waiting (${waiting.length})`, children: list(waiting, 'Everyone has answered.') },
          ]}
        />
      )}
    </>
  )
}

// After sending: did the emails go out? If not, offer a ready-made email.
function EmailNotice({ email, event, onDismiss }) {
  if (!email) return null
  if (email.failed.length === 0) {
    return (
      <Alert className="gap" type="info" showIcon closable={{ onClose: onDismiss }}
        title={`Invitation${email.sent === 1 ? '' : 's'} sent to ${email.sent} official${email.sent === 1 ? '' : 's'}.`} />
    )
  }
  const deadline = email.failed[0].respondBy
  const body = [
    'Hi,',
    '',
    `You're invited to officiate at ${event.name} (${formatDateRange(event.start_date, event.end_date)}${event.venue ? `, ${event.venue}` : ''}).`,
    deadline ? `Please accept or decline by ${formatDay(deadline)}.` : 'Please accept or decline.',
    '',
    `Sign in with this email address and open Events: ${siteUrl()}`,
  ].join('\n')
  const bcc = email.failed.map((f) => f.email).filter(Boolean).join(',')
  const mailto = `mailto:?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(`Officiating at ${event.name}`)}&body=${encodeURIComponent(body)}`
  const names = email.failed.map((f) => f.name).join(', ')
  return (
    <Alert
      className="gap"
      type="warning"
      showIcon
      closable={{ onClose: onDismiss }}
      title={<>The invitations are saved, but the email to {names} wasn't sent automatically ({email.reason}). <a href={mailto}>Send it from your email app</a></>}
    />
  )
}

// ---------------------------------------------------------------------------
// "Your invitations" on the Events page
// ---------------------------------------------------------------------------

export function MyInvitations({ onOpen }) {
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const { ask, dialog } = useAcceptDays()

  const load = useCallback(() => api.listMyInvitations().then(setRows, (err) => setError(err.message)), [])
  useEffect(() => {
    load()
  }, [load])

  const eventOf = (i) => ({ status: i.event_status, start_date: i.start_date, end_date: i.end_date, timezone: i.timezone })
  // Only events that are still coming up or running.
  const shown = rows.filter((i) => effectiveStatus(eventOf(i)) === 'active')

  async function answer(i, accept) {
    setError(null)
    let parts = null
    if (accept) {
      try {
        parts = await ask({ id: i.event_id }, i)
      } catch (err) {
        setError(err.message)
        return
      }
      if (!parts) return
    }
    setBusy(true)
    try {
      await api.respondToInvitation(i.id, accept, parts?.days, parts?.sessions)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (shown.length === 0 && !error) return null

  const columns = [
    { title: 'Event', key: 'event', value: (i) => i.event_name, render: (_, i) => <Button type="link" size="small" style={{ padding: 0 }} onClick={() => onOpen(i.event_id)}>{i.event_name}</Button> },
    { title: 'Dates', key: 'dates', value: (i) => i.start_date, render: (_, i) => formatDateRange(i.start_date, i.end_date) },
    { title: 'Location', key: 'venue', render: (_, i) => i.venue || '—' },
    { title: 'Respond by', key: 'respond_by', value: (i) => i.respond_by ?? '', render: (_, i) => (i.respond_by ? formatDay(i.respond_by) : '—') },
    {
      title: 'Your answer', key: 'answer', value: (i) => answerLabels[answerOf(i, i.timezone)],
      render: (_, i) => (
        <Space size={4} wrap>
          <AnswerBadge answer={answerOf(i, i.timezone)} />
          {i.status === 'accepted' && (i.start_date !== i.end_date || i.sessions?.length > 0) && <Text type="secondary">{daysText(i, eventOf(i))}</Text>}
        </Space>
      ),
    },
    {
      key: 'actions',
      className: 'actions',
      render: (_, i) => {
        if (!canAnswer(i, eventOf(i))) return null
        const current = answerOf(i, i.timezone)
        return (
          <Space>
            {current !== 'accepted' && <Button size="small" type="primary" disabled={busy} onClick={() => answer(i, true)}>Accept</Button>}
            {current === 'accepted' && <Button size="small" disabled={busy} onClick={() => answer(i, true)}>Change days</Button>}
            {current !== 'declined' && <Button size="small" disabled={busy} onClick={() => answer(i, false)}>Decline</Button>}
          </Space>
        )
      },
    },
  ]

  return (
    <Section title="Your invitations to officiate">
      {dialog}
      <ErrorAlert>{error}</ErrorAlert>
      <Muted>Accept for the days, or the bout sessions, you can work. You can change your answer or your days until the event's first day.</Muted>
      <DataTable rowKey="id" columns={columns} dataSource={shown} />
    </Section>
  )
}
