// The "Alerts" block at the top of the Home page: things waiting on the signed-in user.
// For now it lists to-dos worked out from the dashboard's data. The alerts and notifications
// work replaces this body with real alerts; keep the export and props the same.
//
// Props: profile, can, onOpen(target) where target is { page: 'events', eventId, tab } or
// { page: 'clubs', clubId }, and dashboard (what loadDashboard returned, or null while loading).
import { Button } from 'antd'
import { formatDateRange, formatDay } from './dates'
import { Muted, Section, Text } from './ui'

export default function HomeAlerts({ onOpen, dashboard }) {
  if (!dashboard) return null
  const items = todos(dashboard)

  return (
    <Section title={items.length ? `Alerts (${items.length})` : 'Alerts'}>
      {items.length === 0 ? (
        <Muted>Nothing needs you right now.</Muted>
      ) : (
        <ul className="alert-list">
          {items.map((item) => (
            <li key={item.key}>
              <div>
                <Text strong>{item.title}</Text>
                {item.note && <Text type="secondary" className="alert-note">{item.note}</Text>}
              </div>
              <Button size="small" onClick={() => onOpen(item.target)}>{item.action}</Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function todos({ admin, owner, club, official }) {
  const items = []
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

  for (const e of admin?.requested ?? []) {
    items.push({
      key: `approve-${e.id}`, title: `Approve ${e.name}`, note: `Requested · ${formatDateRange(e.start_date, e.end_date)}`,
      action: 'Open event', target: { page: 'events', eventId: e.id },
    })
  }
  if (admin?.clubInvites.length) {
    items.push({
      key: 'club-invites', title: `${plural(admin.clubInvites.length, 'club invite')} to approve`,
      note: admin.clubInvites.map((i) => `${i.user?.name || i.user?.email} to ${i.club?.name}`).join(', '),
      action: 'Open clubs', target: { page: 'clubs' },
    })
  }
  for (const i of official?.waiting ?? []) {
    items.push({
      key: `invite-${i.id}`, title: `Are you available for ${i.event_name}?`,
      note: `${formatDateRange(i.start_date, i.end_date)}${i.respond_by ? ` · answer by ${formatDay(i.respond_by)}` : ''}`,
      action: 'Answer', target: { page: 'events' },
    })
  }
  for (const r of owner?.rows ?? []) {
    const requests = r.joinRequests + r.lateEntries
    if (requests) {
      items.push({
        key: `requests-${r.event.id}`, title: `${plural(requests, 'request')} to answer for ${r.event.name}`,
        note: [r.joinRequests && plural(r.joinRequests, 'club asking to join'), r.lateEntries && plural(r.lateEntries, 'late entry')].filter(Boolean).join(' · '),
        action: 'Open clubs tab', target: { page: 'events', eventId: r.event.id, tab: 'clubs' },
      })
    }
    if (r.missingTimes) {
      items.push({
        key: `times-${r.event.id}`, title: `Add the weigh-in and bout times for ${r.event.name}`,
        action: 'Open settings', target: { page: 'events', eventId: r.event.id, tab: 'settings' },
      })
    }
  }
  const boutGroups = groupByEvent([...(club?.toApprove ?? []), ...(official?.toApprove ?? [])])
  for (const [eventId, { event, bouts }] of boutGroups) {
    items.push({
      key: `bouts-${eventId}`, title: `${plural(bouts.length, 'bout')} waiting for your approval`,
      note: event.name, action: 'Open bouts', target: { page: 'events', eventId, tab: 'bouts' },
    })
  }
  for (const t of club?.transfersIn ?? []) {
    items.push({
      key: `transfer-${t.id}`, title: `${t.athlete?.name} wants to move to ${t.to_club?.name}`,
      note: `From ${t.from_club?.name ?? 'no club'}`, action: 'Open club', target: { page: 'clubs', clubId: t.to_club_id },
    })
  }
  return items
}

// Bouts can show up twice (as club owner and as official); count each once per event.
function groupByEvent(bouts) {
  const groups = new Map()
  for (const b of bouts) {
    const group = groups.get(b.event.id) ?? { event: b.event, bouts: [], ids: new Set() }
    if (!group.ids.has(b.id)) {
      group.ids.add(b.id)
      group.bouts.push(b)
    }
    groups.set(b.event.id, group)
  }
  return groups
}
