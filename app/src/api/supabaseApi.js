import { supabase } from '../supabase'

// Talks to the real Supabase project. Row-level security does the protecting.
const eventColumns = `id, name, venue, start_date, end_date, owner_id,
  owner:profiles!events_owner_id_fkey(id, name, email),
  days:event_days(day, weigh_in_time, bouts_time)`

// Postgres returns times as '09:00:00' and days unordered.
function tidyEvent(event) {
  return {
    ...event,
    days: [...event.days]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => ({ ...d, weigh_in_time: d.weigh_in_time.slice(0, 5), bouts_time: d.bouts_time.slice(0, 5) })),
  }
}

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

  async listOfficials() {
    const { data, error } = await supabase
      .from('officials')
      .select('id, name, qualifications, invite_email, user_id')
      .order('name')
    if (error) throw error
    return data
  },

  async addOfficial(official) {
    const { error } = await supabase.from('officials').insert(official)
    if (error) throw error
  },

  async listEvents() {
    const { data, error } = await supabase
      .from('events')
      .select(`${eventColumns}, event_athletes(count)`)
      .order('start_date')
    if (error) throw error
    return data.map((e) => ({ ...tidyEvent(e), athlete_count: e.event_athletes[0]?.count ?? 0 }))
  },

  async getEvent(eventId) {
    const { data, error } = await supabase
      .from('events')
      .select(`${eventColumns},
        event_athletes(athlete:athletes(id, name, weight_class, club, coach_id, coach:profiles!athletes_coach_id_fkey(name, email)))`)
      .eq('id', eventId)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    const athletes = data.event_athletes.map((ea) => ea.athlete).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name))
    return { ...tidyEvent(data), athletes, athlete_count: athletes.length }
  },

  // Creates the event when there's no id. Returns the event's id.
  async saveEvent({ id, name, venue, startDate, endDate, ownerId, days }) {
    const { data, error } = await supabase.rpc('save_event', {
      p_id: id ?? null,
      p_name: name,
      p_venue: venue,
      p_start_date: startDate,
      p_end_date: endDate,
      p_owner_id: ownerId,
      p_days: days,
    })
    if (error) throw error
    return data
  },

  async deleteEvent(eventId) {
    const { error } = await supabase.from('events').delete().eq('id', eventId)
    if (error) throw error
  },

  async addEventAthlete(eventId, athleteId) {
    const { error } = await supabase.from('event_athletes').insert({ event_id: eventId, athlete_id: athleteId })
    if (error && error.code !== '23505') throw error // already entered is fine
  },

  async removeEventAthlete(eventId, athleteId) {
    const { error } = await supabase.from('event_athletes').delete().eq('event_id', eventId).eq('athlete_id', athleteId)
    if (error) throw error
  },
}
