// The "Alerts" block at the top of the Home page: what is waiting on the signed-in user.
// To-dos and unread updates come from notifications (Notifications.jsx, migration 22). Two things
// that are states rather than events are still worked out from the dashboard's data: events a
// site Admin still has to approve, and events whose Owner hasn't added the day times.
//
// Props: profile, can, onOpen(target) where target is { page: 'events', eventId, tab } or
// { page: 'clubs', clubId }, and dashboard (what loadDashboard returned, or null while loading).
import { Button } from 'antd'
import { formatDateRange } from './dates'
import { NotificationList } from './Notifications'
import { useNotifications } from './notify'
import { Muted, Section, Text } from './ui'

export default function HomeAlerts({ onOpen, dashboard }) {
  const notes = useNotifications()
  const items = dashboard ? todos(dashboard) : []
  const todo = notes?.todo ?? []
  const updates = (notes?.items ?? []).filter((n) => !n.read_at && !(n.needs_action && !n.done_at))
  const count = items.length + todo.length

  return (
    <>
      <Section title={count ? `To do (${count})` : 'To do'}>
        {items.length > 0 && (
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
        {todo.length > 0 && <NotificationList onOpen={onOpen} filter="todo" />}
        {count === 0 && !notes?.loading && <Muted>Nothing needs you right now.</Muted>}
      </Section>
      {updates.length > 0 && (
        <Section title={`New updates (${updates.length})`} extra={<Button size="small" onClick={() => notes.markRead(updates.map((n) => n.id))}>Mark all read</Button>}>
          <NotificationList onOpen={onOpen} filter="unread-updates" limit={8} />
        </Section>
      )}
    </>
  )
}

// States that aren't notifications: approving requested events (site Admins) and adding day times (Owners).
function todos({ admin, owner }) {
  const items = []
  for (const e of admin?.requested ?? []) {
    items.push({
      key: `approve-${e.id}`, title: `Approve ${e.name}`, note: `Requested · ${formatDateRange(e.start_date, e.end_date)}`,
      action: 'Open event', target: { page: 'events', eventId: e.id },
    })
  }
  for (const r of owner?.rows ?? []) {
    if (r.missingTimes) {
      items.push({
        key: `times-${r.event.id}`, title: `Add the weigh-in and bout times for ${r.event.name}`,
        action: 'Open settings', target: { page: 'events', eventId: r.event.id, tab: 'settings' },
      })
    }
  }
  return items
}
