// Stage 4 (plan/events.md sections 4 to 6): the event's officials (Officials.jsx), bout matching and
// approvals, comments, the weigh-in, the card order and results.
import { useMemo, useState } from 'react'
import DataTable from './DataTable'
import { api } from './api'
import { formatWeight } from './athletes'
import { categorise } from './categories'
import { daysBetween, formatDay, formatShortDay } from './dates'
import { bestOpponents, checkMatch } from './matching'
import { EventOfficials } from './Officials'
import { Alert, Button, Card as AntCard, Collapse, Input, Space, Tabs } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, SendOutlined } from '@ant-design/icons'
import { askConfirm, askText } from './dialogs'
import { Badge, ErrorAlert, Field, FormCard, FullRow, Muted, NumberInput, Pick, Section, Text, Title } from './ui'

const statusLabels = { pending: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' }
const sideLabels = { red: 'Red corner', blue: 'Blue corner', official: 'Official' }
const medicalLabels = { pass: 'Passed', fail: 'Failed', absent: 'No-show' }
const methodLabels = { points: 'Points', rsc: 'RSC', ko: 'KO', walkover: 'Walkover', dq: 'DQ', abd: 'ABD' }
const personName = (user) => (user ? user.name || user.email : '—')
// Emailed links go straight to sign-in and then Home; the bare root is the public page.
const siteUrl = () => window.location.origin + import.meta.env.BASE_URL + '#home'
const sentLabel = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
// A bout can be sent for approval while it's waiting for approval and has no result.
const sendable = (b) => b.status === 'pending' && !b.winner

function categoryText(athlete, eventDate) {
  if (!athlete?.date_of_birth) return ''
  const c = categorise(athlete, eventDate)
  return [c.age?.label, c.weight?.label, c.experience?.label].filter(Boolean).join(' · ')
}

// The Bouts tab: the card, the weigh-in and results.
export function EventBouts({ event, bouts }) {
  if (!bouts.data) return bouts.error ? <ErrorAlert>{bouts.error}</ErrorAlert> : <Muted>Loading…</Muted>
  return (
    <>
      <ErrorAlert>{bouts.error}</ErrorAlert>
      <Card event={event} data={bouts.data} rights={bouts.rights} busy={bouts.busy} run={bouts.run} />
    </>
  )
}

// The Officials tab.
export function EventOfficialsTab({ event, may, profile, bouts }) {
  if (!bouts.data) return bouts.error ? <ErrorAlert>{bouts.error}</ErrorAlert> : <Muted>Loading…</Muted>
  return (
    <>
      <ErrorAlert>{bouts.error}</ErrorAlert>
      <EventOfficials event={event} may={may} profile={profile} officials={bouts.data.officials} busy={bouts.busy} run={bouts.run} />
    </>
  )
}

// ---------------------------------------------------------------------------
// The card: one day at a time
// ---------------------------------------------------------------------------

function Card({ event, data, rights, busy, run }) {
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
    if (await askConfirm(`${what} Each club Owner and official still to approve gets one email listing their bouts.`, { okText: 'Send' })) {
      sendForApproval(list)
    }
  }

  function move(bout, delta) {
    const order = [...live]
    const i = order.findIndex((b) => b.id === bout.id)
    const j = i + delta
    if (j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    run(() => api.setCardOrder(event.id, day, order.map((b) => ({ id: b.id, session: b.session_starts_at?.slice(0, 5) ?? null }))))
  }

  function setSession(bout, session) {
    run(() => api.setCardOrder(event.id, day, live.map((b) => ({ id: b.id, session: b.id === bout.id ? session : b.session_starts_at?.slice(0, 5) ?? null }))))
  }

  return (
    <Section
      title="Bouts"
      extra={canSend && waiting.length > 0 && (
        <Button type="primary" icon={<SendOutlined />} disabled={busy} onClick={sendAll}>
          {unsent.length ? `Send all for approval (${unsent.length})` : `Send reminders (${waiting.length})`}
        </Button>
      )}
    >
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
      {weighInStarted && <Muted>The weigh-in for {formatDay(day)} has started, so only the Chief Official or Deputy can make or change bouts.</Muted>}

      {canMatch && (
        <MatchForm
          key={`${day}-${rematch?.id ?? 'new'}`}
          event={event} day={day} bout={rematch} weights={weights} busy={busy}
          taken={new Set(live.filter((b) => b.id !== rematch?.id).flatMap((b) => [b.red_athlete_id, b.blue_athlete_id]))}
          onCancel={() => setRematch(null)}
          onSave={async (fields) => {
            const ok = await run(() => api.saveBout({ ...fields, id: rematch?.id, eventId: event.id, day }))
            if (ok) setRematch(null)
            return ok
          }}
        />
      )}

      {live.length === 0 ? (
        <Muted>No bouts on {formatDay(day)} yet.</Muted>
      ) : (
        <div className="bout-list">
          {live.map((b, i) => (
            <BoutRow
              key={b.id} bout={b} index={i} count={live.length} event={event} athletes={athletes} weights={weights}
              rights={rights} canMatch={canMatch} canSend={canSend} sessions={sessions} busy={busy} run={run}
              onSend={() => sendForApproval([b])} onMove={(delta) => move(b, delta)} onSession={(s) => setSession(b, s)} onRematch={() => setRematch(b)}
            />
          ))}
        </div>
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
        <WeighIn event={event} day={day} bouts={live} athletes={athletes} weighIns={weighIns} busy={busy} run={run} />
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

function MatchForm({ event, day, bout, weights, taken, busy, onCancel, onSave }) {
  const [redId, setRedId] = useState(bout?.red_athlete_id ?? '')
  const [blueId, setBlueId] = useState(bout?.blue_athlete_id ?? '')
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

  async function save(e) {
    e.preventDefault()
    if (!check || check.blocks.length) return
    const ok = await onSave({ redId, blueId, needsSupervisor: check.needsSupervisor, warnings: check.warnings })
    if (ok && !bout) {
      setRedId('')
      setBlueId('')
    }
  }

  const suggestion = red?.suggested_opponent_name ? `${red.name}'s club suggests ${[red.suggested_opponent_name, red.suggested_opponent_club].filter(Boolean).join(', ')}.` : null

  return (
    <FormCard
      title={bout ? `Re-match bout ${bout.red?.name ?? ''} vs ${bout.blue?.name ?? ''}` : `Match a bout on ${formatDay(day)}`}
      onSubmit={save}
      actions={
        <>
          <Button type="primary" htmlType="submit" disabled={busy || !check || check.blocks.length > 0}>{bout ? 'Save re-match' : 'Make bout'}</Button>
          {bout && <Button onClick={onCancel}>Cancel</Button>}
        </>
      }
    >
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
      <Field label={<span className="corner-label blue">Blue corner</span>}>
        <Pick value={blueId} onChange={setBlueId} placeholder="Choose an athlete…" options={blueOptions} notFoundContent={bestOnly ? 'No one fits. Turn off Best match to see everyone.' : undefined} />
      </Field>
      {suggestion && <FullRow><Muted>{suggestion}</Muted></FullRow>}
      {check && check.blocks.map((b) => <FullRow key={b}><Text type="danger">{b}</Text></FullRow>)}
      {check && check.blocks.length === 0 && check.warnings.length > 0 && (
        <FullRow><Text>Check before approving: {check.warnings.join('; ')}.</Text></FullRow>
      )}
      {check && check.blocks.length === 0 && check.warnings.length === 0 && <FullRow><Text strong>These two are a good match.</Text></FullRow>}
      {bout && <FullRow><Muted>Re-matching clears the bout's approvals; both corners and an official approve it again.</Muted></FullRow>}
    </FormCard>
  )
}

// ---------------------------------------------------------------------------
// One bout on the card
// ---------------------------------------------------------------------------

function BoutRow({ bout, index, count, event, athletes, weights, rights, canMatch, canSend, sessions, busy, run, onSend, onMove, onSession, onRematch }) {
  const [showComments, setShowComments] = useState(false)
  const [comment, setComment] = useState('')
  const [result, setResult] = useState(null) // { winner, method, note } while recording
  const red = athletes[bout.red_athlete_id]
  const blue = athletes[bout.blue_athlete_id]
  const approval = Object.fromEntries(bout.approvals.map((a) => [a.side, a]))
  const hasResult = Boolean(bout.winner)
  const open = rights.cardOpen && !hasResult

  // Re-check against weigh-in weights, so officials see a bout that no longer fits.
  const recheck = red && blue ? checkMatch(red, blue, event.start_date, weights) : null

  const canDecide = (side) => {
    if (!open) return false
    if (side === 'official') return rights.official
    const club = side === 'red' ? bout.red_club_id : bout.blue_club_id
    return rights.siteAdmin || rights.ownedClubs.has(club) || (bout.after_weigh_in && Boolean(rights.officialRole))
  }

  async function decide(side, approve) {
    let note = null
    if (!approve) {
      note = await askText('Why are you rejecting this bout? (optional)', { okText: 'Reject' })
      if (note === null) return
    }
    run(() => api.decideBout(bout.id, side, approve, note))
  }

  async function cancel() {
    const reason = await askText(`Take ${bout.red?.name} vs ${bout.blue?.name} off the card? Give a reason (optional).`, { okText: 'Cancel bout' })
    if (reason === null) return
    run(() => api.cancelBout(bout.id, reason))
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
      <Text strong>{athlete?.name ?? fallback?.name ?? 'Unknown'}</Text>
      <Text type="secondary">{club?.name ?? '—'}</Text>
      {athlete && <Text type="secondary">{categoryText(athlete, event.start_date)}{weights[athlete.id] != null ? ` · weighed ${formatWeight(weights[athlete.id])}` : ''}</Text>}
      {bout.winner === side && <span><Badge strong>Winner · {methodLabels[bout.method]}</Badge></span>}
    </div>
  )

  const order = rights.owner && rights.cardOpen ? (
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
          <span>Bout {index + 1}</span>
          <Badge strong={bout.status === 'approved'} muted={bout.status === 'rejected'}>{statusLabels[bout.status]}</Badge>
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
      {recheck && recheck.blocks.length > 0 && !hasResult && (
        <ErrorAlert>After the weigh-in this bout no longer fits: {recheck.blocks.join(' ')}</ErrorAlert>
      )}
      {bout.result_note && <Muted>Result note: {bout.result_note}</Muted>}

      <ul className="approvals">
        {['red', 'blue', 'official'].map((side) => {
          const a = approval[side]
          return (
            <li key={side}>
              <Space size={6} wrap>
                <span className={side === 'official' ? undefined : `corner-label ${side}`}>{sideLabels[side]}:</span>
                {a ? (
                  <span>{a.decision === 'approved' ? 'Approved' : 'Rejected'}{a.override ? ' by an official' : ''}{a.note ? ` (“${a.note}”)` : ''}</span>
                ) : (
                  <Text type="secondary">Waiting</Text>
                )}
                {canDecide(side) && a?.decision !== 'approved' && <Button size="small" type="link" disabled={busy} onClick={() => decide(side, true)}>Approve</Button>}
                {canDecide(side) && a?.decision !== 'rejected' && <Button size="small" type="link" danger disabled={busy} onClick={() => decide(side, false)}>Reject</Button>}
              </Space>
            </li>
          )
        })}
      </ul>

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
        {canMatch && !hasResult && <Button size="small" danger disabled={busy} onClick={cancel}>Cancel bout</Button>}
        {rights.official && bout.status === 'approved' && !result && (
          <Button size="small" type="primary" disabled={busy} onClick={() => setResult({ winner: bout.winner ?? '', method: bout.method ?? '', note: bout.result_note ?? '' })}>
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

// Approvals still needed that nobody could be told about: a club with no Owner, or no Chief
// Official or Deputy yet.
function missingApprovers(list, rows, officials) {
  const told = new Set(rows.map((r) => `${r.bout_id}:${r.side}`))
  const notes = new Set()
  for (const b of list.filter(sendable)) {
    const approved = new Set(b.approvals.filter((a) => a.decision === 'approved').map((a) => a.side))
    for (const side of ['red', 'blue']) {
      if (!approved.has(side) && !told.has(`${b.id}:${side}`)) {
        const club = side === 'red' ? b.red_club?.name : b.blue_club?.name
        notes.add(club ? `${club} has no club Owner with an email` : 'an athlete has no club')
      }
    }
    if (!approved.has('official') && !told.has(`${b.id}:official`)) {
      notes.add(officials.length ? 'the Chief Official and Deputy have no email' : 'the event has no Chief Official or Deputy yet')
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

function WeighIn({ event, day, bouts, athletes, weighIns, busy, run }) {
  const recorded = Object.fromEntries(weighIns.map((w) => [w.athlete_id, w]))
  // Everyone boxing that day, plus anyone already weighed in.
  const ids = [...new Set([...bouts.flatMap((b) => [b.red_athlete_id, b.blue_athlete_id]), ...weighIns.map((w) => w.athlete_id)])]
  const rows = ids.map((id) => athletes[id]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name))

  async function save(athlete, form) {
    await run(async () => {
      await api.recordWeighIn({ eventId: event.id, day, athleteId: athlete.id, weightKg: form.weight, medical: form.medical, note: form.note })
      if (form.medical !== 'pass') return
      // Re-check this athlete's bouts against the new weight; take off any that no longer fit.
      const weights = Object.fromEntries(weighIns.filter((w) => w.weight_kg != null).map((w) => [w.athlete_id, Number(w.weight_kg)]))
      weights[athlete.id] = Number(form.weight)
      for (const b of bouts.filter((x) => !x.winner && [x.red_athlete_id, x.blue_athlete_id].includes(athlete.id))) {
        const check = checkMatch(athletes[b.red_athlete_id], athletes[b.blue_athlete_id], event.start_date, weights)
        if (check.blocks.length) await api.cancelBout(b.id, `Doesn't fit after the weigh-in: ${check.blocks.join(' ')}`)
      }
    })
  }

  // Each row keeps its own form; the key resets it when a new weigh-in is recorded.
  const columns = [
    { title: 'Athlete', key: 'athlete', value: (a) => `${a.name} ${a.club ?? ''}`, render: (_, a) => <>{a.name}<br /><Text type="secondary">{a.club ?? '—'}</Text></> },
    { title: 'Entered', key: 'entered', value: (a) => a.weight_kg, render: (_, a) => formatWeight(a.weight_kg) },
    {
      title: 'Weigh-in',
      key: 'form',
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
        <DataTable rowKey="id" columns={columns} dataSource={rows} />
      )}
      <Muted>A failed medical or a no-show takes the athlete's bouts off the card. A bout that no longer fits the weight allowance after the weigh-in is cancelled too.</Muted>
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
