// In-app alerts and notifications (migration 22). The database writes a notification when
// someone is asked to approve something, asked whether they're available, or when something they
// are part of changes (a comment on a bout, an answer to their request). To-dos clear themselves
// once anyone deals with them.
//
// NotificationsProvider loads the signed-in user's notifications and keeps them fresh (Realtime,
// plus a refresh every minute and when the window gets focus). useNotifications() reads them.
// NotificationBell is the header bell; NotificationList is the list used in its drawer and on Home.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge as AntBadge, Button, Drawer, Popconfirm, Segmented, Space, Tooltip } from 'antd'
import { BellOutlined, CheckOutlined, DeleteOutlined, EyeInvisibleOutlined } from '@ant-design/icons'
import { api } from './api'
import { askConfirm } from './dialogs'
import { NotificationsContext, linkFor, useNotifications } from './notify'
import { Badge, ErrorAlert, Muted, Text } from './ui'

export function NotificationsProvider({ userId, children }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    try {
      setItems(await api.listNotifications())
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    if (!userId) return undefined
    setItems(null)
    reload()
    const stop = api.subscribeNotifications(userId, reload)
    const timer = setInterval(reload, 60_000)
    const onFocus = () => reload()
    window.addEventListener('focus', onFocus)
    return () => {
      stop()
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [userId, reload])

  // Changes show at once, then the server's copy replaces them.
  const change = useCallback(async (update, action) => {
    setItems((list) => (list ? update(list) : list))
    try {
      await action()
      setError(null)
    } catch (err) {
      setError(err.message)
    }
    reload()
  }, [reload])

  const value = useMemo(() => {
    const list = items ?? []
    const stamp = new Date().toISOString()
    return {
      items: list,
      loading: items === null,
      error,
      reload,
      unread: list.filter((n) => !n.read_at).length,
      todo: list.filter((n) => n.needs_action && !n.done_at),
      markRead: (ids) => change(
        (l) => l.map((n) => (!n.read_at && (!ids || ids.includes(n.id)) ? { ...n, read_at: stamp } : n)),
        () => api.markNotificationsRead(ids ?? null),
      ),
      markUnread: (id) => change((l) => l.map((n) => (n.id === id ? { ...n, read_at: null } : n)), () => api.markNotificationUnread(id)),
      remove: (ids) => change((l) => l.filter((n) => !ids.includes(n.id)), () => api.deleteNotifications(ids)),
    }
  }, [items, error, reload, change])

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

const actionLabels = {
  availability: 'Answer', bout_approval: 'Review bout', join_request: 'Answer', late_entry: 'Answer',
  transfer: 'Answer', member_request: 'Review',
}

function timeAgo(iso) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} d ago`
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(iso))
}

// The header bell: unread count, and a drawer with the list.
export function NotificationBell({ onOpen }) {
  const notes = useNotifications()
  const [open, setOpen] = useState(false)
  if (!notes) return null
  const label = notes.unread ? `Notifications, ${notes.unread} unread` : 'Notifications'

  return (
    <>
      <AntBadge count={notes.unread} overflowCount={99} size="small" color="#000" offset={[-4, 4]}>
        <Tooltip title="Notifications">
          <Button shape="circle" icon={<BellOutlined />} aria-label={label} onClick={() => setOpen(true)} />
        </Tooltip>
      </AntBadge>
      <Drawer
        title="Notifications"
        open={open}
        onClose={() => setOpen(false)}
        size="large"
        className="notification-drawer"
        destroyOnHidden
      >
        <NotificationList onOpen={(target) => { setOpen(false); onOpen(target) }} />
      </Drawer>
    </>
  )
}

// The full list with filters. `limit` shows only the first few (and no filters), for Home.
export function NotificationList({ onOpen, limit, filter: fixedFilter }) {
  const notes = useNotifications()
  const [filter, setFilter] = useState(fixedFilter ?? 'all')
  if (!notes) return null
  const { items, todo, unread, loading, error, markRead, markUnread, remove } = notes

  const lists = {
    todo,
    unread: items.filter((n) => !n.read_at),
    // Home's "New updates": unread, not counting open to-dos (they're listed above it).
    'unread-updates': items.filter((n) => !n.read_at && !(n.needs_action && !n.done_at)),
  }
  const shown = (lists[filter] ?? items).slice(0, limit ?? 200)
  const read = items.filter((n) => n.read_at && !(n.needs_action && !n.done_at))

  async function clearRead() {
    if (!(await askConfirm(`Delete ${read.length} read notification${read.length === 1 ? '' : 's'}? Open to-dos are kept.`, { okText: 'Delete', danger: true }))) return
    remove(read.map((n) => n.id))
  }

  function go(n) {
    if (!n.read_at) markRead([n.id])
    const target = linkFor(n)
    if (target) onOpen(target)
  }

  return (
    <>
      {!fixedFilter && (
        <div className="notification-tools">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'todo', label: `To do (${todo.length})` },
              { value: 'unread', label: `Unread (${unread})` },
            ]}
          />
          <Space wrap>
            <Button size="small" disabled={!unread} onClick={() => markRead(null)}>Mark all read</Button>
            <Button size="small" disabled={!read.length} onClick={clearRead}>Delete read</Button>
          </Space>
        </div>
      )}
      <ErrorAlert>{error}</ErrorAlert>
      {loading ? <Muted>Loading…</Muted> : shown.length === 0 ? (
        <Muted>
          {filter === 'todo' ? 'Nothing needs you right now.' : filter === 'unread' ? 'You\'re all caught up.' : 'No notifications yet.'}
        </Muted>
      ) : (
        <ul className="notification-list">
          {shown.map((n) => {
            const target = linkFor(n)
            const open = n.needs_action && !n.done_at
            return (
              <li key={n.id} className={n.read_at ? 'read' : 'unread'}>
                <div className="notification-text">
                  <Text strong={!n.read_at}>{n.title}</Text>
                  {n.body && <Text type="secondary" className="notification-body">{n.body}</Text>}
                  <span className="notification-meta">
                    {open && <Badge strong>To do</Badge>}
                    {n.needs_action && n.done_at && <Badge muted>Done</Badge>}
                    <Text type="secondary">{timeAgo(n.created_at)}</Text>
                  </span>
                </div>
                <Space size={4} className="notification-actions">
                  {target && (
                    <Button size="small" type={open ? 'primary' : 'default'} onClick={() => go(n)}>
                      {open ? actionLabels[n.kind] ?? 'Open' : 'Open'}
                    </Button>
                  )}
                  {n.read_at ? (
                    <Tooltip title="Mark unread">
                      <Button size="small" shape="circle" icon={<EyeInvisibleOutlined />} aria-label="Mark unread" onClick={() => markUnread(n.id)} />
                    </Tooltip>
                  ) : (
                    <Tooltip title="Mark read">
                      <Button size="small" shape="circle" icon={<CheckOutlined />} aria-label="Mark read" onClick={() => markRead([n.id])} />
                    </Tooltip>
                  )}
                  <Popconfirm
                    title={open ? 'Delete this to-do? It stays undone.' : 'Delete this notification?'}
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => remove([n.id])}
                  >
                    <Button size="small" shape="circle" icon={<DeleteOutlined />} aria-label="Delete notification" />
                  </Popconfirm>
                </Space>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
