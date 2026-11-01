// Stage 4 (plan/events.md sections 4 to 6): the event's officials, bout matching and
// approvals, comments, the weigh-in, the card order and results.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { formatWeight } from './athletes'
import { categorise } from './categories'
import { daysBetween, formatDay, formatShortDay } from './dates'
import { checkMatch } from './matching'

const officialLabels = { chief: 'Chief Official', deputy: 'Deputy' }
const statusLabels = { pending: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' }
const sideLabels = { red: 'Red corner', blue: 'Blue corner', official: 'Official' }
const medicalLabels = { pass: 'Passed', fail: 'Failed', absent: 'No-show' }
const methodLabels = { points: 'Points', rsc: 'RSC', ko: 'KO', walkover: 'Walkover', dq: 'DQ', abd: 'ABD' }
const personName = (user) => (user ? user.name || user.email : '—')

function categoryText(athlete, eventDate) {
  if (!athlete?.date_of_birth) return ''
  const c = categorise(athlete, eventDate)
  return [c.age?.label, c.weight?.label, c.experience?.label].filter(Boolean).join(' · ')
}

export default function EventBouts({ event, may, clubs, profile, onEntriesChange }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      setData(await api.getBouts(event.id))
    } catch (err) {
      setError(err.message)
    }
  }, [event.id])

  useEffect(() => {
    reload()
  }, [reload])

  async function run(action, { entries = false } = {}) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await reload()
      if (entries) await onEntriesChange()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  if (!data) return error ? <p className="error">{error}</p> : null

  const officialRole = data.officials.find((o) => o.user_id === profile?.id)?.role ?? null
  const ownedClubs = new Set(clubs.filter((c) => c.members.some((m) => m.user_id === profile?.id && m.role === 'owner' && m.status === 'active')).map((c) => c.id))
  const rights = {
    siteAdmin: may.siteAdmin,
    owner: may.siteAdmin || may.role === 'owner',
    official: may.siteAdmin || Boolean(officialRole),
    officialRole,
    ownedClubs,
    cardOpen: event.status === 'active',
  }
  const seesBouts = rights.owner || rights.official || event.athletes.length > 0

  return (
    <>
      <Officials event={event} officials={data.officials} canEdit={may.edit} busy={busy} run={run} />
      {error && <p className="error">{error}</p>}
      {seesBouts && ['active', 'done'].includes(event.status) && (
        <Card event={event} data={data} rights={rights} busy={busy} run={run} />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Officials
// ---------------------------------------------------------------------------

function Officials({ event, officials, canEdit, busy, run }) {
  const [users, setUsers] = useState([])
  useEffect(() => {
    if (canEdit) api.listUsers().then((all) => setUsers(all.filter((u) => u.id && u.state === 'Active')), () => setUsers([]))
  }, [canEdit])
  const byRole = Object.fromEntries(officials.map((o) => [o.role, o]))
  const missing = ['chief', 'deputy'].filter((r) => !byRole[r])

  return (
    <section>
      <h2>Officials</h2>
      {missing.length > 0 && (
        <p className="muted">Every event needs a Chief Official and a Deputy. They approve bouts, run the weigh-in and record results.</p>
      )}
      <dl className="facts">
        {['chief', 'deputy'].map((role) => (
          <div key={role}>
            <dt>{officialLabels[role]}</dt>
            <dd>
              {canEdit ? (
                <select
                  aria-label={officialLabels[role]}
                  value={byRole[role]?.user_id ?? ''}
                  disabled={busy}
                  onChange={(e) => run(() => api.setEventOfficial(event.id, role, e.target.value))}
                >
                  <option value="">Not chosen</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name ? `${u.name} (${u.email})` : u.email}</option>)}
                </select>
              ) : (
                personName(byRole[role]?.user) || 'Not chosen'
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
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
  const dayBouts = data.bouts.filter((b) => b.day === day)
  const live = dayBouts.filter((b) => b.status !== 'cancelled').sort((a, b) => a.position - b.position)
  const cancelled = dayBouts.filter((b) => b.status === 'cancelled')
  const sessions = event.days.find((d) => d.day === day)?.sessions ?? []

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
    <section>
      <h2>Bouts</h2>
      {days.length > 1 && (
        <nav className="tabs">
          {days.map((d) => (
            <button key={d} className={d === day ? 'tab active' : 'tab'} onClick={() => { setDay(d); setRematch(null) }}>
              {formatShortDay(d)} ({data.bouts.filter((b) => b.day === d && b.status !== 'cancelled').length})
            </button>
          ))}
        </nav>
      )}
      {weighInStarted && <p className="muted">The weigh-in for {formatDay(day)} has started, so only the Chief Official or Deputy can make or change bouts.</p>}

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
        <p className="muted">No bouts on {formatDay(day)} yet.</p>
      ) : (
        <div className="bout-list">
          {live.map((b, i) => (
            <BoutRow
              key={b.id} bout={b} index={i} count={live.length} event={event} athletes={athletes} weights={weights}
              rights={rights} canMatch={canMatch} sessions={sessions} busy={busy} run={run}
              onMove={(delta) => move(b, delta)} onSession={(s) => setSession(b, s)} onRematch={() => setRematch(b)}
            />
          ))}
        </div>
      )}

      {cancelled.length > 0 && (
        <details>
          <summary>Cancelled bouts ({cancelled.length})</summary>
          <ul>
            {cancelled.map((b) => (
              <li key={b.id}>{b.red?.name ?? '?'} vs {b.blue?.name ?? '?'}{b.cancel_reason ? ` — ${b.cancel_reason}` : ''}</li>
            ))}
          </ul>
        </details>
      )}

      {rights.official && rights.cardOpen && (
        <WeighIn event={event} day={day} bouts={live} athletes={athletes} weighIns={weighIns} busy={busy} run={run} />
      )}
      {!rights.official && weighIns.length > 0 && (
        <p className="muted">Weigh-in recorded for {weighIns.length} athlete{weighIns.length === 1 ? '' : 's'} on {formatDay(day)}.</p>
      )}
    </section>
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
  const options = (other) => event.athletes.filter((a) => a.id !== other)

  function option(a) {
    const busyThatDay = taken.has(a.id)
    return (
      <option key={a.id} value={a.id} disabled={busyThatDay}>
        {a.name} · {a.club ?? '—'} · {categoryText(a, event.start_date)}{busyThatDay ? ' (already boxing this day)' : ''}
      </option>
    )
  }

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
    <form onSubmit={save} className="row-form">
      <h2>{bout ? `Re-match bout ${bout.red?.name ?? ''} vs ${bout.blue?.name ?? ''}` : `Match a bout on ${formatDay(day)}`}</h2>
      <label>
        Red corner
        <select value={redId} onChange={(e) => setRedId(e.target.value)}>
          <option value="">Choose an athlete…</option>
          {options(blueId).map(option)}
        </select>
      </label>
      <label>
        Blue corner
        <select value={blueId} onChange={(e) => setBlueId(e.target.value)}>
          <option value="">Choose an athlete…</option>
          {options(redId).map(option)}
        </select>
      </label>
      {suggestion && <p className="muted full">{suggestion}</p>}
      {check && check.blocks.map((b) => <p key={b} className="error full">{b}</p>)}
      {check && check.blocks.length === 0 && check.warnings.length > 0 && (
        <p className="full">Check before approving: {check.warnings.join('; ')}.</p>
      )}
      {check && check.blocks.length === 0 && check.warnings.length === 0 && <p className="full">These two are a good match.</p>}
      <div className="form-actions full">
        <button type="submit" disabled={busy || !check || check.blocks.length > 0}>{bout ? 'Save re-match' : 'Make bout'}</button>
        {bout && <button type="button" className="secondary" onClick={onCancel}>Cancel</button>}
      </div>
      {bout && <p className="muted full">Re-matching clears the bout's approvals; both corners and an official approve it again.</p>}
    </form>
  )
}

// ---------------------------------------------------------------------------
// One bout on the card
// ---------------------------------------------------------------------------

function BoutRow({ bout, index, count, event, athletes, weights, rights, canMatch, sessions, busy, run, onMove, onSession, onRematch }) {
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

  function decide(side, approve) {
    let note = null
    if (!approve) {
      note = window.prompt('Why are you rejecting this bout? (optional)')
      if (note === null) return
    }
    run(() => api.decideBout(bout.id, side, approve, note))
  }

  function cancel() {
    const reason = window.prompt(`Take ${bout.red?.name} vs ${bout.blue?.name} off the card? Give a reason (optional).`)
    if (reason === null) return
    run(() => api.cancelBout(bout.id, reason))
  }

  async function addComment(e) {
    e.preventDefault()
    if (await run(() => api.addBoutComment(bout.id, comment))) setComment('')
  }

  async function saveResult(e) {
    e.preventDefault()
    if (await run(() => api.recordResult(bout.id, result.winner, result.method, result.note), { entries: true })) setResult(null)
  }

  const corner = (side, athlete, fallback, club) => (
    <div className={`corner ${side}`}>
      <strong>{athlete?.name ?? fallback?.name ?? 'Unknown'}</strong>
      <span className="muted">{club?.name ?? '—'}</span>
      {athlete && <span className="muted">{categoryText(athlete, event.start_date)}{weights[athlete.id] != null ? ` · weighed ${formatWeight(weights[athlete.id])}` : ''}</span>}
      {bout.winner === side && <span className="badge">Winner · {methodLabels[bout.method]}</span>}
    </div>
  )

  return (
    <article className={`bout status-${bout.status}`}>
      <div className="bout-head">
        <span className="bout-number">Bout {index + 1}</span>
        <span className={`badge bout-${bout.status}`}>{statusLabels[bout.status]}</span>
        {bout.needs_supervisor && <span className="badge">U17 v U19: needs the official's approval</span>}
        {rights.owner && rights.cardOpen && (
          <span className="bout-order">
            {sessions.length > 0 && (
              <select aria-label="Session" value={bout.session_starts_at?.slice(0, 5) ?? ''} disabled={busy} onChange={(e) => onSession(e.target.value || null)}>
                <option value="">No session</option>
                {sessions.map((s) => <option key={s.starts_at} value={s.starts_at}>{s.label ? `${s.label} ${s.starts_at}` : s.starts_at}</option>)}
              </select>
            )}
            <button className="link" disabled={busy || index === 0} onClick={() => onMove(-1)} aria-label="Move up">↑</button>
            <button className="link" disabled={busy || index === count - 1} onClick={() => onMove(1)} aria-label="Move down">↓</button>
          </span>
        )}
        {!rights.owner && bout.session_starts_at && <span className="muted">Session {bout.session_starts_at.slice(0, 5)}</span>}
      </div>
      <div className="bout-corners">
        {corner('red', red, bout.red, bout.red_club)}
        <span className="vs">vs</span>
        {corner('blue', blue, bout.blue, bout.blue_club)}
      </div>
      {bout.warnings.length > 0 && <p className="muted">Gaps: {bout.warnings.join('; ')}.</p>}
      {recheck && recheck.blocks.length > 0 && !hasResult && (
        <p className="error">After the weigh-in this bout no longer fits: {recheck.blocks.join(' ')}</p>
      )}
      {bout.result_note && <p className="muted">Result note: {bout.result_note}</p>}

      <ul className="approvals">
        {['red', 'blue', 'official'].map((side) => {
          const a = approval[side]
          return (
            <li key={side}>
              {sideLabels[side]}:{' '}
              {a ? (
                <span>{a.decision === 'approved' ? 'Approved' : 'Rejected'}{a.override ? ' by an official' : ''}{a.note ? ` (“${a.note}”)` : ''}</span>
              ) : (
                <span className="muted">Waiting</span>
              )}
              {canDecide(side) && (
                <>
                  {' '}
                  {a?.decision !== 'approved' && <button className="link" disabled={busy} onClick={() => decide(side, true)}>Approve</button>}
                  {' '}
                  {a?.decision !== 'rejected' && <button className="link danger" disabled={busy} onClick={() => decide(side, false)}>Reject</button>}
                </>
              )}
            </li>
          )
        })}
      </ul>

      <div className="bout-actions">
        <button className="link" onClick={() => setShowComments(!showComments)}>
          {showComments ? 'Hide comments' : `Comments (${bout.comments.length})`}
        </button>
        {canMatch && !hasResult && <button className="link" disabled={busy} onClick={onRematch}>Re-match</button>}
        {canMatch && !hasResult && <button className="link danger" disabled={busy} onClick={cancel}>Cancel bout</button>}
        {rights.official && bout.status === 'approved' && !result && (
          <button className="link" disabled={busy} onClick={() => setResult({ winner: bout.winner ?? '', method: bout.method ?? '', note: bout.result_note ?? '' })}>
            {hasResult ? 'Change result' : 'Record result'}
          </button>
        )}
        {rights.official && hasResult && (
          <button className="link danger" disabled={busy} onClick={() => window.confirm('Remove this result? Both boxers\' bout counts go back down by one.') && run(() => api.clearResult(bout.id), { entries: true })}>
            Remove result
          </button>
        )}
      </div>

      {result && (
        <form onSubmit={saveResult} className="row-form compact">
          <label>
            Winner
            <select required value={result.winner} onChange={(e) => setResult({ ...result, winner: e.target.value })}>
              <option value="">Choose…</option>
              <option value="red">{bout.red?.name} (red)</option>
              <option value="blue">{bout.blue?.name} (blue)</option>
            </select>
          </label>
          <label>
            Method
            <select required value={result.method} onChange={(e) => setResult({ ...result, method: e.target.value })}>
              <option value="">Choose…</option>
              {Object.entries(methodLabels).map(([key, labelText]) => <option key={key} value={key}>{labelText}</option>)}
            </select>
          </label>
          <label>Note <span className="muted">(optional)</span><input value={result.note} onChange={(e) => setResult({ ...result, note: e.target.value })} /></label>
          <div className="form-actions">
            <button type="submit" disabled={busy}>Save result</button>
            <button type="button" className="secondary" onClick={() => setResult(null)}>Cancel</button>
          </div>
          {!hasResult && <p className="muted full">Saving adds one to both boxers' bout counts.</p>}
        </form>
      )}

      {showComments && (
        <div className="comments">
          {bout.comments.length === 0 && <p className="muted">No comments yet.</p>}
          {bout.comments.map((c) => (
            <p key={c.id}>
              <strong>{personName(c.author)}</strong> <span className="muted">{new Date(c.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              <br />
              {c.body}
            </p>
          ))}
          <form onSubmit={addComment} className="inline-edit">
            <input aria-label="Comment" placeholder="Add a comment" value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} />
            <button type="submit" className="secondary" disabled={busy || !comment.trim()}>Post</button>
          </form>
        </div>
      )}
    </article>
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

  return (
    <div className="weigh-in">
      <h3>Weigh-in, {formatDay(day)}</h3>
      {rows.length === 0 ? (
        <p className="muted">Nobody is boxing this day yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Athlete</th><th>Entered</th><th>Weight (kg)</th><th>Medical</th><th>Note</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <WeighInRow key={`${a.id}-${recorded[a.id]?.recorded_at ?? ''}`} athlete={a} recorded={recorded[a.id]} busy={busy} onSave={(form) => save(a, form)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">A failed medical or a no-show takes the athlete's bouts off the card. A bout that no longer fits the weight allowance after the weigh-in is cancelled too.</p>
    </div>
  )
}

function WeighInRow({ athlete, recorded, busy, onSave }) {
  const [form, setForm] = useState({
    weight: recorded?.weight_kg ?? '', medical: recorded?.medical ?? 'pass', note: recorded?.note ?? '',
  })
  return (
    <tr>
      <td>{athlete.name}<br /><span className="muted">{athlete.club ?? '—'}</span></td>
      <td>{formatWeight(athlete.weight_kg)}</td>
      <td><input aria-label={`${athlete.name} weight`} type="number" step="0.1" min="10" max="250" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} /></td>
      <td>
        <select aria-label={`${athlete.name} medical`} value={form.medical} onChange={(e) => setForm({ ...form, medical: e.target.value })}>
          {Object.entries(medicalLabels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
        </select>
      </td>
      <td><input aria-label={`${athlete.name} note`} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></td>
      <td className="actions">
        <button className="secondary" disabled={busy || (form.medical === 'pass' && form.weight === '')} onClick={() => onSave(form)}>
          {recorded ? 'Update' : 'Save'}
        </button>
        {recorded && <span className="muted"> {medicalLabels[recorded.medical]}</span>}
      </td>
    </tr>
  )
}
