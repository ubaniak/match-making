import { supabase } from '../supabase'

// Talks to the real Supabase project. Row-level security does the protecting.
export const supabaseApi = {
  mode: 'supabase',

  async getSession() {
    const { data } = await supabase.auth.getSession()
    return data.session
  },

  onAuthChange(callback) {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session))
    return () => data.subscription.unsubscribe()
  },

  signOut() {
    return supabase.auth.signOut()
  },

  async sendMagicLink(email) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      // Come back to whatever URL the app is served from (local dev or GitHub Pages).
      options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    })
    if (error) throw error
  },

  async loadMe(userId) {
    const [profileResult, permissionsResult] = await Promise.all([
      supabase.from('profiles').select('id, email, name, role_id, status, roles(name)').eq('id', userId).maybeSingle(),
      supabase.rpc('my_permissions'),
    ])
    return {
      profile: profileResult.data,
      permissions: (permissionsResult.data ?? []).map((row) => row.permission),
    }
  },

  // Coaches who have signed in, plus invites waiting for a first sign-in.
  async listCoaches() {
    const [profiles, invites] = await Promise.all([
      supabase.from('profiles').select('id, email, name, status').eq('role_id', 'coach').order('name'),
      supabase.from('invites').select('email, name').eq('role_id', 'coach').order('name'),
    ])
    const failed = profiles.error || invites.error
    if (failed) throw failed
    return [
      ...profiles.data.map((p) => ({ ...p, state: p.status === 'active' ? 'Active' : 'Disabled' })),
      ...invites.data.map((i) => ({ ...i, id: null, state: 'Invited' })),
    ]
  },

  // Returns 'updated' if the person already had an account, otherwise 'invited'.
  async addCoach({ name, email }) {
    const { data, error } = await supabase.rpc('invite_user', { p_email: email, p_name: name, p_role: 'coach' })
    if (error) throw error
    return data
  },

  async listAthletes() {
    const { data, error } = await supabase
      .from('athletes')
      .select('id, name, date_of_birth, weight_class, club, invite_email, user_id, coach:profiles!athletes_coach_id_fkey(name, email)')
      .order('name')
    if (error) throw error
    return data
  },

  async addAthlete(athlete) {
    const { error } = await supabase.from('athletes').insert(athlete)
    if (error) throw error
  },
}
