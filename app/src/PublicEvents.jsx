import { useEffect, useState } from 'react'
import { Button, Card, Layout } from 'antd'
import { api } from './api'
import { DEFAULT_TIME_ZONE, browserTimeZone, formatDateRange, formatDay, yourTimes, zoneAbbr, zoneLabel } from './dates'
import { ErrorAlert, Muted, PageHeading, Paragraph, Text, Title } from './ui'

// The public page: upcoming Active events, no sign-in needed. Never shows people or athletes.
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
          <span className="brand">Match Making</span>
          <span className="who">
            <Button href="#">{signedIn ? 'Back to the app' : 'Sign in'}</Button>
          </span>
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
    </Card>
  )
}
