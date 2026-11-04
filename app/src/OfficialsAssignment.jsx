// The Officials assignment tab (migration 47): who judges, referees, supervises, keeps time or rests
// on each bout of a night. The Chief Officials make the plan (the app fills it from the rules in
// officialPlan.js), change it by hand and approve it. Once approved, every official working the
// event sees it, read-only.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Select, Space, Table, Tabs, Tooltip } from 'antd'
import { CheckOutlined, EditOutlined, PrinterOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { api } from './api'
import { categoryText } from './categories'
import { DownloadCsvButton } from './DataTable'
import { DEFAULT_TIME_ZONE, formatDay, formatShortDay, todayIso } from './dates'
import { askConfirm } from './dialogs'
import { eventRoles, rolesFlags } from './officialRoles'
import {
  HIGH_LEVEL, MIN_OFFICIALS_TO_RUN, boutProblems, generatePlan, planRoleLabel, planRoles, planToSlots,
  plannedBouts, roleCounts, slotsToPlan,
} from './officialPlan'
import { Badge, ErrorAlert, Muted, Section, Text } from './ui'

const boutName = (b) => `${b.red?.name ?? 'Red'} vs ${b.blue?.name ?? 'Blue'}`

// Both corners with their club and categories: "Ali Hassan (Eastside BC) · Elite · 63.5 kg · Open".
function BoutCorners({ bout, event }) {
  const athletes = event.athletes ?? []
  const corner = (side) => {
    const a = athletes.find((x) => x.id === bout[`${side}_athlete_id`])
    const cats = categoryText(a, event.start_date)
    const club = bout[`${side}_club`]?.name
    return (
      <div className={`plan-corner ${side}`}>
        <Text strong>{a?.name ?? bout[side]?.name ?? (side === 'red' ? 'Red' : 'Blue')}</Text>
        {club && <Text type="secondary"> ({club})</Text>}
        {cats && <div className="plan-cats">{cats}</div>}
      </div>
    )
  }
  return <div className="plan-corners">{corner('red')}<div className="plan-vs">vs</div>{corner('blue')}</div>
}
const levelText = (o) => (o.level ? `Level ${o.level}` : 'No level')
const stamp = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
// The approved sheet as rows: a header, then one row per bout.
function sheetRows(event, day, bouts, pool, plan) {
  const name = (id) => pool.find((o) => o.user_id === id)?.name ?? ''
  const holders = (b, role) => Object.entries(plan[b.id] ?? {}).filter(([, r]) => r === role).map(([id]) => name(id)).join(', ')
  const side = (b, s) => {
    const a = (event.athletes ?? []).find((x) => x.id === b[`${s}_athlete_id`])
    return [a?.name ?? b[s]?.name ?? '', b[`${s}_club`]?.name ?? '', categoryText(a, event.start_date)]
  }
  return [
    ['Day', 'Bout', 'Red boxer', 'Red club', 'Red category', 'Blue boxer', 'Blue club', 'Blue category',
      'Supervisor', 'Referee', 'Judges', 'Timekeeper', 'Resting'],
    ...bouts.map((b, i) => [
      day, i + 1, ...side(b, 'red'), ...side(b, 'blue'),
      holders(b, 'supervisor'), holders(b, 'referee'), holders(b, 'judge'), holders(b, 'timekeeper'), holders(b, 'rest'),
    ]),
  ]
}

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// Opens the sheet in a new window ready to print or save as PDF.
function printSheet(event, day, rows) {
  const win = window.open('', '_blank')
  if (!win) return
  const [header, ...body] = rows
  const cell = (tag) => (v) => `<${tag}>${escapeHtml(v)}</${tag}>`
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Officials plan - ${escapeHtml(event.name)} - ${day}</title>
<style>
  body { font: 13px/1.35 system-ui, sans-serif; color: #111; margin: 16px; }
  h1 { font-size: 20px; margin: 0 0 4px; } p { margin: 0 0 12px; color: #333; }
  table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #eef1f8; } tr { page-break-inside: avoid; }
  @page { size: landscape; margin: 10mm; }
</style></head><body>
<h1>${escapeHtml(event.name)}: officials plan</h1><p>${escapeHtml(formatDay(day))}</p>
<table><thead><tr>${header.slice(1).map(cell('th')).join('')}</tr></thead>
<tbody>${body.map((r) => `<tr>${r.slice(1).map(cell('td')).join('')}</tr>`).join('')}</tbody></table>
<script>window.onload = () => window.print()</script></body></html>`)
  win.document.close()
}

function SheetButtons({ event, day, bouts, pool, plan }) {
  const rows = () => sheetRows(event, day, bouts, pool, plan)
  return (
    <Space wrap>
      <DownloadCsvButton filename={`${event.name} officials plan ${day}`} getRows={rows} />
      <Button icon={<PrinterOutlined />} onClick={() => printSheet(event, day, rows())}>Print or save as PDF</Button>
    </Space>
  )
}

// Roles that only one person holds on a bout: picking someone swaps them with whoever had it.
const singleRoles = new Set(['referee', 'supervisor', 'timekeeper'])

export default function OfficialsAssignment({ event, bouts }) {
  const { data, rights } = bouts
  const planner = Boolean(rights?.siteAdmin || rights?.officialRole)
  const days = useMemo(
    () => [...new Set((data?.bouts ?? []).filter((b) => !['cancelled', 'rejected'].includes(b.status)).map((b) => b.day))].sort(),
    [data],
  )
  const today = todayIso(event.timezone || DEFAULT_TIME_ZONE)
  const [day, setDay] = useState(() => (days.includes(today) ? today : days[0]))
  const shownDay = days.includes(day) ? day : days[0]

  if (!data) return bouts.error ? <ErrorAlert>{bouts.error}</ErrorAlert> : <Muted>Loading…</Muted>
  if (!days.length) return <Muted>There are no bouts on the card yet. Once bouts are made, the officials can be planned here.</Muted>

  return (
    <>
      {days.length > 1 && (
        <Tabs activeKey={shownDay} onChange={setDay} items={days.map((d) => ({ key: d, label: formatShortDay(d) }))} />
      )}
      <DayPlan key={shownDay} event={event} day={shownDay} bouts={plannedBouts(data.bouts, shownDay)} planner={planner} me={rights?.me} />
    </>
  )
}

function DayPlan({ event, day, bouts, planner, me }) {
  const [loaded, setLoaded] = useState(null)
  const [draft, setDraft] = useState({})
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async ({ keepDraft = false } = {}) => {
    try {
      const result = await api.getOfficialPlan(event.id, day)
      setLoaded(result)
      if (!keepDraft) {
        setDraft(slotsToPlan(result.slots))
        setDirty(false)
      }
    } catch (err) {
      setError(err.message)
    }
  }, [event.id, day])

  useEffect(() => {
    load()
  }, [load])

  async function run(action, options) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load(options)
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return error ? <ErrorAlert>{error}</ErrorAlert> : <Muted>Loading…</Muted>

  const { plan, pool } = loaded
  const approved = plan?.status === 'approved'

  // Officials who aren't a Chief Official only see an approved plan.
  if (!planner) {
    if (!approved) return <Muted>The Chief Officials haven&apos;t approved the officials plan for {formatDay(day)} yet. You&apos;ll be notified when they do.</Muted>
    return <ReadOnlyPlan event={event} day={day} bouts={bouts} pool={pool} plan={draft} approvedAt={plan.approved_at} me={me} />
  }

  const editing = !approved && event.status === 'active'
  const tooFew = pool.length < MIN_OFFICIALS_TO_RUN
  const noSupervisor = !tooFew && !pool.some((o) => o.supervisor)
  const problemsByBout = Object.fromEntries(bouts.map((b, i) => [b.id, boutProblems(draft[b.id], pool, i ? draft[bouts[i - 1].id] : null)]))
  const blocking = bouts.filter((b) => problemsByBout[b.id].some((p) => p.blocking)).length
  const hasAny = bouts.some((b) => Object.keys(draft[b.id] ?? {}).length)

  async function makePlan() {
    if (hasAny && !(await askConfirm('Make a new plan? This replaces every assignment on this night, including changes you made by hand.', { okText: 'Make new plan' }))) return
    setDraft(generatePlan(pool, bouts))
    setDirty(true)
  }

  function change(boutId, userId, role) {
    setDraft((prev) => {
      const row = { ...(prev[boutId] ?? {}) }
      const old = row[userId] ?? 'rest'
      if (singleRoles.has(role)) {
        for (const [other, r] of Object.entries(row)) if (other !== userId && r === role) row[other] = old
      }
      row[userId] = role
      return { ...prev, [boutId]: row }
    })
    setDirty(true)
  }

  const save = () => api.saveOfficialPlan(event.id, day, planToSlots(draft, bouts, pool))

  async function approve() {
    const ok = await askConfirm(
      `Approve the officials plan for ${formatDay(day)}? Every official working that night will be told and can see it, and it becomes who works each bout on the Bouts tab.`,
      { okText: 'Approve plan' },
    )
    if (!ok) return
    run(async () => {
      if (dirty || !plan) await save()
      await api.approveOfficialPlan(event.id, day)
    })
  }

  async function reopen() {
    if (!(await askConfirm('Change the approved plan? Officials won\'t see it again until you approve it again. The bouts keep the approved officials until then.', { okText: 'Change plan' }))) return
    run(() => api.reopenOfficialPlan(event.id, day))
  }

  const status = approved
    ? <Alert type="success" showIcon className="gap" title={`Approved ${stamp(plan.approved_at)}. Every official working ${formatDay(day)} can see this plan.`} />
    : plan
      ? <Alert type="info" showIcon className="gap" title={`Draft, saved ${stamp(plan.updated_at)}. Only the Chief Officials can see it until it is approved.`} />
      : null

  return (
    <>
      <ErrorAlert>{error}</ErrorAlert>
      {tooFew && (
        <Alert
          type="error"
          showIcon
          className="gap"
          title={`Only ${pool.length} official${pool.length === 1 ? ' is' : 's are'} working ${formatDay(day)}.`}
          description={`A night needs at least ${MIN_OFFICIALS_TO_RUN} (1 supervisor, 1 referee and 3 judges). With fewer, these bouts can't go ahead and the event is cancelled. Invite more officials on the Officials tab, or ask the Owner or a site Admin to cancel the event.`}
        />
      )}
      {noSupervisor && (
        <Alert type="warning" showIcon className="gap" title="Nobody working this night ticked Supervisor. Tick it for someone below so every bout can have one." />
      )}
      {status}

      <DayOfficials event={event} pool={pool} plan={draft} canEdit={planner && event.status === 'active'} busy={busy} run={run} keepDraft={dirty} />

      <Section
        title={`Plan for ${formatDay(day)}`}
        extra={(
          <Space wrap>
            {editing && (
              <Button icon={<ThunderboltOutlined />} disabled={tooFew || busy} onClick={makePlan}>
                {hasAny ? 'Make a new plan' : 'Make plan'}
              </Button>
            )}
            {editing && (
              <Button disabled={!dirty || busy} onClick={() => run(save)}>Save draft</Button>
            )}
            {editing && (
              <Tooltip title={blocking ? `${blocking} bout${blocking === 1 ? ' needs' : 's need'} fixing first` : ''}>
                <Button type="primary" icon={<CheckOutlined />} disabled={!hasAny || blocking > 0 || busy} onClick={approve}>Approve plan</Button>
              </Tooltip>
            )}
            {approved && <SheetButtons event={event} day={day} bouts={bouts} pool={pool} plan={draft} />}
            {approved && event.status === 'active' && (
              <Button icon={<EditOutlined />} disabled={busy} onClick={reopen}>Change plan</Button>
            )}
          </Space>
        )}
      >
        {!hasAny && editing && !tooFew && (
          <Muted>
            Press Make plan to fill in every bout from the rules: 1 supervisor (only people who ticked it, the same person all
            night), 1 referee who rests the next bout when there are more than 5 officials, and 3 judges (5 when there are
            more than 5 officials) favouring level {HIGH_LEVEL} and 4, picked at random where levels are equal. A timekeeper
            is added when 5 judges are in place. You can change any of it before approving.
          </Muted>
        )}
        {dirty && editing && <Muted>You have changes that aren&apos;t saved yet.</Muted>}
        <PlanGrid event={event} bouts={bouts} pool={pool} plan={draft} problems={problemsByBout} editing={editing && !tooFew} onChange={change} me={me} />
      </Section>
    </>
  )
}

// The officials working the night: level, the roles they can do (Chief Officials can change them on
// the day) and how many bouts they have in each role.
function DayOfficials({ event, pool, plan, canEdit, busy, run, keepDraft }) {
  const counts = roleCounts(plan, pool)
  const columns = [
    { title: 'Official', key: 'name', render: (_, o) => <Text strong>{o.name}</Text> },
    { title: 'Level', key: 'level', render: (_, o) => levelText(o) },
    {
      title: 'Can do',
      key: 'roles',
      render: (_, o) => (
        <Checkbox.Group
          disabled={!canEdit || busy}
          value={eventRoles.filter((r) => o[r.key]).map((r) => r.key)}
          options={eventRoles.map((r) => ({ value: r.key, label: r.label }))}
          onChange={(keys) => {
            if (!keys.length) return
            run(() => api.setOfficialEventRoles(event.id, o.user_id, rolesFlags(keys)), { keepDraft })
          }}
        />
      ),
    },
    {
      title: 'Bouts',
      key: 'counts',
      render: (_, o) => planRoles.filter((r) => counts[o.user_id]?.[r.key]).map((r) => `${r.label} ${counts[o.user_id][r.key]}`).join(' · ') || '—',
    },
  ]
  return (
    <Section title={`Officials working (${pool.length})`}>
      {canEdit && <Muted>On the day you can change what each official can do. The plan uses these ticks.</Muted>}
      <Table size="small" rowKey="user_id" columns={columns} dataSource={pool} pagination={false} scroll={{ x: 'max-content' }} />
    </Section>
  )
}

// One row per bout, one column per official. Chief Officials pick each official's role per bout.
function PlanGrid({ event, bouts, pool, plan, problems, editing, onChange, me }) {
  const options = planRoles.map((r) => ({ value: r.key, label: r.label }))
  const columns = [
    { title: '#', key: 'n', width: 48, fixed: 'left', render: (_, b, i) => i + 1 },
    {
      title: 'Bout',
      key: 'bout',
      fixed: 'left',
      width: 280,
      render: (_, b) => (
        <>
          <BoutCorners bout={b} event={event} />
          {b.status === 'pending' && <Badge muted>Waiting for approval</Badge>}
          {b.winner && <Badge muted>Has a result</Badge>}
          {(problems[b.id] ?? []).map((p) => (
            <div key={p.text}><Text type={p.blocking ? 'danger' : 'warning'}>{p.text}</Text></div>
          ))}
        </>
      ),
    },
    ...pool.map((o) => ({
      title: <span title={levelText(o)}>{o.name}{o.user_id === me ? ' (you)' : ''}<br /><Text type="secondary">L{o.level ?? '–'}</Text></span>,
      key: o.user_id,
      width: 140,
      render: (_, b) => {
        const role = plan[b.id]?.[o.user_id]
        if (!editing) return role ? <RoleTag role={role} /> : '—'
        return (
          <Select
            size="middle"
            aria-label={`${o.name} on ${boutName(b)}`}
            className={`plan-role plan-role-${role ?? 'none'}`}
            style={{ width: 128 }}
            value={role}
            placeholder="Pick"
            options={options.map((opt) => ({ ...opt, label: o[opt.value] || opt.value === 'rest' ? opt.label : `${opt.label} (not ticked)` }))}
            onChange={(value) => onChange(b.id, o.user_id, value)}
          />
        )
      },
    })),
  ]
  return (
    <Table
      className="plan-grid"
      size="small"
      rowKey="id"
      columns={columns}
      dataSource={bouts}
      pagination={false}
      scroll={{ x: 'max-content' }}
      rowClassName={(b) => ((problems[b.id] ?? []).some((p) => p.blocking) ? 'row-error' : '')}
    />
  )
}

function RoleTag({ role }) {
  return <span className={`role-tag role-${role}`}>{planRoleLabel[role]}</span>
}

// What officials see once the plan is approved: their own night first, then every bout.
function ReadOnlyPlan({ event, day, bouts, pool, plan, approvedAt, me }) {
  const name = (id) => {
    const o = pool.find((x) => x.user_id === id)
    return o ? `${o.name}${id === me ? ' (you)' : ''}` : 'Someone'
  }
  const holders = (b, role) => Object.entries(plan[b.id] ?? {}).filter(([, r]) => r === role).map(([id]) => name(id))
  const mine = bouts.map((b, i) => ({ n: i + 1, bout: b, role: plan[b.id]?.[me] })).filter((x) => x.role)
  return (
    <>
      <Alert type="success" showIcon className="gap" title={`The Chief Officials approved this plan for ${formatDay(day)} on ${stamp(approvedAt)}.`} />
      <div className="gap"><SheetButtons event={event} day={day} bouts={bouts} pool={pool} plan={plan} /></div>
      {mine.length > 0 && (
        <Section title="Your night">
          <ul className="plan-mine">
            {mine.map((x) => (
              <li key={x.bout.id}>
                <Text strong>Bout {x.n}:</Text> <RoleTag role={x.role} />
                <BoutCorners bout={x.bout} event={event} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title={`Every bout on ${formatDay(day)}`}>
        {bouts.map((b, i) => (
          <div key={b.id} className="plan-bout">
            <Text strong>Bout {i + 1}</Text>
            <BoutCorners bout={b} event={event} />
            <div>Supervisor: {holders(b, 'supervisor').join(', ') || '—'}</div>
            <div>Referee: {holders(b, 'referee').join(', ') || '—'}</div>
            <div>Judges: {holders(b, 'judge').join(', ') || '—'}</div>
            {holders(b, 'timekeeper').length > 0 && <div>Timekeeper: {holders(b, 'timekeeper').join(', ')}</div>}
            {holders(b, 'rest').length > 0 && <div><Text type="secondary">Resting: {holders(b, 'rest').join(', ')}</Text></div>}
          </div>
        ))}
      </Section>
    </>
  )
}
