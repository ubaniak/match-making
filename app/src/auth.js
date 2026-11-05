import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

// Loads the session plus the signed-in user's profile and permissions.
export function useAuth() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [permissions, setPermissions] = useState([])
  const [loading, setLoading] = useState(true)
  // View as (site Admins): whose eyes the app is seen through. The database runs every request as
  // them, so the whole app (profile, permissions, pages) follows this id.
  const [viewing, setViewing] = useState(() => api.viewingAs?.() ?? null)

  useEffect(() => {
    if (!api.viewingAs) return
    const onChange = () => setViewing(api.viewingAs())
    window.addEventListener('mm-view-as', onChange)
    return () => window.removeEventListener('mm-view-as', onChange)
  }, [])

  useEffect(() => {
    api.getSession().then((current) => {
      setSession(current)
      if (!current) setLoading(false)
    })
    return api.onAuthChange(setSession)
  }, [])

  const sessionUserId = session?.user.id

  // Check with the database on sign-in and whenever the tab comes back into view, in case View as
  // was started or ended in another tab or timed out.
  useEffect(() => {
    if (!sessionUserId || !api.checkViewAs) return
    const check = () => api.checkViewAs().then(setViewing)
    check()
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [sessionUserId])

  const userId = sessionUserId ? (viewing?.id ?? sessionUserId) : undefined

  useEffect(() => {
    if (!userId) {
      setProfile(null)
      setPermissions([])
      return
    }

    let cancelled = false
    setLoading(true)
    api.loadMe(userId).then((me) => {
      if (cancelled) return
      setProfile(me.profile)
      setPermissions(me.permissions)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  const can = useCallback((permission) => permissions.includes(permission), [permissions])

  return { session, profile, can, loading, viewing: sessionUserId ? viewing : null }
}

// Clubs only matter to people in a club and to event Owners (Bhavek, 2026-11-02: officials don't
// see clubs). There's no Official account type any more, so this goes by what they belong to.
export const seesClubs = (profile) => profile?.role_id === 'admin' || Boolean(profile?.in_club || profile?.owns_event)
