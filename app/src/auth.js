import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

// Loads the session plus the signed-in user's profile and permissions.
export function useAuth() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [permissions, setPermissions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getSession().then((current) => {
      setSession(current)
      if (!current) setLoading(false)
    })
    return api.onAuthChange(setSession)
  }, [])

  const userId = session?.user.id

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

  return { session, profile, can, loading }
}
