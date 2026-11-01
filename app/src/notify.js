import { createContext, useContext } from 'react'

// Shared by Notifications.jsx (the provider, bell and list) and anything that reads notifications.
export const NotificationsContext = createContext(null)

// { items, todo, unread, loading, error, reload, markRead(ids|null), markUnread(id), remove(ids) }
export function useNotifications() {
  return useContext(NotificationsContext)
}

// Where a notification leads: an event (and tab) or a club. Null when there's nowhere to go.
export function linkFor(n) {
  if (n.event_id) return { page: 'events', eventId: n.event_id, tab: n.tab ?? undefined }
  if (n.club_id) return { page: 'clubs', clubId: n.club_id }
  return null
}
