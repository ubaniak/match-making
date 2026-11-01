// Home: the first page after sign-in. Alerts at the top, then one block per role the user has
// (site Admin, event Owner, club Owner or Coach, official), each with the numbers that role needs.
import { useCallback, useEffect, useState } from 'react'
import { Button } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import DataTable from './DataTable'
import HomeAlerts from './HomeAlerts'
import { formatDateRange } from './dates'
import { loadDashboard } from './dashboard'
import { statusLabels } from './events'
import { Badge, ErrorAlert, Muted, PageHeading, Section, StatGrid, Text } from './ui'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const shortDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const officialRoles = { chief: 'Chief Official', deputy: 'Deputy' }

export default function HomePage({ profile, can, onOpen }) {
  const siteAdmin = can('users:manage')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await loadDashboard({ profile, siteAdmin }))
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [profile, siteAdmin])

  useEffect(() => {
    load()
  }, [load])

  const eventLink = (event, tab) => (
    <Button type="link" size="small" style={{ padding: 0 }} onClick={() => onOpen({ page: 'events', eventId: event.id, tab })}>{event.name}</Button>
  )
  const roles = data ? [data.admin && 'admin', data.owner && 'owner', data.club && 'club', data.official && 'official'].filter(Boolean) : []

  return (
    <main className="panel">
      <PageHeading title="Home" subtitle={`Hello, ${profile?.name || profile?.email || 'there'}`}>
        <Button icon={<ReloadOutlined />} loading={loading && Boolean(data)} onClick={load}>Refresh</Button>
      </PageHeading>
      <ErrorAlert>{error}</ErrorAlert>
      {!data && !error && <Muted>Loading…</Muted>}

      <HomeAlerts profile={profile} can={can} onOpen={onOpen} dashboard={data} />

      {data?.admin && <AdminBlock admin={data.admin} onOpen={onOpen} eventLink={eventLink} />}
      {data?.owner && <OwnerBlock owner={data.owner} onOpen={onOpen} eventLink={eventLink} />}
      {data?.club && <ClubBlock club={data.club} onOpen={onOpen} eventLink={eventLink} />}
      {data?.official && <OfficialBlock official={data.official} onOpen={onOpen} eventLink={eventLink} />}

      {data && roles.length === 0 && (
        <Section title="Getting started">
          {profile?.role_id === 'public' ? (
            <Muted>You don't have a role yet. Ask an Admin to add you as a user.</Muted>
          ) : (
            <Muted>
              You're not running an event, in a club or officiating yet. A club Owner can add you to their club, an Admin can
              invite you to officiate, and events you're added to show up here.
            </Muted>
          )}
          <Button onClick={() => onOpen({ page: 'events' })}>See events</Button>
        </Section>
      )}
    </main>
  )
}

function AdminBlock({ admin, onOpen, eventLink }) {
  const events = () => onOpen({ page: 'events' })
  const columns = [
    { title: 'Event', key: 'name', value: (e) => e.name, render: (_, e) => eventLink(e) },
    { title: 'Dates', key: 'dates', value: (e) => e.start_date, render: (_, e) => formatDateRange(e.start_date, e.end_date) },
    { title: 'Location', key: 'venue', render: (_, e) => e.venue || '—' },
    { title: 'Athletes', dataIndex: 'athlete_count', key: 'athletes' },
  ]
  return (
    <Section title="Site admin">
      <StatGrid
        stats={[
          { key: 'requested', title: 'To approve', value: admin.requested.length, note: 'Events requested', onClick: events },
          { key: 'active', title: 'Active events', value: admin.active.length, note: `${admin.running.length} running today · ${admin.soon.length} in the next 30 days`, onClick: events },
          { key: 'users', title: 'Users', value: admin.users.active, note: `${admin.users.invited} invited · ${admin.users.disabled} disabled`, onClick: () => onOpen({ page: 'admin' }) },
          { key: 'clubs', title: 'Clubs', value: admin.clubs, note: admin.clubInvites.length ? `${plural(admin.clubInvites.length, 'invite')} to approve` : 'No invites waiting', onClick: () => onOpen({ page: 'clubs' }) },
          { key: 'athletes', title: 'Athletes', value: admin.athletes, note: 'On the site', onClick: () => onOpen({ page: 'admin' }) },
          { key: 'officials', title: 'Officials', value: admin.officials.total, note: `${admin.officials.signedIn} signed in`, onClick: () => onOpen({ page: 'admin' }) },
        ]}
      />
      {admin.requested.length > 0 && (
        <>
          <Text strong>Waiting for your approval</Text>
          <DataTable rowKey="id" columns={columns} dataSource={admin.requested} />
        </>
      )}
      {admin.soon.length + admin.running.length > 0 && (
        <>
          <Text strong>Running now and coming up</Text>
          <DataTable rowKey="id" columns={columns} dataSource={[...admin.running, ...admin.soon.filter((e) => !admin.running.includes(e))]} />
        </>
      )}
    </Section>
  )
}

function OwnerBlock({ owner, onOpen, eventLink }) {
  const { totals, rows } = owner
  const columns = [
    { title: 'Event', key: 'name', value: (r) => r.event.name, render: (_, r) => eventLink(r.event) },
    { title: 'Status', key: 'status', value: (r) => statusLabels[r.status], render: (_, r) => <Badge strong={r.status === 'active'}>{statusLabels[r.status]}</Badge> },
    { title: 'Dates', key: 'dates', value: (r) => r.event.start_date, render: (_, r) => formatDateRange(r.event.start_date, r.event.end_date) },
    { title: 'Clubs', key: 'clubs', value: (r) => r.clubsIn, render: (_, r) => r.clubsIn },
    { title: 'Athletes', key: 'athletes', value: (r) => r.athletes, render: (_, r) => r.athletes },
    { title: 'Requests', key: 'requests', value: (r) => r.joinRequests + r.lateEntries, render: (_, r) => r.joinRequests + r.lateEntries },
    { title: 'Officials', key: 'officials', value: (r) => r.officials, render: (_, r) => r.officials },
    { title: 'Bouts', key: 'bouts', value: (r) => r.bouts, render: (_, r) => (r.bouts ? `${r.approved} of ${r.bouts} approved` : '0') },
    { title: 'Results', key: 'results', value: (r) => r.results, render: (_, r) => r.results },
  ]
  const first = rows[0]?.event
  const go = (tab) => (rows.length === 1 ? () => onOpen({ page: 'events', eventId: first.id, tab }) : () => onOpen({ page: 'events' }))
  return (
    <Section title="Your events">
      <StatGrid
        stats={[
          { key: 'events', title: totals.events === 1 ? 'Event' : 'Events', value: totals.events, note: 'You own, still running', onClick: go() },
          { key: 'athletes', title: 'Athletes', value: totals.athletes, note: 'Entered', onClick: go('clubs') },
          { key: 'requests', title: 'Requests', value: totals.requests, note: 'Clubs and late entries to answer', onClick: go('clubs') },
          { key: 'bouts', title: 'Bouts', value: totals.bouts, note: `${totals.approved} approved · ${totals.pending} waiting`, onClick: go('bouts') },
        ]}
      />
      {rows.length > 0 ? <DataTable rowKey={(r) => r.event.id} columns={columns} dataSource={rows} /> : <Muted>None of your events are running right now.</Muted>}
    </Section>
  )
}

function ClubBlock({ club, onOpen, eventLink }) {
  const owns = club.clubs.some((c) => c.owner)
  const clubsLink = club.clubs.length === 1 ? () => onOpen({ page: 'clubs', clubId: club.clubs[0].id }) : () => onOpen({ page: 'clubs' })
  const columns = [
    { title: 'Event', key: 'name', value: (r) => r.event.name, render: (_, r) => eventLink(r.event, r.joined ? 'clubs' : undefined) },
    { title: 'Dates', key: 'dates', value: (r) => r.event.start_date, render: (_, r) => formatDateRange(r.event.start_date, r.event.end_date) },
    {
      title: 'Your club', key: 'club', value: (r) => clubState(r),
      render: (_, r) => <Badge strong={r.joined} muted={!r.joined && !r.asked}>{clubState(r)}</Badge>,
    },
    { title: 'Entries', key: 'entries', value: (r) => (r.entriesOpen ? 'Open' : 'Closed'), render: (_, r) => (r.entriesOpen ? 'Open' : 'Closed') },
    { title: 'Athletes in', key: 'entered', value: (r) => r.entered, render: (_, r) => r.entered },
    { title: 'Bouts', key: 'bouts', value: (r) => r.bouts, render: (_, r) => (r.bouts ? `${r.approved} of ${r.bouts} approved` : '0') },
    owns && {
      title: 'To approve', key: 'approve', value: (r) => r.toApprove.length,
      render: (_, r) => (r.toApprove.length ? <Button size="small" type="primary" onClick={() => onOpen({ page: 'events', eventId: r.event.id, tab: 'bouts' })}>{r.toApprove.length} to approve</Button> : '0'),
    },
  ].filter(Boolean)
  const title = club.clubs.length === 1 ? club.clubs[0].name : 'Your clubs'
  return (
    <Section title={title}>
      <StatGrid
        stats={[
          club.clubs.length > 1 && { key: 'clubs', title: 'Clubs', value: club.clubs.length, note: club.clubs.map((c) => c.name).join(', '), onClick: clubsLink },
          { key: 'athletes', title: 'Athletes', value: club.athletes, note: 'In your club' + (club.clubs.length > 1 ? 's' : ''), onClick: clubsLink },
          { key: 'events', title: 'Events', value: club.joined, note: 'Your club is in', onClick: () => onOpen({ page: 'events' }) },
          { key: 'entered', title: 'Entered', value: club.entered, note: 'Athletes in events' },
          owns && { key: 'approve', title: 'To approve', value: club.toApprove.length, note: 'Bouts for your corner' },
          owns && { key: 'transfers', title: 'Transfers', value: club.transfersIn.length, note: 'Asking to join your club', onClick: clubsLink },
        ]}
      />
      {club.events.length > 0 ? (
        <DataTable rowKey={(r) => r.event.id} columns={columns} dataSource={club.events} />
      ) : (
        <Muted>No events are taking entries right now.</Muted>
      )}
    </Section>
  )
}

const clubState = (r) => (r.joined ? 'In' : r.asked ? 'Asked to join' : 'Not in')

function OfficialBlock({ official, onOpen, eventLink }) {
  const { next } = official
  const roleOf = (i) => officialRoles[official.roles.find((r) => r.event.id === i.event_id)?.role] ?? 'Official'
  const toApproveOf = (i) => official.roles.find((r) => r.event.id === i.event_id)?.toApprove.length ?? 0
  const columns = [
    { title: 'Event', key: 'name', value: (i) => i.event_name, render: (_, i) => eventLink({ id: i.event_id, name: i.event_name }, 'officials') },
    { title: 'Dates', key: 'dates', value: (i) => i.start_date, render: (_, i) => formatDateRange(i.start_date, i.end_date) },
    { title: 'Location', key: 'venue', render: (_, i) => i.venue || '—' },
    {
      title: 'Your role', key: 'role',
      value: (i) => roleOf(i),
      render: (_, i) => roleOf(i),
    },
    {
      title: 'To approve', key: 'approve', value: (i) => toApproveOf(i), render: (_, i) => toApproveOf(i),
    },
  ]
  return (
    <Section title="Officiating">
      <StatGrid
        stats={[
          { key: 'waiting', title: 'To answer', value: official.waiting.length, note: 'Invitations to officiate', onClick: () => onOpen({ page: 'events' }) },
          { key: 'accepted', title: 'Accepted', value: official.accepted.length, note: 'Events you\'re working' },
          { key: 'next', title: 'Next event', value: next ? shortDate(next.start_date) : '—', note: next ? next.event_name : 'Nothing booked', onClick: next ? () => onOpen({ page: 'events', eventId: next.event_id, tab: 'officials' }) : undefined },
          official.roles.some((r) => r.role) && { key: 'approve', title: 'To approve', value: official.toApprove.length, note: 'Bouts needing the official approval' },
        ]}
      />
      {official.accepted.length > 0 ? (
        <DataTable rowKey="id" columns={columns} dataSource={official.accepted} />
      ) : (
        <Muted>You haven't accepted any events yet.</Muted>
      )}
    </Section>
  )
}
