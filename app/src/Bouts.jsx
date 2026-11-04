// Stage 4 (plan/events.md sections 4 to 6): the event's officials (Officials.jsx), bout matching and
// approvals, comments, the weigh-in, the card order and results.
import { useMemo, useState } from 'react'
import CsvImport from './CsvImport'
import DataTable, { DownloadCsvButton } from './DataTable'
import { api } from './api'
import RoleChoices from './RoleChoices'
import { formatWeight } from './athletes'
import { categorise } from './categories'
import { daysBetween, formatDay, formatShortDay } from './dates'
import { bestOpponents, checkMatch } from './matching'
import { EventOfficials } from './Officials'
import { eventRoles, rolesFlags, rolesOf, rolesText } from './officialRoles'
import { Alert, Button, Card as AntCard, Collapse, Dropdown, Input, Radio, Space, Switch, Tabs } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, DownOutlined, HolderOutlined, SendOutlined, SwapOutlined } from '@ant-design/icons'
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import { askConfirm, askText } from './dialogs'
import { Badge, ErrorAlert, Field, FormCard, FullRow, Muted, NumberInput, Pick, Section, Text, Title } from './ui'

const statusLabels = { pending: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' }
const sideLabels = { red: 'Red corner', blue: 'Blue corner', official: 'Chief Official' }
const medicalLabels = { pass: 'Passed', fail: 'Failed', absent: 'No-show' }
const methodLabels = { points: 'Points', rsc: 'RSC', ko: 'KO', walkover: 'Walkover', dq: 'DQ', abd: 'ABD' }
// Bout types (migration 25). Scored follows every rule; Developmental lets the Chief Official or
// Deputy override a rule break with a reason; Sparring follows the rules but needs no approval.
const boutTypeLabels = { scored: 'Scored', developmental: 'Developmental', sparring: 'Sparring' }
const boutTypeHelp = {
  scored: 'Must follow every match rule. Both corners\' club owners and a Chief Official approve it.',
  developmental: 'The match rules apply, but a Chief Official can override them with a reason. Both corners\' club owners and a Chief Official approve it.',
  sparring: 'Must follow the match rules. No approval needed: the bout is approved as soon as it is made.',
}
const boutTypeOf = (b) => b?.bout_type ?? 'scored'
const personName = (user) => (user ? user.name || user.email : '—')
// Emailed links go straight to sign-in and then Home; the bare root is the public page.
const siteUrl = () => window.location.origin + import.meta.env.BASE_URL + '#home'
const sentLabel = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
// A bout can be sent for approval while it's waiting for approval and has no result.
const sendable = (b) => b.status === 'pending' && !b.winner

// Every bout of the event as CSV rows: each day's card in order, then that day's cancelled bouts.
function boutCsvRows(event, data, athletes, days) {
  const weighedIn = Object.fromEntries(data.weighIns.map((w) => [`${w.day}|${w.athlete_id}`, w]))
  const weighIn = (day, id) => {
    const w = weighedIn[`${day}|${id}`]
    if (!w) return ''
    return [w.weight_kg != null ? formatWeight(w.weight_kg) : '', medicalLabels[w.medical] ?? ''].filter(Boolean).join(', ')
  }
  const side = (b, s) => {
    const athlete = athletes[b[`${s}_athlete_id`]]
    return [athlete?.name ?? b[s]?.name ?? '', b[`${s}_club`]?.name ?? '', categoryText(athlete, event.start_date), weighIn(b.day, b[`${s}_athlete_id`])]
  }
  const header = [
    'Day', 'Bout', 'Session', 'Type', 'Status',
    'Red boxer', 'Red club', 'Red category', 'Red weigh-in',
    'Blue boxer', 'Blue club', 'Blue category', 'Blue weigh-in',
    'Winner', 'Method', 'Result note', 'Red club decision', 'Blue club decision', 'Official decision', 'Sent for approval', 'Rules overridden', 'Cancel reason', 'Needs discussion', 'Officials',
  ]
  const rows = days.flatMap((day) => {
    const dayBouts = data.bouts.filter((b) => b.day === day)
    const live = dayBouts.filter((b) => b.status !== 'cancelled').sort((a, b) => a.position - b.position)
    const cancelled = dayBouts.filter((b) => b.status === 'cancelled')
    return [...live, ...cancelled].map((b) => {
      const said = (sideName) => {
        const a = b.approvals.find((x) => x.side === sideName)
        return a ? `${a.decision === 'approved' ? 'Approved' : 'Rejected'}${a.override ? ' by an official' : ''}${a.note ? `: ${a.note}` : ''}` : ''
      }
      return [
        day, b.status === 'cancelled' ? '' : live.indexOf(b) + 1, b.session_starts_at?.slice(0, 5) ?? '',
        boutTypeLabels[boutTypeOf(b)], statusLabels[b.status] ?? b.status,
        ...side(b, 'red'), ...side(b, 'blue'),
        b.winner ? (b.winner === 'red' ? 'Red' : 'Blue') : '', b.method ? methodLabels[b.method] ?? b.method : '', b.result_note ?? '',
        said('red'), said('blue'), said('official'),
        b.approval_requested_at ? sentLabel(b.approval_requested_at) : '',
        b.override_reason ?? '', b.cancel_reason ?? '', b.status === 'cancelled' ? '' : b.review_reason ?? '',
        officialsText(b),
      ]
    })
  })
  return [header, ...rows]
}

// 'Grace Adeyemi (Referee, Judge); Rob Turner (Timekeeper)'
function officialsText(bout) {
  return (bout.bout_officials ?? []).map((o) => `${personName(o.user)} (${rolesText(o, '')})`).join('; ')
}

function categoryText(athlete, eventDate) {
  if (!athlete?.date_of_birth) return ''
  const c = categorise(athlete, eventDate)
  return [c.age?.label, c.weight?.label, c.experience?.label].filter(Boolean).join(' · ')
}

// The Bouts tab: the card, the weigh-in and results.
// publish: { canChange, busy, onChange(show) } for the public bout list switch.
export function EventBouts({ event, bouts, publish }) {
  if (!bouts.data) return bouts.error ? <ErrorAlert>{bouts.error}</ErrorAlert> : <Muted>Loading…</Muted>
  return (
    <>
      <ErrorAlert>{bouts.error}</ErrorAlert>
      <Card event={event} data={bouts.data} rights={bouts.rights} busy={bouts.busy} run={bouts.run} publish={publish} />
    </>
  )
}

// The Owner's (or site Admin's) switch for the approved bout list on the public page. Off by default.
function PublicBoutsSwitch({ event, data, publish }) {
  const shown = !!event.show_public_bouts
  const approved = data.bouts.filter((b) => b.status === 'approved').length
  const count = `${approved} approved bout${approved === 1 ? '' : 's'}`
  return (
    <div className="public-bouts-switch">
      <Switch
        id="show-public-bouts"
        checked={shown}
        disabled={publish.busy}
        onChange={(show) => publish.onChange(show)}
        checkedChildren="Shown"
        unCheckedChildren="Hidden"
      />
      <label htmlFor="show-public-bouts">
        <Text strong>Show approved bouts on the public page</Text>
        <br />
        <Text type="secondary">
          {shown
            ? `Anyone can see the ${count} on the Upcoming events page, without signing in.`
            : `Hidden. The public page doesn't list any bouts${approved ? ` (${count} so far)` : ''}.`}
        </Text>
      </label>
    </div>
  )
}

// The Officials tab.
export function EventOfficialsTab({ event, may, profile, bouts, onEventChange }) {
  if (!bouts.data) return bouts.error ? <ErrorAlert>{bouts.error}</ErrorAlert> : <Muted>Loading…</Muted>
  return (
    <>
      <ErrorAlert>{bouts.error}</ErrorAlert>
      <EventOfficials event={event} may={may} profile={profile} officials={bouts.data.officials} busy={bouts.busy} run={bouts.run} onEventChange={onEventChange} />
    </>
  )
}

// ---------------------------------------------------------------------------
// The card: one day at a time
// ---------------------------------------------------------------------------

function Card({ event, data, rights, busy, run, publish }) {
  const days = daysBetween(event.start_date, event.end_date)
  const [day, setDay] = useState(days[0])
  const [rematch, setRematch] = useState(null) // the bout being re-matched
  const athletes = useMemo(() => Object.fromEntries(event.athletes.map((a) => [a.id, a])), [event.athletes])
  const weighIns = data.weighIns.filter((w) => w.day === day)
  const weights = Object.fromEntries(weighIns.filter((w) => w.weight_kg != null).map((w) => [w.athlete_id, Number(w.weight_kg)]))
  const weighInStarted = weighIns.length > 0
  const canMatch = rights.cardOpen && (rights.official || (rights.owner && !weighInStarted))
  const canWeighIn = rights.cardOpen && (rights.official || rights.weighInDays.includes(day))
  const dayBouts = data.bouts.filter((b) => b.day === day)
  const live = dayBouts.filter((b) => b.status !== 'cancelled').sort((a, b) => a.position - b.position)
  const cancelled = dayBouts.filter((b) => b.status === 'cancelled')
  const sessions = event.days.find((d) => d.day === day)?.sessions ?? []
  const canSend = rights.cardOpen && (rights.owner || rights.official)
  // The Owner, Chief Official and Deputy (and the site Admin) set the running order (migration 29).
  const canOrder = rights.cardOpen && (rights.owner || rights.official)
  // The order just dropped, shown straight away while it saves; cleared once the card reloads.
  const [draft, setDraft] = useState(null) // { day, ids }
  const shown = draft?.day === day
    ? [...draft.ids.map((id) => live.find((b) => b.id === id)).filter(Boolean), ...live.filter((b) => !draft.ids.includes(b.id))]
    : live
  // Mouse: drag the handle. Touch: press and hold the handle so a swipe still scrolls. Keyboard:
  // Space to pick up, arrow keys to move, Space to drop, Escape to cancel.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [notice, setNotice] = useState(null) // the result of the last "Send for approval"
  const waiting = data.bouts.filter(sendable)
  const unsent = waiting.filter((b) => !b.approval_requested_at)

  // Marks the bouts sent and emails everyone who still has to approve them, one email per person.
  async function sendForApproval(list) {
    const ids = list.map((b) => b.id)
    let rows = []
    const ok = await run(async () => {
      rows = await api.requestBoutApprovals(ids)
    })
    if (!ok) return
    const nobody = missingApprovers(list, rows, data.officials)
    if (rows.length === 0) {
      setNotice({ sent: 0, people: [], nobody })
      return
    }
    const people = groupByPerson(rows)
    try {
      await api.emailBoutApprovals(ids)
      setNotice({ sent: people.length, people: [], nobody })
    } catch (err) {
      setNotice({ sent: 0, people, nobody, reason: err.message })
    }
  }

  async function sendAll() {
    const list = unsent.length ? unsent : waiting
    const what = unsent.length
      ? `Send ${list.length} bout${list.length === 1 ? '' : 's'} that ${list.length === 1 ? "hasn't" : "haven't"} been sent yet for approval?`
      : `Every waiting bout has been sent already. Send a reminder for all ${list.length}?`
    if (await askConfirm(`${what} Each club owner and Chief Official still to approve gets one email listing their bouts.`, { okText: 'Send' })) {
      sendForApproval(list)
    }
  }

  // Saves the day's running order. A failed save puts the card back as it was and shows the error.
  async function saveOrder(list, sessionFor = (b) => b.session_starts_at?.slice(0, 5) ?? null) {
    setDraft({ day, ids: list.map((b) => b.id) })
    await run(() => api.setCardOrder(event.id, day, list.map((b) => ({ id: b.id, session: sessionFor(b) }))))
    setDraft(null)
  }

  // Moves a bout to a place on the card, counted from 0.
  function moveTo(bout, to) {
    const from = shown.findIndex((b) => b.id === bout.id)
    if (from < 0 || to < 0 || to >= shown.length || to === from) return
    saveOrder(arrayMove(shown, from, to))
  }

  function move(bout, delta) {
    moveTo(bout, shown.findIndex((b) => b.id === bout.id) + delta)
  }

  function setSession(bout, session) {
    saveOrder(shown, (b) => (b.id === bout.id ? session : b.session_starts_at?.slice(0, 5) ?? null))
  }

  function dropped({ active, over }) {
    if (!over || active.id === over.id) return
    const to = shown.findIndex((b) => b.id === over.id)
    const bout = shown.find((b) => b.id === active.id)
    if (bout && to >= 0) moveTo(bout, to)
  }

  // What a screen reader says while a bout is moved with the keyboard.
  const place = (id) => shown.findIndex((b) => b.id === id) + 1
  const accessibility = {
    screenReaderInstructions: {
      draggable: 'To move this bout, press Space or Enter to pick it up, use the up and down arrow keys to move it, then press Space or Enter to drop it. Press Escape to cancel.',
    },
    announcements: {
      onDragStart: ({ active }) => `Picked up bout ${place(active.id)}.`,
      onDragOver: ({ active, over }) => (over ? `Bout ${place(active.id)} is at place ${place(over.id)} of ${shown.length}.` : `Bout ${place(active.id)} is not over a place.`),
      onDragEnd: ({ active, over }) => (over ? `Bout ${place(active.id)} moved to place ${place(over.id)} of ${shown.length}.` : `Bout ${place(active.id)} was dropped and stays where it was.`),
      onDragCancel: ({ active }) => `Move cancelled. Bout ${place(active.id)} stays where it was.`,
    },
  }

  return (
    <Section
      title="Bouts"
      extra={
        <Space wrap>
          <DownloadCsvButton
            filename={`${event.name} bouts`}
            disabled={data.bouts.length === 0}
            getRows={() => boutCsvRows(event, data, athletes, days)}
            title="Download every bout on every day, including cancelled ones"
          />
          {canSend && waiting.length > 0 && (
            <Button type="primary" icon={<SendOutlined />} disabled={busy} onClick={sendAll}>
              {unsent.length ? `Send all for approval (${unsent.length})` : `Send reminders (${waiting.length})`}
            </Button>
          )}
        </Space>
      }
    >
      {publish?.canChange && <PublicBoutsSwitch event={event} data={data} publish={publish} />}
      <SendNotice notice={notice} onDismiss={() => setNotice(null)} />
      {days.length > 1 && (
        <Tabs
          activeKey={day}
          onChange={(d) => { setDay(d); setRematch(null) }}
          items={days.map((d) => ({
            key: d,
            label: `${formatShortDay(d)} (${data.bouts.filter((b) => b.day === d && b.status !== 'cancelled').length})`,
          }))}
        />
      )}
      {weighInStarted && <Muted>The weigh-in for {formatDay(day)} has started, so only a Chief Official can make or change bouts.</Muted>}

      {canMatch && (
        <MatchForm
          key={`${day}-${rematch?.id ?? 'new'}`}
          event={event} day={day} bout={rematch} weights={weights} busy={busy} canOverride={rights.official}
          taken={new Set(live.filter((b) => b.id !== rematch?.id).flatMap((b) => [b.red_athlete_id, b.blue_athlete_id]))}
          onCancel={() => setRematch(null)}
          onSave={async (fields) => {
            const ok = await run(() => api.saveBout({ ...fields, id: rematch?.id, eventId: event.id, day }))
            if (ok) setRematch(null)
            return ok
          }}
        />
      )}

      {rights.cardOpen && (rights.official || rights.owner) && (
        <BoutsImport event={event} data={data} days={days} official={rights.official} run={run} />
      )}

      {live.length === 0 ? (
        <Muted>No bouts on {formatDay(day)} yet.</Muted>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={dropped} accessibility={accessibility}>
          <SortableContext items={shown.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            <div className="bout-list">
              {canOrder && shown.length > 1 && <Muted>Drag a bout by its handle to change the running order. On a phone, press and hold the handle first.</Muted>}
              {shown.map((b, i) => (
                <SortableBout key={b.id} id={b.id} disabled={!canOrder || busy}>
                  {(handle) => (
                    <BoutRow
                      bout={b} index={i} count={shown.length} event={event} athletes={athletes} weights={weights}
                      rights={rights} weighInStarted={weighInStarted} canMatch={canMatch} canSend={canSend} canOrder={canOrder} handle={handle} sessions={sessions} busy={busy} run={run} officials={data.officials}
                      onSend={() => sendForApproval([b])} onMove={(delta) => move(b, delta)} onMoveTo={(to) => moveTo(b, to)}
                      onSession={(s) => setSession(b, s)} onRematch={() => setRematch(b)}
                    />
                  )}
                </SortableBout>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {cancelled.length > 0 && (
        <Collapse
          className="gap"
          items={[{
            key: 'cancelled',
            label: `Cancelled bouts (${cancelled.length})`,
            children: (
              <ul style={{ margin: 0 }}>
                {cancelled.map((b) => (
                  <li key={b.id}>{b.red?.name ?? '?'} vs {b.blue?.name ?? '?'}{b.cancel_reason ? ` — ${b.cancel_reason}` : ''}</li>
                ))}
              </ul>
            ),
          }]}
        />
      )}

      {canWeighIn && (
        <WeighIn event={event} day={day} bouts={live} allBouts={dayBouts} athletes={athletes} weighIns={weighIns} busy={busy} run={run} />
      )}
      {!canWeighIn && weighIns.length > 0 && (
        <Muted>Weigh-in recorded for {weighIns.length} athlete{weighIns.length === 1 ? '' : 's'} on {formatDay(day)}.</Muted>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Making and re-matching a bout
// ---------------------------------------------------------------------------

// Many bouts at once, checked against the same match rules as the form.
function BoutsImport({ event, data, days, official, run }) {
  const live = data.bouts.filter((b) => b.status !== 'cancelled')
  const takenByDay = {}
  for (const b of live) (takenByDay[b.day] ??= []).push(b.red_athlete_id, b.blue_athlete_id)
  const weightsByDay = {}
  for (const w of data.weighIns) if (w.weight_kg != null) (weightsByDay[w.day] ??= {})[w.athlete_id] = Number(w.weight_kg)
  // Once a day's weigh-in has started, only a Chief Official makes bouts that day.
  const lockedDays = new Set(official ? [] : data.weighIns.map((w) => w.day))
  return (
    <CsvImport
      kind="bouts"
      title="Make bouts from a CSV file"
      context={{ days, athletes: event.athletes, takenByDay, weightsByDay, lockedDays, eventDate: event.start_date }}
      importRow={async (bout) => {
        await api.saveBout({ ...bout, eventId: event.id })
      }}
      onDone={() => run(async () => {})}
    >
      <Muted>
        Athletes are matched by name among those entered in this event. Each bout goes to the end of its day's card.
        Rows that break the match rules are skipped; make those on the form, where a Developmental bout can be overridden with a reason.
      </Muted>
    </CsvImport>
  )
}

function MatchForm({ event, day, bout, weights, taken, busy, canOverride, onCancel, onSave }) {
  const [redId, setRedId] = useState(bout?.red_athlete_id ?? '')
  const [blueId, setBlueId] = useState(bout?.blue_athlete_id ?? '')
  const [boutType, setBoutType] = useState(boutTypeOf(bout))
  const [reason, setReason] = useState(bout?.override_reason ?? '')
  const byId = Object.fromEntries(event.athletes.map((a) => [a.id, a]))
  const red = byId[redId]
  const blue = byId[blueId]
  const check = red && blue ? checkMatch(red, blue, event.start_date, weights) : null
  const [bestOnly, setBestOnly] = useState(false)
  const label = (a, note) => `${a.name} · ${a.club ?? '—'} · ${categoryText(a, event.start_date)}${note ? ` (${note})` : ''}`
  const plain = (other) => event.athletes.filter((a) => a.id !== other).map((a) => {
    const busyThatDay = taken.has(a.id)
    return { value: a.id, disabled: busyThatDay, label: label(a, busyThatDay && 'already boxing this day') }
  })
  // Best match: with the other corner picked, only opponents the rules allow, closest first. With
  // neither corner picked, only athletes who have at least one such opponent.
  const best = (other, current) => {
    const free = event.athletes.filter((a) => !taken.has(a.id))
    let list
    if (byId[other]) {
      list = bestOpponents(byId[other], free, event.start_date, weights, taken).map(({ athlete, check }) => ({
        value: athlete.id,
        label: label(athlete, check.needsSupervisor ? "needs the Chief Official" : check.warnings.length ? `${check.warnings.length} warning${check.warnings.length === 1 ? '' : 's'}` : 'good match'),
      }))
    } else {
      list = free.flatMap((a) => {
        const n = bestOpponents(a, free, event.start_date, weights, taken).length
        return n ? [{ value: a.id, label: label(a, `${n} possible opponent${n === 1 ? '' : 's'}`) }] : []
      })
    }
    // Keep the athlete already in this corner, so the picker never shows a bare id.
    if (byId[current] && !list.some((o) => o.value === current)) list.unshift({ value: current, misfit: true, label: label(byId[current], "doesn't fit") })
    return list
  }
  const options = (other, current) => (bestOnly ? best(other, current) : plain(other))
  const redOptions = options(blueId, redId)
  const blueOptions = options(redId, blueId)
  const fits = (opts) => opts.filter((o) => !o.misfit).length
  const bestNote = !bestOnly ? null
    : red && !blue ? `${fits(blueOptions)} athlete${fits(blueOptions) === 1 ? '' : 's'} fit${fits(blueOptions) === 1 ? 's' : ''} ${red.name}, closest first.`
    : blue && !red ? `${fits(redOptions)} athlete${fits(redOptions) === 1 ? '' : 's'} fit${fits(redOptions) === 1 ? 's' : ''} ${blue.name}, closest first.`
    : !red && !blue ? 'Pick a boxer to see only the opponents who fit them, closest first.'
    : null

  // A Developmental bout can break the rules (not the hard ones) when an official gives a reason.
  const blocked = Boolean(check && check.blocks.length)
  const overridable = blocked && boutType === 'developmental' && check.hard.length === 0
  const overriding = overridable && canOverride
  const canSave = check && (!blocked || (overriding && reason.trim()))

  async function save(e) {
    e.preventDefault()
    if (!canSave) return
    const ok = await onSave({
      redId, blueId, needsSupervisor: check.needsSupervisor, warnings: check.warnings, boutType,
      blocks: overriding ? check.blocks : [], overrideReason: overriding ? reason.trim() : null,
    })
    if (ok && !bout) {
      setRedId('')
      setBlueId('')
      setReason('')
    }
  }

  const suggestion = red?.suggested_opponent_name ? `${red.name}'s club suggests ${[red.suggested_opponent_name, red.suggested_opponent_club].filter(Boolean).join(', ')}.` : null

  return (
    <FormCard
      title={bout ? `Re-match bout ${bout.red?.name ?? ''} vs ${bout.blue?.name ?? ''}` : `Match a bout on ${formatDay(day)}`}
      onSubmit={save}
      actions={
        <>
          <Button type="primary" htmlType="submit" disabled={busy || !canSave}>
            {overriding ? (bout ? 'Save re-match with override' : 'Make bout with override') : bout ? 'Save re-match' : 'Make bout'}
          </Button>
          {bout && <Button onClick={onCancel}>Cancel</Button>}
        </>
      }
    >
      <FullRow>
        <Space direction="vertical" size={4}>
          <Radio.Group
            optionType="button"
            aria-label="Bout type"
            value={boutType}
            onChange={(e) => setBoutType(e.target.value)}
            options={Object.entries(boutTypeLabels).map(([value, label]) => ({ value, label }))}
          />
          <Muted>{boutTypeHelp[boutType]}</Muted>
        </Space>
      </FullRow>
      <FullRow>
        <Space wrap>
          <Button type={bestOnly ? 'primary' : 'default'} aria-pressed={bestOnly} onClick={() => setBestOnly(!bestOnly)}>
            Best match{bestOnly ? ': on' : ''}
          </Button>
          <Muted>
            {bestNote ?? (bestOnly ? 'Showing only athletes who fit the match rules.' : 'Hides opponents who break the match rules, are from the same club, or are already boxing this day.')}
          </Muted>
        </Space>
      </FullRow>
      <Field label={<span className="corner-label red">Red corner</span>}>
        <Pick value={redId} onChange={setRedId} placeholder="Choose an athlete…" options={redOptions} notFoundContent={bestOnly ? 'No one fits. Turn off Best match to see everyone.' : undefined} />
      </Field>
      <FullRow>
        <Button
          icon={<SwapOutlined rotate={90} />}
          disabled={!redId && !blueId}
          onClick={() => { setRedId(blueId); setBlueId(redId) }}
        >
          Swap corner
        </Button>
      </FullRow>
      <Field label={<span className="corner-label blue">Blue corner</span>}>
        <Pick value={blueId} onChange={setBlueId} placeholder="Choose an athlete…" options={blueOptions} notFoundContent={bestOnly ? 'No one fits. Turn off Best match to see everyone.' : undefined} />
      </Field>
      {suggestion && <FullRow><Muted>{suggestion}</Muted></FullRow>}
      {check && check.blocks.map((b) => <FullRow key={b}><Text type="danger">{b}</Text></FullRow>)}
      {blocked && check.hard.length === 0 && boutType !== 'developmental' && (
        <FullRow><Muted>{boutTypeLabels[boutType]} bouts can't break the match rules. A Developmental bout can, if a Chief Official overrides them with a reason.</Muted></FullRow>
      )}
      {blocked && boutType === 'developmental' && check.hard.length > 0 && (
        <FullRow><Muted>No one can override this, even on a Developmental bout.</Muted></FullRow>
      )}
      {overridable && !canOverride && (
        <FullRow><Muted>Only a Chief Official can override the match rules. Ask them to make this bout.</Muted></FullRow>
      )}
      {overriding && (
        <FullRow>
          <Field label="Reason for overriding the match rules">
            <Input.TextArea
              value={reason}
              maxLength={500}
              autoSize={{ minRows: 2, maxRows: 5 }}
              placeholder="For example: both coaches agree, a development bout for experience"
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </FullRow>
      )}
      {check && check.blocks.length === 0 && check.warnings.length > 0 && (
        <FullRow><Text>Check before approving: {check.warnings.join('; ')}.</Text></FullRow>
      )}
      {check && check.blocks.length === 0 && check.warnings.length === 0 && <FullRow><Text strong>These two are a good match.</Text></FullRow>}
      {bout && <FullRow><Muted>Re-matching clears the bout's approvals; both corners' club owners and a Chief Official approve it again.</Muted></FullRow>}
    </FormCard>
  )
}

// ---------------------------------------------------------------------------
// One bout on the card
// ---------------------------------------------------------------------------

// One bout on the card that can be dragged by its handle. Passes the handle's props to the card,
// or null when this person can't reorder.
function SortableBout({ id, disabled, children }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })
  const style = { transform: CSS.Translate.toString(transform), transition, position: 'relative', zIndex: isDragging ? 2 : undefined }
  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'bout-dragging' : undefined}>
      {children(disabled ? null : { ref: setActivatorNodeRef, ...attributes, ...listeners })}
    </div>
  )
}

function BoutRow({ bout, index, count, event, athletes, weights, weighInStarted = false, rights, canMatch, canSend, canOrder, handle, sessions, busy, run, officials = [], onSend, onMove, onMoveTo, onSession, onRematch }) {
  const [showComments, setShowComments] = useState(false)
  const [comment, setComment] = useState('')
  const [result, setResult] = useState(null) // { winner, method, note } while recording
  const red = athletes[bout.red_athlete_id]
  const blue = athletes[bout.blue_athlete_id]
  const approval = Object.fromEntries(bout.approvals.map((a) => [a.side, a]))
  const hasResult = Boolean(bout.winner)
  const open = rights.cardOpen && !hasResult

  const type = boutTypeOf(bout)
  const sparring = type === 'sparring'
  const overridden = Boolean(bout.override_reason)
  const overrider = officials.find((o) => o.user_id === bout.override_by)?.user

  // Re-check against weigh-in weights, so officials see a bout that no longer fits. Rule breaks an
  // official already overrode on a Developmental bout aren't shown again.
  const recheck = red && blue ? checkMatch(red, blue, event.start_date, weights) : null
  const newBlocks = recheck ? recheck.blocks.filter((b) => !(bout.override_blocks ?? []).includes(b)) : []

  // Each corner's club owners and a Chief Official approve (migration 52). A corner whose club has
  // no owner doesn't need approving. After the weigh-in starts a Chief Official can decide for a
  // corner; a site Admin can decide any side. One club in both corners approves once for both.
  const clubOf = (side) => (side === 'red' ? bout.red_club_id : bout.blue_club_id)
  const hasOwner = (side) => (side === 'red' ? bout.red_club_has_owner : bout.blue_club_has_owner) !== false
  const sameClub = Boolean(bout.red_club_id) && bout.red_club_id === bout.blue_club_id
  const canDecide = (side) => {
    if (!open) return false
    if (side === 'official') return rights.official
    return rights.siteAdmin || rights.ownedClubs.has(clubOf(side)) || ((bout.after_weigh_in || weighInStarted) && Boolean(rights.officialRole))
  }
  // The corner (or corners) the signed-in user can withdraw their athlete from.
  const myCorners = ['red', 'blue'].filter((side) => rights.ownedClubs.has(clubOf(side)))
  const canWithdraw = rights.cardOpen && !hasResult && bout.status !== 'cancelled' && myCorners.length > 0

  async function decide(side, approve) {
    let note = null
    if (!approve) {
      note = await askText('Why are you rejecting this bout? (optional)', { okText: 'Reject' })
      if (note === null) return
    }
    run(() => api.decideBout(bout.id, side, approve, note))
  }

  async function withdraw() {
    const side = myCorners[0]
    const athlete = side === 'red' ? bout.red?.name : bout.blue?.name
    const reason = await askText(`Withdraw ${athlete ?? 'your athlete'} from this bout? The bout is cancelled and the other club and the officials are told. Give a reason (optional).`, { okText: 'Withdraw' })
    if (reason === null) return
    run(() => api.withdrawCorner(bout.id, side, reason))
  }

  async function cancel() {
    const reason = await askText(`Take ${bout.red?.name} vs ${bout.blue?.name} off the card? Give a reason (optional).`, { okText: 'Cancel bout' })
    if (reason === null) return
    run(() => api.cancelBout(bout.id, reason))
  }

  // A failed medical, a no-show or a weight that no longer fits flags the bout (migration 35). Only
  // a Chief Official settles it: keep the bout or cancel it.
  const review = !hasResult && bout.status !== 'cancelled' ? bout.review_reason : null

  async function keep() {
    if (await askConfirm(`Keep ${bout.red?.name} vs ${bout.blue?.name} on the card? The "needs discussion" flag is cleared.`, { okText: 'Keep bout' })) {
      run(() => api.clearBoutReview(bout.id))
    }
  }

  async function clearResult() {
    if (await askConfirm('Remove this result? Both boxers\' bout counts go back down by one.', { okText: 'Remove result', danger: true })) {
      run(() => api.clearResult(bout.id), { entries: true })
    }
  }

  async function addComment(e) {
    e.preventDefault()
    if (await run(() => api.addBoutComment(bout.id, comment))) setComment('')
  }

  async function saveResult(e) {
    e.preventDefault()
    if (!result.winner || !result.method) return
    if (await run(() => api.recordResult(bout.id, result.winner, result.method, result.note), { entries: true })) setResult(null)
  }

  const corner = (side, athlete, fallback, club) => (
    <div className={`corner ${side}`}>
      <Text strong>{athlete?.name ?? fallback?.name ?? 'Not shown'}</Text>
      <Text type="secondary">{club?.name ?? '—'}</Text>
      {athlete && <Text type="secondary">{categoryText(athlete, event.start_date)}{weights[athlete.id] != null ? ` · weighed ${formatWeight(weights[athlete.id])}` : ''}</Text>}
      {bout.winner === side && <span><Badge strong>Winner · {methodLabels[bout.method]}</Badge></span>}
    </div>
  )

  // "Move to" for anyone who'd rather not drag: first, last or a bout number.
  const moveItems = [
    { key: 'first', label: 'Move to first', disabled: index === 0 },
    { key: 'last', label: 'Move to last', disabled: index === count - 1 },
    ...(count > 2 ? [{
      type: 'group',
      label: 'Move to bout number',
      children: Array.from({ length: count }, (_, k) => k).filter((k) => k !== index).map((k) => ({ key: String(k), label: `Bout ${k + 1}` })),
    }] : []),
  ]
  const moveChosen = ({ key }) => onMoveTo(key === 'first' ? 0 : key === 'last' ? count - 1 : Number(key))

  const order = canOrder ? (
    <Space size={4}>
      {sessions.length > 0 && (
        <Pick
          allowEmpty
          size="small"
          style={{ width: 150 }}
          aria-label="Session"
          value={bout.session_starts_at?.slice(0, 5) ?? ''}
          disabled={busy}
          onChange={(v) => onSession(v || null)}
          options={[{ value: '', label: 'No session' }, ...sessions.map((s) => ({ value: s.starts_at, label: s.label ? `${s.label} ${s.starts_at}` : s.starts_at }))]}
        />
      )}
      {count > 1 && (
        <Dropdown trigger={['click']} disabled={busy} menu={{ items: moveItems, onClick: moveChosen, style: { maxHeight: 360, overflowY: 'auto' } }}>
          <Button size="small" aria-label={`Move bout ${index + 1} to another place`}>Move to <DownOutlined /></Button>
        </Dropdown>
      )}
      <Button size="small" shape="circle" icon={<ArrowUpOutlined />} disabled={busy || index === 0} onClick={() => onMove(-1)} aria-label="Move up" />
      <Button size="small" shape="circle" icon={<ArrowDownOutlined />} disabled={busy || index === count - 1} onClick={() => onMove(1)} aria-label="Move down" />
    </Space>
  ) : (
    bout.session_starts_at && <Text type="secondary">Session {bout.session_starts_at.slice(0, 5)}</Text>
  )

  return (
    <AntCard
      size="small"
      className={`bout status-${bout.status}`}
      title={
        <Space size={8} wrap>
          {handle && (
            <Button
              type="text"
              className="drag-handle"
              icon={<HolderOutlined />}
              disabled={busy}
              title="Drag to move this bout"
              {...handle}
              aria-label={`Drag bout ${index + 1} to move it`}
            />
          )}
          <span>Bout {index + 1}</span>
          <Badge strong={type !== 'scored'}>{boutTypeLabels[type]}</Badge>
          <Badge strong={bout.status === 'approved'} muted={bout.status === 'rejected'}>{statusLabels[bout.status]}</Badge>
          {review && <Badge strong>Needs discussion</Badge>}
          {bout.needs_supervisor && <Badge>U17 v U19: needs the official's approval</Badge>}
          {sendable(bout) && bout.approval_requested_at && <Badge muted title="Last sent for approval">Sent {sentLabel(bout.approval_requested_at)}</Badge>}
        </Space>
      }
      extra={order}
    >
      <div className="bout-corners">
        {corner('red', red, bout.red, bout.red_club)}
        <span className="vs">vs</span>
        {corner('blue', blue, bout.blue, bout.blue_club)}
      </div>
      {bout.warnings.length > 0 && <Muted>Gaps: {bout.warnings.join('; ')}.</Muted>}
      {overridden && (
        <Alert
          type="info"
          showIcon={false}
          className="gap"
          title={`Match rules overridden by ${overrider ? personName(overrider) : 'an official'}${bout.override_at ? ` on ${sentLabel(bout.override_at)}` : ''}`}
          description={
            <>
              <div>Reason: {bout.override_reason}</div>
              {bout.override_blocks?.length > 0 && <Muted>Rules broken: {bout.override_blocks.join(' ')}</Muted>}
            </>
          }
        />
      )}
      {review && (
        <Alert
          type="warning"
          showIcon={false}
          className="gap"
          title="Needs discussion"
          description={
            <>
              <div>{review}</div>
              {rights.official && open ? (
                <Space size={6} wrap style={{ marginTop: 8 }}>
                  <Button size="small" disabled={busy} onClick={keep}>Keep bout</Button>
                  <Button size="small" danger disabled={busy} onClick={cancel}>Cancel bout</Button>
                </Space>
              ) : (
                <Muted>A Chief Official decides whether to keep or cancel this bout.</Muted>
              )}
            </>
          }
        />
      )}
      {newBlocks.length > 0 && !hasResult && !review && (
        <ErrorAlert>After the weigh-in this bout no longer fits: {newBlocks.join(' ')}</ErrorAlert>
      )}
      {bout.result_note && <Muted>Result note: {bout.result_note}</Muted>}

      {sparring ? (
        <Muted>Sparring: no approval needed.</Muted>
      ) : (
      <ul className="approvals">
        {['red', 'blue', 'official'].filter((side) => !(sameClub && side === 'blue')).map((side) => {
          const a = approval[side]
          const skipped = side !== 'official' && !a && !hasOwner(side)
          const label = sameClub && side === 'red' ? `Both corners (${bout.red_club?.name ?? 'same club'})` : sideLabels[side]
          return (
            <li key={side}>
              <Space size={6} wrap>
                <span className={side === 'official' || sameClub ? undefined : `corner-label ${side}`}>{label}:</span>
                {a ? (
                  <span>{a.decision === 'approved' ? 'Approved' : 'Rejected'}{a.override ? ' by an official' : ''}{a.note ? ` (“${a.note}”)` : ''}</span>
                ) : skipped ? (
                  <Text type="secondary">No club owner, so not needed</Text>
                ) : (
                  <Text type="secondary">Waiting</Text>
                )}
                {!skipped && canDecide(side) && a?.decision !== 'approved' && <Button size="small" type="link" disabled={busy} onClick={() => decide(side, true)}>Approve</Button>}
                {!skipped && canDecide(side) && a?.decision !== 'rejected' && <Button size="small" type="link" danger disabled={busy} onClick={() => decide(side, false)}>Reject</Button>}
              </Space>
            </li>
          )
        })}
      </ul>
      )}

      <BoutOfficials bout={bout} rights={rights} open={open} busy={busy} run={run} />

      <Space size={4} wrap>
        <Button size="small" onClick={() => setShowComments(!showComments)}>
          {showComments ? 'Hide comments' : `Comments (${bout.comments.length})`}
        </Button>
        {canSend && sendable(bout) && (
          <Button size="small" icon={<SendOutlined />} disabled={busy} onClick={onSend}>
            {bout.approval_requested_at ? 'Send again' : 'Send for approval'}
          </Button>
        )}
        {canMatch && !hasResult && <Button size="small" disabled={busy} onClick={onRematch}>Re-match</Button>}
        {canMatch && !hasResult && (
          <Button size="small" icon={<SwapOutlined rotate={90} />} disabled={busy} onClick={() => run(() => api.swapBoutCorners(bout.id))}>
            Swap corners
          </Button>
        )}
        {canMatch && !hasResult && !review && <Button size="small" danger disabled={busy} onClick={cancel}>Cancel bout</Button>}
        {canWithdraw && <Button size="small" danger disabled={busy} onClick={withdraw}>Withdraw my athlete</Button>}
        {rights.official && bout.status === 'approved' && !result && (
          <Button size="small" type="primary" disabled={busy || Boolean(review)} title={review ? 'Keep or cancel this bout first' : undefined} onClick={() => setResult({ winner: bout.winner ?? '', method: bout.method ?? '', note: bout.result_note ?? '' })}>
            {hasResult ? 'Change result' : 'Record result'}
          </Button>
        )}
        {rights.official && hasResult && (
          <Button size="small" danger disabled={busy} onClick={clearResult}>Remove result</Button>
        )}
      </Space>

      {result && (
        <div style={{ marginTop: 12 }}>
          <FormCard
            compact
            onSubmit={saveResult}
            actions={
              <>
                <Button type="primary" htmlType="submit" disabled={busy || !result.winner || !result.method}>Save result</Button>
                <Button onClick={() => setResult(null)}>Cancel</Button>
              </>
            }
          >
            <Field label="Winner">
              <Pick
                value={result.winner}
                onChange={(winner) => setResult({ ...result, winner })}
                placeholder="Choose…"
                options={[{ value: 'red', label: `${bout.red?.name} (red)` }, { value: 'blue', label: `${bout.blue?.name} (blue)` }]}
              />
            </Field>
            <Field label="Method">
              <Pick
                value={result.method}
                onChange={(method) => setResult({ ...result, method })}
                placeholder="Choose…"
                options={Object.entries(methodLabels).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field label="Note" hint="optional"><Input value={result.note} onChange={(e) => setResult({ ...result, note: e.target.value })} /></Field>
            {!hasResult && <FullRow><Muted>Saving adds one to both boxers' bout counts.</Muted></FullRow>}
          </FormCard>
        </div>
      )}

      {showComments && (
        <div className="comments">
          {bout.comments.length === 0 && <Muted>No comments yet.</Muted>}
          {bout.comments.map((c) => (
            <p key={c.id}>
              <Text strong>{personName(c.author)}</Text>{' '}
              <Text type="secondary">{new Date(c.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
              <br />
              {c.body}
            </p>
          ))}
          <form onSubmit={addComment}>
            <Space.Compact style={{ width: '100%', maxWidth: 520 }}>
              <Input aria-label="Comment" placeholder="Add a comment" value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} />
              <Button htmlType="submit" disabled={busy || !comment.trim()}>Post</Button>
            </Space.Compact>
          </form>
        </div>
      )}
    </AntCard>
  )
}

// Who is working the bout and as what (migrations 41, 42). An official working the bout's day
// accepts it and ticks which of their event roles they do on it (Referee, Judge, Supervisor,
// Timekeeper); they can change that or withdraw until the result. The Owner, Chief Official or
// Deputy can take an official off the bout.
function BoutOfficials({ bout, rights, open, busy, run }) {
  const list = bout.bout_officials ?? []
  const mine = list.find((o) => o.user_id === rights.me)
  const myRoles = eventRoles.filter((r) => rights.myRoles?.[r.key])
  const worksDay = Boolean(rights.me) && (Boolean(rights.officialRole) || rights.weighInDays.includes(bout.day))
  const canWork = open && bout.status !== 'cancelled' && worksDay
  const canRemove = open && (rights.owner || rights.official)
  const [picking, setPicking] = useState(false)
  const [roles, setRoles] = useState([])
  const pickerId = `bout-role-${bout.id}`

  function startPicking() {
    // A new pick starts with every event role ticked when there's only one to choose.
    setRoles(mine ? rolesOf(mine).filter((k) => rights.myRoles?.[k]) : myRoles.length === 1 ? [myRoles[0].key] : [])
    setPicking(true)
  }

  async function accept() {
    if (roles.length === 0) return
    if (await run(() => api.acceptBout(bout.id, rolesFlags(roles)))) setPicking(false)
  }

  async function remove(o) {
    const self = o.user_id === rights.me
    const what = self ? 'Withdraw from this bout?' : `Take ${personName(o.user)} off this bout?`
    if (await askConfirm(what, { okText: self ? 'Withdraw' : 'Remove', danger: true })) {
      run(() => api.withdrawFromBout(bout.id, self ? null : o.user_id))
    }
  }

  if (list.length === 0 && !canWork) return null
  return (
    <div className="bout-officials">
      <Space size={6} wrap>
        <span>Officials:</span>
        {list.length === 0 && <Text type="secondary">None yet</Text>}
        {list.map((o) => (
          <span key={o.user_id} className="bout-official">
            <Badge strong={Boolean(o.referee)}>{personName(o.user)}{o.user_id === rights.me ? ' (you)' : ''} · {rolesText(o, 'No role')}</Badge>
            {(canRemove || (o.user_id === rights.me && open)) && (
              <Button size="small" type="link" danger disabled={busy} onClick={() => remove(o)}>
                {o.user_id === rights.me ? 'Withdraw' : 'Remove'}
              </Button>
            )}
          </span>
        ))}
        {canWork && !picking && myRoles.length > 0 && (
          <Button size="small" type={mine ? 'default' : 'primary'} disabled={busy} onClick={startPicking}>
            {mine ? 'Change my roles' : 'Accept bout'}
          </Button>
        )}
      </Space>
      {canWork && myRoles.length === 0 && (
        <Muted>Pick your event roles on the Officials tab before you accept bouts.</Muted>
      )}
      {picking && (
        <div className="bout-role-picker" role="group" aria-labelledby={pickerId}>
          <Text strong id={pickerId}>Which roles will you do on this bout?</Text>
          <RoleChoices roles={myRoles} value={roles} onChange={setRoles} />
          <Space size={6} wrap>
            <Button size="small" type="primary" disabled={busy || roles.length === 0} onClick={accept}>{mine ? 'Save' : 'Accept bout'}</Button>
            <Button size="small" onClick={() => setPicking(false)}>Cancel</Button>
          </Space>
          {roles.length === 0 && <Muted>Pick at least one role to accept.</Muted>}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Send for approval
// ---------------------------------------------------------------------------

const approvalSideText = { red: 'red corner', blue: 'blue corner', official: 'official approval' }

// One entry per person: { name, email, event, bouts: [{ line, sides }] }, each bout listed once.
function groupByPerson(rows) {
  const people = new Map()
  for (const r of rows) {
    if (!people.has(r.recipient_email)) people.set(r.recipient_email, { name: r.recipient_name, email: r.recipient_email, event: r.event_name, bouts: new Map() })
    const bouts = people.get(r.recipient_email).bouts
    const corner = (name, club) => (club ? `${name} (${club})` : name)
    if (!bouts.has(r.bout_id)) {
      bouts.set(r.bout_id, { line: `${formatDay(r.day)}, bout ${r.bout_number}: ${corner(r.red_name, r.red_club)} vs ${corner(r.blue_name, r.blue_club)}`, sides: [] })
    }
    bouts.get(r.bout_id).sides.push(approvalSideText[r.side])
  }
  return [...people.values()].map((p) => ({ ...p, bouts: [...p.bouts.values()] }))
}

// Approvals still needed that nobody could be told about: no Chief Official yet, or
// they have no email.
function missingApprovers(list, rows, officials) {
  const told = new Set(rows.map((r) => `${r.bout_id}:${r.side}`))
  const notes = new Set()
  for (const b of list.filter(sendable)) {
    const approved = new Set(b.approvals.filter((a) => a.decision === 'approved').map((a) => a.side))
    const sameClub = Boolean(b.red_club_id) && b.red_club_id === b.blue_club_id
    for (const side of ['red', 'blue']) {
      // Corners with no club owner don't need approving (migration 52).
      if (sameClub && side === 'blue') continue
      if ((side === 'red' ? b.red_club_has_owner : b.blue_club_has_owner) === false) continue
      if (!approved.has(side) && !told.has(`${b.id}:${side}`)) {
        const club = side === 'red' ? b.red_club?.name : b.blue_club?.name
        notes.add(club ? `${club}'s club owners have no email` : 'an athlete has no club')
      }
    }
    if (!approved.has('official') && !told.has(`${b.id}:official`)) {
      notes.add(officials.length ? 'the Chief Officials have no email' : 'the event has no Chief Official yet')
    }
  }
  return [...notes]
}

function approvalEmail(person) {
  const lines = person.bouts.map((b) => `- ${b.line} — ${b.sides.join(', ')}`)
  const count = lines.length === 1 ? 'a bout' : `${lines.length} bouts`
  const body = [
    person.name ? `Hi ${person.name},` : 'Hi,', '',
    `Please approve or reject ${count} at ${person.event}:`, '',
    ...lines, '',
    `Sign in and open the event's Bouts tab: ${siteUrl()}`,
  ].join('\n')
  return `mailto:${encodeURIComponent(person.email)}?subject=${encodeURIComponent(`Bouts to approve at ${person.event}`)}&body=${encodeURIComponent(body)}`
}

// After "Send for approval": who was emailed, and a ready-made email per person if it didn't send.
function SendNotice({ notice, onDismiss }) {
  if (!notice) return null
  const gaps = notice.nobody.length > 0 && <div>Nobody could be told for some approvals: {notice.nobody.join('; ')}.</div>
  if (notice.people.length === 0) {
    return (
      <Alert
        className="gap"
        type={notice.sent ? 'info' : 'warning'}
        showIcon
        closable={{ onClose: onDismiss }}
        title={notice.sent ? `Sent for approval: ${notice.sent} ${notice.sent === 1 ? 'person was' : 'people were'} emailed.` : 'Marked as sent, but there was no one to email.'}
        description={gaps || undefined}
      />
    )
  }
  return (
    <Alert
      className="gap"
      type="warning"
      showIcon
      closable={{ onClose: onDismiss }}
      title={`The bouts are marked as sent, but the emails weren't sent automatically (${notice.reason}). Send each one from your email app:`}
      description={
        <>
          <ul style={{ margin: '4px 0' }}>
            {notice.people.map((p) => (
              <li key={p.email}>
                <a href={approvalEmail(p)}>Email {p.name || p.email}</a>{' '}
                <Text type="secondary">({p.bouts.length} bout{p.bouts.length === 1 ? '' : 's'})</Text>
              </li>
            ))}
          </ul>
          {gaps}
        </>
      }
    />
  )
}

// ---------------------------------------------------------------------------
// Weigh-in (CO and Deputy)
// ---------------------------------------------------------------------------

function WeighIn({ event, day, bouts, allBouts, athletes, weighIns, busy, run }) {
  const recorded = Object.fromEntries(weighIns.map((w) => [w.athlete_id, w]))
  // Everyone matched that day (even on a bout since cancelled, so both opponents can still weigh
  // in), plus anyone already weighed in.
  const ids = [...new Set([...allBouts.flatMap((b) => [b.red_athlete_id, b.blue_athlete_id]), ...weighIns.map((w) => w.athlete_id)])]
  const rows = ids.map((id) => athletes[id]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name))

  async function save(athlete, form) {
    await run(async () => {
      await api.recordWeighIn({ eventId: event.id, day, athleteId: athlete.id, weightKg: form.weight, medical: form.medical, note: form.note })
      if (form.medical !== 'pass') return
      // Re-check this athlete's bouts against the new weight; flag any that no longer fit for the
      // Chief Official or Deputy to discuss (migration 35). Nothing is cancelled automatically.
      const weights = Object.fromEntries(weighIns.filter((w) => w.weight_kg != null).map((w) => [w.athlete_id, Number(w.weight_kg)]))
      weights[athlete.id] = Number(form.weight)
      for (const b of bouts.filter((x) => !x.winner && [x.red_athlete_id, x.blue_athlete_id].includes(athlete.id))) {
        const check = checkMatch(athletes[b.red_athlete_id], athletes[b.blue_athlete_id], event.start_date, weights)
        // On a Developmental bout, rule breaks an official already overrode don't count again.
        const broken = check.blocks.filter((x) => !(b.override_blocks ?? []).includes(x))
        if (broken.length) await api.flagBoutForReview(b.id, `${athlete.name} weighed ${formatWeight(form.weight)}, so the bout no longer fits: ${broken.join(' ')}`)
      }
    })
  }

  // Each row keeps its own form; the key resets it when a new weigh-in is recorded.
  const columns = [
    { title: 'Athlete', key: 'athlete', value: (a) => `${a.name} ${a.club ?? ''}`, csv: (a) => (a.club ? `${a.name} (${a.club})` : a.name), render: (_, a) => <>{a.name}<br /><Text type="secondary">{a.club ?? '—'}</Text></> },
    { title: 'Entered', key: 'entered', value: (a) => a.weight_kg, render: (_, a) => formatWeight(a.weight_kg) },
    {
      title: 'Weigh-in',
      key: 'form',
      csv: (a) => {
        const w = recorded[a.id]
        return w ? [w.weight_kg != null ? formatWeight(w.weight_kg) : '', medicalLabels[w.medical] ?? '', w.note ?? ''].filter(Boolean).join(', ') : ''
      },
      render: (_, a) => (
        <WeighInForm key={`${a.id}-${recorded[a.id]?.recorded_at ?? ''}`} athlete={a} recorded={recorded[a.id]} busy={busy} onSave={(form) => save(a, form)} />
      ),
    },
  ]

  return (
    <div className="weigh-in">
      <Title level={4}>Weigh-in, {formatDay(day)}</Title>
      {rows.length === 0 ? (
        <Muted>Nobody is boxing this day yet.</Muted>
      ) : (
        <DataTable rowKey="id" columns={columns} dataSource={rows} csvName={`${event.name} weigh-in ${day}`} />
      )}
      <Muted>A failed medical, a no-show or a weight that no longer fits marks the athlete's bouts "Needs discussion". Nothing is cancelled automatically: a Chief Official keeps or cancels each one, and the opponent can still weigh in.</Muted>
    </div>
  )
}

function WeighInForm({ athlete, recorded, busy, onSave }) {
  const [form, setForm] = useState({
    weight: recorded?.weight_kg ?? '', medical: recorded?.medical ?? 'pass', note: recorded?.note ?? '',
  })
  return (
    <Space wrap size={6}>
      <NumberInput
        aria-label={`${athlete.name} weight`}
        placeholder="kg"
        step={0.1}
        min={10}
        max={250}
        style={{ width: 90 }}
        value={form.weight}
        onChange={(weight) => setForm({ ...form, weight })}
      />
      <Pick
        aria-label={`${athlete.name} medical`}
        style={{ width: 110 }}
        value={form.medical}
        onChange={(medical) => setForm({ ...form, medical })}
        options={Object.entries(medicalLabels).map(([value, label]) => ({ value, label }))}
      />
      <Input aria-label={`${athlete.name} note`} placeholder="Note" style={{ width: 160 }} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      <Button disabled={busy || (form.medical === 'pass' && form.weight === '')} onClick={() => onSave(form)}>
        {recorded ? 'Update' : 'Save'}
      </Button>
      {recorded && <Text type="secondary">{medicalLabels[recorded.medical]}</Text>}
    </Space>
  )
}
