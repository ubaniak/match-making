// Sends the app's event emails through Resend:
//   { event_id }       emails the Owner "You have Requested an event" with a link to the site.
//                      Called right after a site Admin creates an event.
//   { invitation_id }  emails an official their invitation to officiate. Called by the Owner or a
//                      site Admin right after inviting.
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
  try {
    const body = await req.json()
    eventId = body.event_id
    invitationId = body.invitation_id
  } catch {
    // handled below
  }
  if (!eventId && !invitationId) return json({ error: 'event_id or invitation_id is missing' }, 400)

  // Act as the caller, so row-level security decides what they can see.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })

  if (invitationId) return await sendInvitation(supabase, invitationId)

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

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

// The official's invitation. official_invitation_email returns nothing unless the caller is the
// event's Owner or a site Admin.
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
