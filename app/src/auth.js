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

// Accounts with the Official or Chief Official role. Officials don't see clubs (Bhavek, 2026-11-02).
export const isOfficial = (profile) => profile?.role_id === 'official' || profile?.role_id === 'chief_official'

// Chief Officials approve or deny requested events, and can't create events (Bhavek, 2026-11-03).
export const isChiefOfficial = (profile) => profile?.role_id === 'chief_official'

// Account roles that also belong on the Officials list.
export const officialRoles = ['official', 'chief_official']
