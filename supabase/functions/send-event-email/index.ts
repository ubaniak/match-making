// Sends the app's emails:
//   { event_id }       emails the Owner "You have Requested an event" with a link to the site.
//                      Called right after a site Admin creates an event.
//   { invitation_id, notes? }
//                      emails an official their invitation to officiate, with the event's dates,
//                      weigh-in and bout times and the inviter's optional notes. Called by a site
//                      Admin or an official on the event right after inviting.
//   { event_id, club_id, notes? }
//                      emails a club's Owners that the club is in the event, with the same details.
//                      Called by the event's Owner or a site Admin right after inviting the club.
//   { bout_ids }       "Send for approval": emails everyone who still has to approve those bouts
//                      (each corner's club Owners, the Chief Official and Deputy), one email per
//                      person listing all their bouts. Called by the Owner, an official or a site Admin.
//   { user_email }     welcomes someone just added on Admin > Users, or a new official added to an
//                      event: says which account they have and how to sign in.
// Every email uses the site's Navy & Gold look (layout() below), with large text and high contrast.
// Sends through Gmail (or any SMTP server) when SMTP_USER and SMTP_PASS are set, otherwise
// through Resend (https://resend.com). Setup steps are in app/README.md ("Owner emails").
//
// Secrets (Edge Functions > Secrets in the Supabase dashboard):
//   SMTP_USER       the Gmail address, e.g. matchmaking.app@gmail.com
//   SMTP_PASS       a Google App password for that account (16 letters, no spaces)
//   SMTP_HOST       default smtp.gmail.com
//   SMTP_PORT       default 465 (Supabase blocks outgoing 25 and 587)
//   RESEND_API_KEY  used only when SMTP_USER/SMTP_PASS aren't set
//   EMAIL_FROM      default "Match Making <SMTP_USER>" (Gmail only sends as its own address)
//   SITE_URL        default https://ubaniak.github.io/match-making/
import { createClient } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6.9.16'

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
  let clubId: string | undefined
  let notes = ''
  try {
    const body = await req.json()
    eventId = body.event_id
    invitationId = body.invitation_id
    boutIds = Array.isArray(body.bout_ids) ? body.bout_ids : undefined
    userEmail = typeof body.user_email === 'string' ? body.user_email.trim().toLowerCase() : undefined
    clubId = typeof body.club_id === 'string' ? body.club_id : undefined
    notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) : ''
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

  if (invitationId) return await sendInvitation(supabase, invitationId, notes)
  if (eventId && clubId) return await sendClubInvitation(supabase, eventId, clubId, notes)
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

  const site = appUrl()
  const dates = dateRange(event.start_date, event.end_date)
  const greeting = owner.name ? `Hi ${owner.name},` : 'Hi,'
  const text = [
    greeting,
    '',
    `You have Requested an event: ${event.name} (${dates}).`,
    '',
    `Sign in to add a poster and the weigh-in and bout times: ${site}`,
  ].join('\n')
  const html = layout({
    preview: `You have Requested an event: ${event.name}`,
    heading: 'You have Requested an event',
    body: `${para(escape(greeting))}
${para(`You have Requested an event: <strong>${escape(event.name)}</strong> (${escape(dates)}).`)}
${para('Sign in to add a poster and the weigh-in and bout times.')}`,
    button: { label: 'Sign in to Match Making', href: site },
  })
  return await send(owner.email, 'You have Requested an event', text, html)
})

async function send(to: string, subject: string, text: string, html: string) {
  const result = await deliver([{ to, subject, text, html }])
  if (result.error) return json({ error: result.error }, result.status)
  return json({ sent: true })
}

// "You've been added". Only site Admins can read every profile and invite, so a missing row also
// means the caller isn't allowed.
// deno-lint-ignore no-explicit-any
async function sendWelcome(supabase: any, email: string) {
  // welcome_email_details returns nothing unless the caller is a site Admin, or an official who
  // just invited this person to an event (migration 24).
  const { data, error } = await supabase.rpc('welcome_email_details', { p_email: email })
  if (error) return json({ error: error.message }, 400)
  const person = data?.[0]
  if (!person) return json({ error: 'There is no user with that email you can welcome' }, 404)

  const site = appUrl()
  const account = accountPhrase(person.role_name)
  const greeting = person.name ? `Hi ${person.name},` : 'Hi,'
  const text = [
    greeting,
    '',
    `You've been added to Match Making as ${account}.`,
    '',
    `To sign in, open ${site} and enter this email address (${email}). We'll email you a 6-digit code to type in. There's no password.`,
  ].join('\n')
  const html = layout({
    preview: `You've been added to Match Making as ${account}`,
    heading: 'Welcome to Match Making',
    body: `${para(escape(greeting))}
${para(`You've been added to Match Making as <strong>${escape(account)}</strong>.`)}
${para(`To sign in, open the site and enter this email address (<strong>${escape(email)}</strong>). We'll email you a 6-digit code to type in. There's no password.`)}`,
    button: { label: 'Open Match Making', href: site },
  })
  return await send(email, 'You\'ve been added to Match Making', text, html)
}

// roles.name is plural ("Admins", "Officials"); the email says "an Admin", "an Official".
function accountPhrase(roleName?: string) {
  const singular = (roleName ?? 'Users').replace(/s$/, '')
  if (singular === 'Public') return 'a Public account (an Admin will give you access)'
  return `${/^[AEIOU]/.test(singular) ? 'an' : 'a'} ${singular}`
}

type Email = { to: string; subject: string; text: string; html: string }
type Delivery = { sent: number; error?: string; status?: number }

// Sends each email on its own (one recipient per email). Stops at the first failure and says how
// many went out before it.
async function deliver(emails: Email[]): Promise<Delivery> {
  const user = Deno.env.get('SMTP_USER')
  const pass = Deno.env.get('SMTP_PASS')
  if (user && pass) return await deliverSmtp(emails, user, pass.replace(/\s+/g, ''))
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (apiKey) return await deliverResend(emails, apiKey)
  return { sent: 0, error: 'email is not set up yet', status: 501 }
}

async function deliverSmtp(emails: Email[], user: string, pass: string): Promise<Delivery> {
  const port = Number(Deno.env.get('SMTP_PORT') ?? 465)
  const transport = nodemailer.createTransport({
    host: Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user, pass },
  })
  const from = Deno.env.get('EMAIL_FROM') ?? `Match Making <${user}>`
  let sent = 0
  try {
    for (const e of emails) {
      await transport.sendMail({ from, to: e.to, subject: e.subject, text: e.text, html: e.html })
      sent++
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { sent, error: `the email server said: ${detail.slice(0, 200)}`, status: 502 }
  } finally {
    transport.close()
  }
  return { sent }
}

async function deliverResend(emails: Email[], apiKey: string): Promise<Delivery> {
  const from = Deno.env.get('EMAIL_FROM') ?? 'Match Making <onboarding@resend.dev>'
  // Resend's batch endpoint takes up to 100 emails a call.
  for (let i = 0; i < emails.length; i += 100) {
    const batch = emails.slice(i, i + 100).map((e) => ({ from, to: [e.to], subject: e.subject, text: e.text, html: e.html }))
    const response = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    })
    if (!response.ok) {
      const detail = await response.text()
      return { sent: i, error: `the email service said: ${detail.slice(0, 200)}`, status: 502 }
    }
  }
  return { sent: emails.length }
}

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

// The official's invitation. official_invitation_email returns nothing unless the caller is a site
// Admin or an official on the event. Its timezone and schedule columns arrive with migration 32;
// before that the email just leaves the times out.
// deno-lint-ignore no-explicit-any
async function sendInvitation(supabase: any, invitationId: string, notes: string) {
  const { data, error } = await supabase.rpc('official_invitation_email', { p_invitation_id: invitationId })
  if (error) return json({ error: error.message }, 500)
  const invite = data?.[0]
  if (!invite) return json({ error: 'Only a site Admin or an official on the event can send this email' }, 403)
  if (!invite.email) return json({ error: 'The official has no email address' }, 422)

  const site = appUrl()
  const greeting = invite.official_name ? `Hi ${invite.official_name},` : 'Hi,'
  const ask = invite.respond_by ? `Please accept or decline by ${longDate(invite.respond_by)}.` : 'Please accept or decline.'
  const details = eventDetails(invite)
  const text = [
    greeting,
    '',
    `You're invited to officiate at ${invite.event_name}.`,
    ask,
    '',
    ...details.text,
    ...notesText(notes),
    '',
    `Sign in with this email address and open Events: ${site}`,
  ].join('\n')
  const html = layout({
    preview: `You're invited to officiate at ${invite.event_name}`,
    heading: "You're invited to officiate",
    body: `${para(escape(greeting))}
${para(`You're invited to officiate at <strong>${escape(invite.event_name)}</strong>. ${escape(ask)}`)}
${details.html}
${notesHtml(notes)}
${para('Sign in with this email address and open Events to accept or decline. On a multi-day event you can pick the days you can work.')}`,
    button: { label: 'Accept or decline', href: site },
  })
  return await send(invite.email, `Officiating at ${invite.event_name}`, text, html)
}

// A club invited to an event (it's in straight away). club_invitation_email (migration 32) returns
// one row per active club Owner, and nothing unless the caller is the event's Owner or a site Admin.
// deno-lint-ignore no-explicit-any
async function sendClubInvitation(supabase: any, eventId: string, clubId: string, notes: string) {
  const { data, error } = await supabase.rpc('club_invitation_email', { p_event_id: eventId, p_club_id: clubId })
  if (error) return json({ error: error.message }, 500)
  // deno-lint-ignore no-explicit-any
  const owners = (data ?? []) as any[]
  if (owners.length === 0) return json({ error: 'The club has no Owner with an email address, or only the event\'s Owner or a site Admin can send this email' }, 422)

  const site = appUrl()
  const first = owners[0]
  const details = eventDetails(first)
  const emails = owners.map((o) => {
    const greeting = o.owner_name ? `Hi ${o.owner_name},` : 'Hi,'
    const intro = `${o.club_name} is invited to ${o.event_name} and is in. You can enter your athletes now.`
    const text = [
      greeting,
      '',
      intro,
      '',
      ...details.text,
      ...notesText(notes),
      '',
      `Sign in, open Events and choose ${o.event_name} to enter athletes: ${site}`,
    ].join('\n')
    const html = layout({
      preview: `${o.club_name} is invited to ${o.event_name}`,
      heading: 'Your club is invited',
      body: `${para(escape(greeting))}
${para(`<strong>${escape(o.club_name)}</strong> is invited to <strong>${escape(o.event_name)}</strong> and is in. You can enter your athletes now.`)}
${details.html}
${notesHtml(notes)}
${para(`Sign in, open Events and choose ${escape(o.event_name)} to enter your athletes.`)}`,
      button: { label: 'Enter your athletes', href: site },
    })
    return { to: o.email, subject: `${o.club_name} is invited to ${o.event_name}`, text, html }
  })
  const result = await deliver(emails)
  if (result.error) return json({ error: result.error, sent: result.sent }, result.status)
  return json({ sent: result.sent })
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

  const site = appUrl()
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
    const html = layout({
      preview: intro,
      heading: 'Bouts to approve',
      body: `${para(escape(greeting))}
${para(escape(intro))}
<ul style="margin: 0 0 20px; padding-left: 24px; font-size: 18px; line-height: 1.6; color: ${C.text};">${lines.map((l) => `<li style="margin: 0 0 10px;">${escape(l)}</li>`).join('')}</ul>
${para('Sign in and open the event\'s Bouts tab.')}`,
      button: { label: 'Open the Bouts tab', href: site },
    })
    return { to, subject: `Bouts to approve at ${p.event}`, text, html }
  })

  const result = await deliver(emails)
  if (result.error) return json({ error: result.error, sent: result.sent }, result.status)
  return json({ sent: result.sent })
}

// The site root is the public events page, so emailed "Sign in" links go to #home (sign-in, then the dashboard).
function appUrl() {
  const root = Deno.env.get('SITE_URL') ?? 'https://ubaniak.github.io/match-making/'
  return root.replace(/#.*$/, '').replace(/\/?$/, '/') + '#home'
}

// ---------------------------------------------------------------------------
// The look: the site's Navy & Gold scheme (app/src/theme.js), sized for older readers: 18px body
// text, a 52px tall button, and every text colour at least 7:1 on its background. Email apps ignore
// <style> blocks and web fonts, so everything is inline styles in tables.
// ---------------------------------------------------------------------------

const C = {
  navy: '#1e3a8a',
  navyDeep: '#14245a',
  gold: '#f5b800',
  goldSoft: '#fde68a',
  page: '#f3f5fa',
  subtle: '#eef1f8',
  border: '#dde1e7',
  text: '#111111',
  muted: '#333333',
}
const FONT = "Roboto, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"

const para = (html: string) => `<p style="margin: 0 0 20px; font-size: 18px; line-height: 1.6; color: ${C.text};">${html}</p>`

function layout({ preview, heading, body, button }: { preview: string; heading: string; body: string; button?: { label: string; href: string } }) {
  const action = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 8px 0 24px;"><tr>
  <td style="border-radius: 12px; background: ${C.navy};">
    <a href="${escape(button.href)}" style="display: inline-block; padding: 16px 32px; font-family: ${FONT}; font-size: 19px; font-weight: 700; line-height: 20px; color: #ffffff; text-decoration: none; border-radius: 12px; border: 2px solid ${C.navyDeep};">${escape(button.label)}</a>
  </td>
</tr></table>
<p style="margin: 0 0 8px; font-size: 15px; line-height: 1.5; color: ${C.muted};">If the button doesn't work, copy this address into your browser:<br><a href="${escape(button.href)}" style="color: ${C.navy}; word-break: break-all;">${escape(button.href)}</a></p>`
    : ''
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><title>${escape(heading)}</title></head>
<body style="margin: 0; padding: 0; background: ${C.page};">
<div style="display: none; max-height: 0; overflow: hidden;">${escape(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: ${C.page};">
<tr><td align="center" style="padding: 24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; background: #ffffff; border-radius: 18px; overflow: hidden; border: 1px solid ${C.border}; font-family: ${FONT};">
    <tr><td style="background: ${C.navy}; border-bottom: 5px solid ${C.gold}; padding: 22px 28px;">
      <span style="font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: 0.3px;">&#129354; Match Making</span>
    </td></tr>
    <tr><td style="padding: 28px 28px 12px;">
      <h1 style="margin: 0 0 20px; font-size: 26px; line-height: 1.3; font-weight: 700; color: ${C.navyDeep};">${escape(heading)}</h1>
      ${body}
      ${action}
    </td></tr>
    <tr><td style="background: ${C.subtle}; border-top: 1px solid ${C.border}; padding: 16px 28px;">
      <p style="margin: 0; font-size: 15px; line-height: 1.5; color: ${C.muted};">Sent by Match Making. Reply to this email if something looks wrong.</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`
}

const dateRange = (start: string, end: string) => (start === end ? longDate(start) : `${longDate(start)} to ${longDate(end)}`)

// '14:30' -> '2:30 PM'
function clock(hhmm?: string | null) {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

// "Central Standard Time (America/Winnipeg)", for the event's first day so daylight saving is right.
function zoneName(timezone: string | null | undefined, day: string) {
  if (!timezone) return null
  try {
    const part = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, timeZoneName: 'long' })
      .formatToParts(new Date(`${day}T18:00:00Z`))
      .find((p) => p.type === 'timeZoneName')?.value
    return part ? `${part} (${timezone})` : timezone
  } catch {
    return timezone
  }
}

type ScheduleDay = { day: string; weigh_in_start: string | null; weigh_in_end: string | null; sessions: { starts_at: string; label: string | null }[] }

// The event's name, dates, venue and each day's weigh-in and bout times, as text lines and as an
// HTML box. `e` is a row from official_invitation_email or club_invitation_email.
// deno-lint-ignore no-explicit-any
function eventDetails(e: any) {
  const dates = dateRange(e.start_date, e.end_date)
  const schedule = (Array.isArray(e.schedule) ? e.schedule : []) as ScheduleDay[]
  const zone = zoneName(e.timezone, e.start_date)
  const days = schedule.map((d) => {
    if (!d.weigh_in_start && d.sessions.length === 0) return { label: longDate(d.day), rest: true, weighIn: '', bouts: '' }
    const weighIn = d.weigh_in_start ? `${clock(d.weigh_in_start)} to ${clock(d.weigh_in_end)}` : 'Not set yet'
    const bouts = d.sessions.length
      ? d.sessions.map((s) => `${clock(s.starts_at)}${s.label ? ` (${s.label})` : ''}`).join(', ')
      : 'No bouts this day'
    return { label: longDate(d.day), rest: false, weighIn, bouts }
  })

  const text = [`Event: ${e.event_name}`, `Date${e.start_date === e.end_date ? '' : 's'}: ${dates}`]
  if (e.venue) text.push(`Where: ${e.venue}`)
  if (days.length) {
    text.push('', zone ? `Times (all ${zone}):` : 'Times:')
    for (const d of days) text.push(d.label, ...(d.rest ? ['  No bouts this day'] : [`  Weigh-in: ${d.weighIn}`, `  Bouts start: ${d.bouts}`]))
  } else if (Array.isArray(e.schedule)) {
    text.push('', 'Weigh-in and bout times will be on the site once the Owner sets them.')
  }

  const row = (label: string, value: string) => `<tr>
  <td style="padding: 6px 16px 6px 0; vertical-align: top; font-size: 17px; font-weight: 700; color: ${C.navyDeep}; white-space: nowrap;">${escape(label)}</td>
  <td style="padding: 6px 0; vertical-align: top; font-size: 18px; color: ${C.text};">${escape(value)}</td>
</tr>`
  const dayHtml = days.map((d) => `<tr><td colspan="2" style="padding: 14px 0 4px; font-size: 18px; font-weight: 700; color: ${C.text}; border-top: 1px solid ${C.border};">${escape(d.label)}</td></tr>
${d.rest ? `<tr><td colspan="2" style="padding: 6px 0; font-size: 18px; color: ${C.text};">No bouts this day</td></tr>` : `${row('Weigh-in', d.weighIn)}
${row('Bouts start', d.bouts)}`}`).join('\n')
  const timesNote = days.length
    ? (zone ? `<tr><td colspan="2" style="padding: 12px 0 4px; font-size: 15px; color: ${C.muted};">All times are ${escape(zone)}.</td></tr>` : '')
    : Array.isArray(e.schedule)
      ? `<tr><td colspan="2" style="padding: 12px 0 4px; font-size: 17px; color: ${C.text};">Weigh-in and bout times will be on the site once the Owner sets them.</td></tr>`
      : ''

  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 24px; background: ${C.page}; border: 1px solid ${C.border}; border-left: 6px solid ${C.gold}; border-radius: 12px;">
<tr><td style="padding: 16px 20px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family: ${FONT};">
    ${row('Event', e.event_name)}
    ${row(e.start_date === e.end_date ? 'Date' : 'Dates', dates)}
    ${e.venue ? row('Where', e.venue) : ''}
    ${dayHtml}
    ${timesNote}
  </table>
</td></tr>
</table>`
  return { text, html }
}

const notesText = (notes: string) => (notes ? ['', 'Notes:', notes] : [])

const notesHtml = (notes: string) =>
  notes
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 24px; background: ${C.goldSoft}; border-radius: 12px;">
<tr><td style="padding: 16px 20px; font-family: ${FONT};">
  <p style="margin: 0 0 8px; font-size: 17px; font-weight: 700; color: ${C.navyDeep};">Notes</p>
  <p style="margin: 0; font-size: 18px; line-height: 1.6; color: ${C.text};">${escape(notes).replace(/\r?\n/g, '<br>')}</p>
</td></tr>
</table>`
    : ''
