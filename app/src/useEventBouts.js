// The event's officials, bouts and weigh-ins, loaded once and shared by the event page's tabs.
import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

// Loads the event's officials, bouts and weigh-ins once, for the Bouts, Officials and
// Dashboard tabs. run(action) does an action and reloads.
export function useEventBouts({ event, may, clubs, profile, onEntriesChange }) {
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

  if (!data) return { data, error, busy, run, rights: null, seesBouts: false }

  const officialRole = data.officials.find((o) => o.user_id === profile?.id)?.role ?? null
  const ownedClubs = new Set(clubs.filter((c) => c.members.some((m) => m.user_id === profile?.id && m.role === 'owner' && m.status === 'active')).map((c) => c.id))
  const rights = {
    siteAdmin: may.siteAdmin,
    owner: may.siteAdmin || may.role === 'owner',
    official: may.siteAdmin || Boolean(officialRole),
    // The CO and Deputy record every day's weigh-in; other officials only on the days they accepted.
    weighInDays: data.acceptedDays ?? [],
    officialRole,
    ownedClubs,
    cardOpen: event.status === 'active',
  }
  const seesBouts = ['active', 'done'].includes(event.status)
    && (rights.owner || rights.official || rights.weighInDays.length > 0 || event.athletes.length > 0)
  return { data, error, busy, run, rights, seesBouts }
}
