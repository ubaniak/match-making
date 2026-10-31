import { supabase } from '../supabase'

// Talks to the real Supabase project. Row-level security does the protecting.
const eventColumns = `id, name, venue, start_date, end_date, status, poster_path,
  days:event_days(day, weigh_in_start, weigh_in_end, sessions:event_bout_sessions(starts_at, label)),
  members:event_members(user_id, role, user:profiles!event_members_user_id_fkey(id, name, email))`

const POSTERS = 'event-posters'
const hhmm = (time) => time?.slice(0, 5) ?? ''

// Postgres returns times as '09:00:00' and rows unordered.
function tidyDays(days) {
  return [...days]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((d) => ({
      day: d.day,
      weigh_in_start: hhmm(d.weigh_in_start),
      weigh_in_end: hhmm(d.weigh_in_end),
      sessions: [...(d.sessions ?? [])]
        .map((s) => ({ starts_at: hhmm(s.starts_at), label: s.label ?? '' }))
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    }))
}

const tidyEvent = (event) => ({ ...event, days: tidyDays(event.days) })

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

  // Everyone with an account, plus invites waiting for a first sign-in.
  async listUsers() {
    const [profiles, invites] = await Promise.all([
      supabase.from('profiles').select('id, email, name, status, role_id, roles(name)').order('name'),
      supabase.from('invites').select('email, name, role_id, roles(name)').order('name'),
    ])
    const failed = profiles.error || invites.error
    if (failed) throw failed
    return [
      ...profiles.data.map((p) => ({ ...p, role_name: p.roles?.name, state: p.status === 'active' ? 'Active' : 'Disabled' })),
      ...invites.data.map((i) => ({ ...i, role_name: i.roles?.name, id: null, state: 'Invited' })),
    ]
  },

  // Returns 'updated' if the person already had an account, otherwise 'invited'.
  async addUser({ name, email }) {
    const { data, error } = await supabase.rpc('invite_user', { p_email: email, p_name: name, p_role: 'user' })
    if (error) throw error
    return data
  },

  async listAthletes() {
    const { data, error } = await supabase
      .from('athletes')
      .select('id, name, date_of_birth, gender, weight_kg, bouts, club, invite_email, user_id, coach:profiles!athletes_coach_id_fkey(name, email)')
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
        event_athletes(added_by, athlete:athletes(id, name, date_of_birth, gender, weight_kg, bouts, club, coach_id, coach:profiles!athletes_coach_id_fkey(name, email)))`)
      .eq('id', eventId)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    const athletes = data.event_athletes.filter((ea) => ea.athlete).map((ea) => ({ ...ea.athlete, added_by: ea.added_by })).sort((a, b) => a.name.localeCompare(b.name))
    return { ...tidyEvent(data), athletes, athlete_count: athletes.length }
  },

  // Site Admins only. The event starts as Requested. Returns its id.
  async createEvent({ name, venue, startDate, endDate, ownerId }) {
    const { data, error } = await supabase.rpc('create_event', {
      p_name: name,
      p_venue: venue,
      p_start_date: startDate,
      p_end_date: endDate,
      p_owner_id: ownerId,
    })
    if (error) throw error
    return data
  },

  async updateEventDetails(eventId, { name, venue, startDate, endDate }) {
    const { data, error } = await supabase
      .from('events')
      .update({ name: name.trim(), venue: venue.trim() || null, start_date: startDate, end_date: endDate })
      .eq('id', eventId)
      .select('id')
    if (error) throw error
    if (!data.length) throw new Error('You can\'t edit this event')
  },

  // days: [{ day, weigh_in_start, weigh_in_end, sessions: [{ starts_at, label }] }], one per day with bouts.
  async saveEventTimes(eventId, days) {
    const { error } = await supabase.rpc('save_event_times', { p_event_id: eventId, p_days: days })
    if (error) throw error
  },

  // 'active' (approve), 'done' or 'cancelled'. Site Admins only.
  async setEventStatus(eventId, status) {
    const { error } = await supabase.rpc('set_event_status', { p_event_id: eventId, p_status: status })
    if (error) throw error
  },

  // Emails the Owner "You have Requested an event". Needs the send-event-email Edge Function.
  async emailEventOwner(eventId) {
    const { error } = await supabase.functions.invoke('send-event-email', { body: { event_id: eventId } })
    if (error) {
      let message = error.message
      try {
        message = (await error.context.json()).error || message
      } catch {
        // keep the generic message
      }
      throw new Error(message)
    }
  },

  posterUrl(path) {
    return path ? supabase.storage.from(POSTERS).getPublicUrl(path).data.publicUrl : null
  },

  async uploadPoster(eventId, file, oldPath) {
    const extension = (file.name.split('.').pop() || 'img').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `${eventId}/${Date.now()}.${extension}`
    const upload = await supabase.storage.from(POSTERS).upload(path, file, { contentType: file.type })
    if (upload.error) throw upload.error
    const { error } = await supabase.from('events').update({ poster_path: path }).eq('id', eventId)
    if (error) throw error
    if (oldPath) await supabase.storage.from(POSTERS).remove([oldPath])
  },

  async removePoster(eventId, path) {
    const { error } = await supabase.from('events').update({ poster_path: null }).eq('id', eventId)
    if (error) throw error
    if (path) await supabase.storage.from(POSTERS).remove([path])
  },

  // Upcoming Active events, for the public page. Works without signing in.
  async listPublicEvents() {
    const { data, error } = await supabase.rpc('list_public_events')
    if (error) throw error
    return data.map((e) => ({ ...e, days: tidyDays(e.days) }))
  },

  async deleteEvent(eventId) {
    const { error } = await supabase.from('events').delete().eq('id', eventId)
    if (error) throw error
  },

  // Add a Coach or Viewer, or change their role. Ownership moves only through transferEventOwnership.
  async setEventMember(eventId, userId, role) {
    const { error } = await supabase
      .from('event_members')
      .upsert({ event_id: eventId, user_id: userId, role }, { onConflict: 'event_id,user_id' })
    if (error) throw error
  },

  async removeEventMember(eventId, userId) {
    const { error } = await supabase.from('event_members').delete().eq('event_id', eventId).eq('user_id', userId)
    if (error) throw error
  },

  // Site Admins only. The old Owner stays on as a Viewer.
  async transferEventOwnership(eventId, userId) {
    const { error } = await supabase.rpc('transfer_event_ownership', { p_event_id: eventId, p_user_id: userId })
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
