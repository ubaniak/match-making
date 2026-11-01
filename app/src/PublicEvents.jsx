import { useEffect, useState } from 'react'
import { Button, Card, Layout } from 'antd'
import { HomeOutlined, LoginOutlined } from '@ant-design/icons'
import { api } from './api'
import { DEFAULT_TIME_ZONE, browserTimeZone, formatDateRange, formatDay, yourTimes, zoneAbbr, zoneLabel } from './dates'
import { Badge, ErrorAlert, Muted, PageHeading, Paragraph, Text, Title } from './ui'

// The site's front page (the root URL): upcoming Active events, no sign-in needed. Shows approved bouts (boxer, club,
// categories) but never entry lists, weights, birthdates or anyone's contact details.
export default function PublicEvents({ signedIn }) {
  const [events, setEvents] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.listPublicEvents().then(setEvents, (err) => setError(err.message))
  }, [])

  return (
    <Layout className="page">
      <Layout.Header className="app-header">
        <div className="app-header-inner">
          {signedIn
            ? <Button type="primary" icon={<HomeOutlined />} href="#home">My dashboard</Button>
            : <Button type="primary" icon={<LoginOutlined />} href="#login">Sign in</Button>}
          <span className="brand">Match Making</span>
        </div>
      </Layout.Header>
      <Layout.Content>
        <main className="panel">
          <PageHeading title="Upcoming events" />
          <ErrorAlert>{error}</ErrorAlert>
          {events === null && !error && <Muted>Loading…</Muted>}
          {events?.length === 0 && <Muted>No upcoming events right now. Check back soon.</Muted>}
          <div className="public-events">
            {events?.map((e) => <PublicEvent key={e.id} event={e} />)}
          </div>
        </main>
      </Layout.Content>
    </Layout>
  )
}

function PublicEvent({ event }) {
  const poster = api.posterUrl(event.poster_path)
  const zone = event.timezone || DEFAULT_TIME_ZONE
  const mine = browserTimeZone()
  const away = mine !== zone
  return (
    <Card className="public-event">
      {poster && <img className="poster" src={poster} alt={`Poster for ${event.name}`} />}
      <div>
        <Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>{event.name}</Title>
        <Paragraph strong>
          {formatDateRange(event.start_date, event.end_date)}
          {event.venue && <> · {event.venue}</>}
        </Paragraph>
        {event.days.length === 0 ? (
          <Muted>Times to be announced.</Muted>
        ) : (
          <>
            <Muted>Times are in {zoneLabel(zone, event.start_date)}.</Muted>
            <ul className="day-list">
              {event.days.map((d) => (
                <li key={d.day}>
                  <strong>{formatDay(d.day)}</strong>
                  <br />
                  Weigh-in {d.weigh_in_start}–{d.weigh_in_end} {zoneAbbr(zone, d.day)}
                  {d.sessions.map((s) => (
                    <span key={s.starts_at}> · {s.label ? `${s.label} bouts` : 'Bouts'} from {s.starts_at} {zoneAbbr(zone, d.day)}</span>
                  ))}
                  {away && (
                    <div>
                      <Text type="secondary">
                        Your time: weigh-in {yourTimes(d.day, [d.weigh_in_start, d.weigh_in_end], zone, mine)}
                        {d.sessions.map((s) => <span key={s.starts_at}> · {s.label ? `${s.label} bouts` : 'Bouts'} from {yourTimes(d.day, [s.starts_at], zone, mine)}</span>)}
                      </Text>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {event.bouts?.length > 0 && <PublicBouts event={event} />}
    </Card>
  )
}

// The event's fully approved bouts, by day. They can still change, so the caveat stays prominent.
function PublicBouts({ event }) {
  const days = [...new Set(event.bouts.map((b) => b.day))]
  const corner = (side, c) => (
    <div className={`corner ${side}`}>
      <Text strong>{c.name}</Text>
      <Text type="secondary">{c.club ?? '—'}</Text>
      {c.categories && <Text type="secondary">{c.categories}</Text>}
    </div>
  )
  return (
    <div className="public-bouts">
      <div className="public-bouts-heading">
        <Title level={4} style={{ margin: 0 }}>Approved bouts</Title>
        <Badge strong>Subject to change</Badge>
      </div>
      <Muted>Bouts can change or be cancelled up to fight time, including after the weigh-in.</Muted>
      {days.map((day) => (
        <div key={day}>
          {(days.length > 1 || event.start_date !== event.end_date) && <Title level={5} style={{ margin: '12px 0 8px' }}>{formatDay(day)}</Title>}
          <div className="bout-list">
            {event.bouts.filter((b) => b.day === day).map((b) => (
              <Card key={b.id} size="small" className="bout" title={`Bout ${b.number}`} extra={b.session_starts_at && <Text type="secondary">{b.session_label ? `${b.session_label} · ` : ''}{b.session_starts_at}</Text>}>
                <div className="bout-corners">
                  {corner('red', b.red)}
                  <span className="vs">vs</span>
                  {corner('blue', b.blue)}
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
