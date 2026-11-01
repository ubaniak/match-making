// Loads what the Home page shows: one set of numbers per role the signed-in user has.
// Built from the same API calls the other pages use, so demo mode works unchanged.
import { api } from './api'
import { todayIso } from './dates'
import { effectiveStatus, isOpen } from './events'

// Upcoming or running events we load in detail (entries, bouts). Keeps Home quick on big sites.
const MAX_DETAILED = 12

const quietly = (promise, fallback) => promise.catch(() => fallback)

// 'accepted', 'declined', 'pending' or 'expired' (pending past its respond-by date).
export function answerOf(invitation) {
  if (invitation.status === 'pending' && invitation.respond_by && todayIso(invitation.timezone) > invitation.respond_by) return 'expired'
  return invitation.status
}

const isLive = (event) => ['requested', 'active'].includes(effectiveStatus(event))
const entriesOpen = (event) => isOpen(event) && (!event.entry_deadline || new Date() <= new Date(event.entry_deadline))

export async function loadDashboard({ profile, siteAdmin }) {
  const me = profile?.id
  const [events, clubs, invitations] = await Promise.all([
    quietly(api.listEvents(), []),
    quietly(api.listClubs(), []),
    quietly(api.listMyInvitations(), []),
  ])

  const myClubs = clubs.filter((c) => c.members.some((m) => m.user_id === me && m.status === 'active'))
  const ownedClubIds = new Set(myClubs.filter((c) => c.members.some((m) => m.user_id === me && m.role === 'owner')).map((c) => c.id))
  const myClubIds = new Set(myClubs.map((c) => c.id))
  const liveEvents = events.filter(isLive)
  const ownedEvents = events.filter((e) => e.members.some((m) => m.user_id === me && m.role === 'owner'))
  const acceptedEventIds = new Set(invitations.filter((i) => i.status === 'accepted').map((i) => i.event_id))

  // Events worth opening up: ones I own, ones I'm officiating, and (for club people) every live one.
  const detailed = liveEvents
    .filter((e) => ownedEvents.includes(e) || acceptedEventIds.has(e.id) || myClubs.length > 0)
    .slice(0, MAX_DETAILED)
  const details = await Promise.all(
    detailed.map(async (e) => {
      const [event, bouts] = await Promise.all([quietly(api.getEvent(e.id), null), quietly(api.getBouts(e.id), null)])
      return event && { event, bouts: bouts ?? { officials: [], bouts: [], weighIns: [], acceptedDays: [] } }
    }),
  )
  const byId = Object.fromEntries(details.filter(Boolean).map((d) => [d.event.id, d]))

  const result = { events, liveEvents, clubs, myClubs, invitations }

  if (siteAdmin) result.admin = await loadAdmin(events, clubs)
  if (ownedEvents.length) result.owner = ownerStats(ownedEvents, byId)
  if (myClubs.length) result.club = await clubStats(myClubs, myClubIds, ownedClubIds, liveEvents, byId)
  const officialEvents = Object.values(byId).filter((d) => d.bouts.officials.some((o) => o.user_id === me))
  if (invitations.length || officialEvents.length) result.official = officialStats(invitations, officialEvents, me)
  return result
}

async function loadAdmin(events, clubs) {
  const [users, athletes, officials, clubInvites] = await Promise.all([
    quietly(api.listUsers(), []),
    quietly(api.listAthletes(), []),
    quietly(api.listOfficials(), []),
    quietly(api.listPendingClubInvites(), []),
  ])
  const status = (s) => events.filter((e) => effectiveStatus(e) === s)
  const today = todayIso()
  const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)
  return {
    requested: status('requested'),
    active: status('active'),
    soon: status('active').filter((e) => e.start_date >= today && e.start_date <= in30),
    running: status('active').filter((e) => e.start_date <= today && e.end_date >= today),
    users: {
      active: users.filter((u) => u.state === 'Active').length,
      invited: users.filter((u) => u.state === 'Invited').length,
      disabled: users.filter((u) => u.state === 'Disabled').length,
    },
    clubs: clubs.length,
    athletes: athletes.length,
    officials: {
      total: officials.length,
      signedIn: officials.filter((o) => o.user_id).length,
    },
    clubInvites,
  }
}

// One row per live event I own, with what still needs doing.
function ownerStats(ownedEvents, byId) {
  const rows = ownedEvents.filter(isLive).map((e) => {
    const d = byId[e.id]
    const event = d?.event ?? e
    const bouts = (d?.bouts.bouts ?? []).filter((b) => b.status !== 'cancelled')
    const clubs = event.clubs ?? []
    return {
      event: e,
      status: effectiveStatus(e),
      athletes: event.athlete_count ?? 0,
      clubsIn: clubs.filter((c) => c.status === 'accepted').length,
      joinRequests: clubs.filter((c) => c.status === 'requested').length,
      lateEntries: (event.late_entries ?? []).filter((l) => l.status === 'pending').length,
      officials: (d?.bouts.officials ?? []).length,
      missingTimes: event.days.length === 0,
      bouts: bouts.length,
      approved: bouts.filter((b) => b.status === 'approved').length,
      pending: bouts.filter((b) => b.status === 'pending').length,
      rejected: bouts.filter((b) => b.status === 'rejected').length,
      results: bouts.filter((b) => b.winner).length,
    }
  })
  const sum = (key) => rows.reduce((total, r) => total + r[key], 0)
  return {
    rows,
    totals: {
      events: rows.length,
      athletes: sum('athletes'),
      requests: sum('joinRequests') + sum('lateEntries'),
      bouts: sum('bouts'),
      approved: sum('approved'),
      pending: sum('pending'),
    },
  }
}

async function clubStats(myClubs, myClubIds, ownedClubIds, liveEvents, byId) {
  const fullClubs = await Promise.all(myClubs.map((c) => quietly(api.getClub(c.id), null)))
  const transfersIn = fullClubs
    .filter(Boolean)
    .flatMap((c) => c.transfers.filter((t) => t.status === 'pending' && ownedClubIds.has(t.to_club_id) && t.to_club_id === c.id))

  const events = liveEvents.filter((e) => byId[e.id]).map((e) => {
    const { event, bouts } = byId[e.id]
    const inEvent = (event.clubs ?? []).filter((ec) => myClubIds.has(ec.club_id))
    const entered = event.athletes.filter((a) => myClubIds.has(a.entry_club_id ?? a.club_id))
    const myBouts = bouts.bouts.filter((b) => b.status !== 'cancelled' && (myClubIds.has(b.red_club_id) || myClubIds.has(b.blue_club_id)))
    // Bouts waiting for my corner's answer: my club is in it, I own that club, and that side hasn't decided.
    const toApprove = myBouts.filter((b) => b.status === 'pending' && !b.winner && ['red', 'blue'].some((side) => {
      const club = side === 'red' ? b.red_club_id : b.blue_club_id
      return ownedClubIds.has(club) && !b.approvals.some((a) => a.side === side)
    }))
    return {
      event: e,
      joined: inEvent.some((ec) => ec.status === 'accepted'),
      asked: inEvent.some((ec) => ec.status === 'requested'),
      entriesOpen: entriesOpen(event),
      entered: entered.length,
      bouts: myBouts.length,
      approved: myBouts.filter((b) => b.status === 'approved').length,
      toApprove,
    }
  })

  return {
    clubs: myClubs.map((c) => ({ ...c, owner: ownedClubIds.has(c.id) })),
    athletes: myClubs.reduce((total, c) => total + c.athlete_count, 0),
    transfersIn,
    events: events.filter((r) => r.joined || r.asked || r.entriesOpen),
    joined: events.filter((r) => r.joined).length,
    entered: events.reduce((total, r) => total + r.entered, 0),
    toApprove: events.flatMap((r) => r.toApprove.map((b) => ({ ...b, event: r.event }))),
  }
}

function officialStats(invitations, officialEvents, me) {
  const live = invitations.filter((i) => effectiveStatus({ status: i.event_status, start_date: i.start_date, end_date: i.end_date, timezone: i.timezone }) === 'active')
  const waiting = live.filter((i) => answerOf(i) === 'pending')
  const accepted = live.filter((i) => i.status === 'accepted').sort((a, b) => a.start_date.localeCompare(b.start_date))
  const roles = officialEvents.map(({ event, bouts }) => ({
    event,
    role: bouts.officials.find((o) => o.user_id === me)?.role,
    // Bouts still missing the official approval.
    toApprove: bouts.bouts.filter((b) => b.status === 'pending' && !b.winner && !b.approvals.some((a) => a.side === 'official')),
    weighIns: bouts.weighIns.length,
    athletes: event.athlete_count ?? event.athletes?.length ?? 0,
  }))
  return {
    waiting,
    accepted,
    next: accepted.find((i) => i.end_date >= todayIso(i.timezone)) ?? null,
    roles,
    toApprove: roles.flatMap((r) => r.toApprove.map((b) => ({ ...b, event: r.event }))),
  }
}
