import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

// Loads the Supabase session plus the signed-in user's profile and permissions.
export function useAuth() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [permissions, setPermissions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => data.subscription.unsubscribe()
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
    Promise.all([
      supabase.from('profiles').select('id, email, name, role_id, status, roles(name)').eq('id', userId).maybeSingle(),
      supabase.rpc('my_permissions'),
    ]).then(([profileResult, permissionsResult]) => {
      if (cancelled) return
      setProfile(profileResult.data)
      setPermissions((permissionsResult.data ?? []).map((row) => row.permission))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  const can = useCallback((permission) => permissions.includes(permission), [permissions])

  return { session, profile, can, loading }
}
