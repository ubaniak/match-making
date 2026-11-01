import { useEffect, useState } from 'react'
import { api } from './api'
import { DEFAULT_TIME_ZONE, browserTimeZone, formatDateRange, formatDay, yourTimes, zoneAbbr, zoneLabel } from './dates'

// The public page: upcoming Active events, no sign-in needed. Never shows people or athletes.
export default function PublicEvents({ signedIn }) {
  const [events, setEvents] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.listPublicEvents().then(setEvents, (err) => setError(err.message))
  }, [])

  return (
    <div className="page">
      <header className="topbar">
        <strong>Match Making</strong>
        <span className="who" />
        <a className="link-button" href="#">{signedIn ? 'Back to the app' : 'Sign in'}</a>
      </header>
      <main className="panel">
        <h1>Upcoming events</h1>
        {error && <p className="error">{error}</p>}
        {events === null && !error && <p className="muted">Loading…</p>}
        {events?.length === 0 && <p className="muted">No upcoming events right now. Check back soon.</p>}
        <div className="public-events">
          {events?.map((e) => <PublicEvent key={e.id} event={e} />)}
        </div>
      </main>
    </div>
  )
}

function PublicEvent({ event }) {
  const poster = api.posterUrl(event.poster_path)
  const zone = event.timezone || DEFAULT_TIME_ZONE
  const mine = browserTimeZone()
  const away = mine !== zone
  return (
    <article className="public-event">
      {poster && <img className="poster" src={poster} alt={`Poster for ${event.name}`} />}
      <div>
        <h2>{event.name}</h2>
        <p className="when">
          {formatDateRange(event.start_date, event.end_date)}
          {event.venue && <> · {event.venue}</>}
        </p>
        {event.days.length === 0 ? (
          <p className="muted">Times to be announced.</p>
        ) : (
          <>
          <p className="muted">Times are in {zoneLabel(zone, event.start_date)}.</p>
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
                  <div className="muted">
                    Your time: weigh-in {yourTimes(d.day, [d.weigh_in_start, d.weigh_in_end], zone, mine)}
                    {d.sessions.map((s) => <span key={s.starts_at}> · {s.label ? `${s.label} bouts` : 'Bouts'} from {yourTimes(d.day, [s.starts_at], zone, mine)}</span>)}
                  </div>
                )}
              </li>
            ))}
          </ul>
          </>
        )}
      </div>
    </article>
  )
}
