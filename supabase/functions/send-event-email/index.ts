// Sends the app's event emails through Resend:
//   { event_id }       emails the Owner "You have Requested an event" with a link to the site.
//                      Called right after a site Admin creates an event.
//   { invitation_id }  emails an official their invitation to officiate. Called by a site Admin or
//                      the Chief Official right after inviting.
//   { bout_ids }       "Send for approval": emails everyone who still has to approve those bouts
//                      (each corner's club Owners, the Chief Official and Deputy), one email per
//                      person listing all their bouts. Called by the Owner, an official or a site Admin.
//   { user_email }     welcomes someone a site Admin just added on Admin > Users: says which account
//                      they have and how to sign in. Site Admins only.
// Sends through Resend
// (https://resend.com). Setup steps are in app/README.md ("Owner emails").
//
// Secrets (Edge Functions > Secrets in the Supabase dashboard):
//   RESEND_API_KEY  required
//   EMAIL_FROM      e.g. "Match Making <events@your-domain>" (default: Resend's test sender)
//   SITE_URL        default https://ubaniak.github.io/match-making/
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  let eventId: string | undefined
  let invitationId: string | undefined
  let boutIds: string[] | undefined
  let userEmail: string | undefined
  try {
    const body = await req.json()
    eventId = body.event_id
    invitationId = body.invitation_id
    boutIds = Array.isArray(body.bout_ids) ? body.bout_ids : undefined
    userEmail = typeof body.user_email === 'string' ? body.user_email.trim().toLowerCase() : undefined
  } catch {
    // handled below
  }
  if (!eventId && !invitationId && !boutIds?.length && !userEmail) {
    return json({ error: 'event_id, invitation_id, bout_ids or user_email is missing' }, 400)
  }

  // Act as the caller, so row-level security decides what they can see.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })

  if (invitationId) return await sendInvitation(supabase, invitationId)
  if (boutIds?.length) return await sendBoutApprovals(supabase, boutIds)
  if (userEmail) return await sendWelcome(supabase, userEmail)

  const { data: isAdmin, error: adminError } = await supabase.rpc('is_site_admin')
  if (adminError || !isAdmin) return json({ error: 'Only a site Admin can send this email' }, 403)

  const { data: event, error } = await supabase
    .from('events')
    .select('name, start_date, end_date, members:event_members(role, user:profiles!event_members_user_id_fkey(name, email))')
    .eq('id', eventId)
    .maybeSingle()
  if (error) return json({ error: error.message }, 500)
  if (!event) return json({ error: 'That event no longer exists' }, 404)

  // deno-lint-ignore no-explicit-any
  const owner = (event.members as any[]).find((m) => m.role === 'owner')?.user
  if (!owner?.email) return json({ error: 'The event has no Owner with an email address' }, 422)

  const site = Deno.env.get('SITE_URL') ?? 'https://ubaniak.github.io/match-making/'
  const dates = event.start_date === event.end_date ? event.start_date : `${event.start_date} to ${event.end_date}`
  const greeting = owner.name ? `Hi ${owner.name},` : 'Hi,'
  const text = [
    greeting,
    '',
    `You have Requested an event: ${event.name} (${dates}).`,
    '',
    `Sign in to add a poster and the weigh-in and bout times: ${site}`,
  ].join('\n')
  const html = `<p>${escape(greeting)}</p>
<p>You have Requested an event: <strong>${escape(event.name)}</strong> (${escape(dates)}).</p>
<p><a href="${escape(site)}">Sign in</a> to add a poster and the weigh-in and bout times.</p>`

  return await send(owner.email, 'You have Requested an event', text, html)
})

async function send(to: string, subject: string, text: string, html: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return json({ error: 'email is not set up yet' }, 501)
  const from = Deno.env.get('EMAIL_FROM') ?? 'Match Making <onboarding@resend.dev>'
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  })
  if (!response.ok) {
    const detail = await response.text()
    return json({ error: `the email service said: ${detail.slice(0, 200)}` }, 502)
  }
  return json({ sent: true })
}

// "You've been added". Only site Admins can read every profile and invite, so a missing row also
// means the caller isn't allowed.
// deno-lint-ignore no-explicit-any
async function sendWelcome(supabase: any, email: string) {
  const { data: isAdmin, error: adminError } = await supabase.rpc('is_site_admin')
  if (adminError || !isAdmin) return json({ error: 'Only a site Admin can send this email' }, 403)

  const [profile, invite] = await Promise.all([
    supabase.from('profiles').select('name, roles(name)').eq('email', email).maybeSingle(),
    supabase.from('invites').select('name, roles(name)').eq('email', email).maybeSingle(),
  ])
  const person = profile.data ?? invite.data
  if (!person) return json({ error: 'There is no user with that email' }, 404)

  const site = Deno.env.get('SITE_URL') ?? 'https://ubaniak.github.io/match-making/'
  const account = accountPhrase(person.roles?.name)
  const greeting = person.name ? `Hi ${person.name},` : 'Hi,'
  const text = [
    greeting,
    '',
    `You've been added to Match Making as ${account}.`,
    '',
    `To sign in, open ${site} and enter this email address (${email}). We'll email you a 6-digit code to type in. There's no password.`,
  ].join('\n')
  const html = `<p>${escape(greeting)}</p>
<p>You've been added to Match Making as ${escape(account)}.</p>
<p>To sign in, open <a href="${escape(site)}">${escape(site)}</a> and enter this email address (${escape(email)}). We'll email you a 6-digit code to type in. There's no password.</p>`
  return await send(email, 'You\'ve been added to Match Making', text, html)
}

// roles.name is plural ("Admins", "Officials"); the email says "an Admin", "an Official".
function accountPhrase(roleName?: string) {
  const singular = (roleName ?? 'Users').replace(/s$/, '')
  if (singular === 'Public') return 'a Public account (an Admin will give you access)'
  return `${/^[AEIOU]/.test(singular) ? 'an' : 'a'} ${singular}`
}

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

// The official's invitation. official_invitation_email returns nothing unless the caller is the
// event's Chief Official or a site Admin.
// deno-lint-ignore no-explicit-any
async function sendInvitation(supabase: any, invitationId: string) {
  const { data, error } = await supabase.rpc('official_invitation_email', { p_invitation_id: invitationId })
  if (error) return json({ error: error.message }, 500)
  const invite = data?.[0]
  if (!invite) return json({ error: 'Only the event\'s Owner or a site Admin can send this email' }, 403)
  if (!invite.email) return json({ error: 'The official has no email address' }, 422)

  const site = Deno.env.get('SITE_URL') ?? 'https://ubaniak.github.io/match-making/'
  const dates = invite.start_date === invite.end_date
    ? longDate(invite.start_date)
    : `${longDate(invite.start_date)} to ${longDate(invite.end_date)}`
  const where = invite.venue ? `, ${invite.venue}` : ''
  const greeting = invite.official_name ? `Hi ${invite.official_name},` : 'Hi,'
  const ask = invite.respond_by ? `Please accept or decline by ${longDate(invite.respond_by)}.` : 'Please accept or decline.'
  const text = [
    greeting,
    '',
    `You're invited to officiate at ${invite.event_name} (${dates}${where}).`,
    ask,
    '',
    `Sign in with this email address and open Events: ${site}`,
  ].join('\n')
  const html = `<p>${escape(greeting)}</p>
<p>You're invited to officiate at <strong>${escape(invite.event_name)}</strong> (${escape(dates + where)}).</p>
<p>${escape(ask)}</p>
<p><a href="${escape(site)}">Sign in</a> with this email address and open Events.</p>`
  return await send(invite.email, `Officiating at ${invite.event_name}`, text, html)
}

// "Send for approval". request_bout_approvals checks the caller may send these bouts, marks them
// sent and returns one row per bout, waiting side and person.
// deno-lint-ignore no-explicit-any
async function sendBoutApprovals(supabase: any, boutIds: string[]) {
  const { data, error } = await supabase.rpc('request_bout_approvals', { p_bout_ids: boutIds })
  if (error) return json({ error: error.message }, error.code === '42501' ? 403 : 500)
  // deno-lint-ignore no-explicit-any
  const rows = (data ?? []) as any[]
  if (rows.length === 0) return json({ sent: 0 })

  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return json({ error: 'email is not set up yet' }, 501)
  const from = Deno.env.get('EMAIL_FROM') ?? 'Match Making <onboarding@resend.dev>'
  const site = Deno.env.get('SITE_URL') ?? 'https://ubaniak.github.io/match-making/'
  const sideText: Record<string, string> = { red: 'red corner', blue: 'blue corner', official: 'official approval' }

  // One email per person, listing each of their bouts once with the sides they approve for.
  const people = new Map<string, { name: string | null; event: string; bouts: Map<string, { line: string; sides: string[] }> }>()
  for (const r of rows) {
    const person = people.get(r.recipient_email) ?? { name: r.recipient_name, event: r.event_name, bouts: new Map() }
    people.set(r.recipient_email, person)
    const red = r.red_club ? `${r.red_name} (${r.red_club})` : r.red_name
    const blue = r.blue_club ? `${r.blue_name} (${r.blue_club})` : r.blue_name
    const bout = person.bouts.get(r.bout_id) ?? { line: `${longDate(r.day)}, bout ${r.bout_number}: ${red} vs ${blue}`, sides: [] }
    bout.sides.push(sideText[r.side] ?? r.side)
    person.bouts.set(r.bout_id, bout)
  }

  const emails = [...people.entries()].map(([to, p]) => {
    const greeting = p.name ? `Hi ${p.name},` : 'Hi,'
    const lines = [...p.bouts.values()].map((b) => `${b.line} — ${b.sides.join(', ')}`)
    const count = lines.length === 1 ? 'a bout' : `${lines.length} bouts`
    const intro = `Please approve or reject ${count} at ${p.event}:`
    const text = [greeting, '', intro, '', ...lines.map((l) => `- ${l}`), '', `Sign in and open the event's Bouts tab: ${site}`].join('\n')
    const html = `<p>${escape(greeting)}</p>
<p>${escape(intro)}</p>
<ul>${lines.map((l) => `<li>${escape(l)}</li>`).join('')}</ul>
<p><a href="${escape(site)}">Sign in</a> and open the event's Bouts tab.</p>`
    return { from, to: [to], subject: `Bouts to approve at ${p.event}`, text, html }
  })

  // Resend's batch endpoint takes up to 100 emails a call.
  for (let i = 0; i < emails.length; i += 100) {
    const response = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(emails.slice(i, i + 100)),
    })
    if (!response.ok) {
      const detail = await response.text()
      return json({ error: `the email service said: ${detail.slice(0, 200)}`, sent: i }, 502)
    }
  }
  return json({ sent: emails.length })
}
