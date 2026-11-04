import { useEffect, useState } from 'react'
import { Alert, Button, Card, Divider, Input, Layout, Select, Spin } from 'antd'
import { CalendarOutlined, SafetyCertificateOutlined, UserOutlined, GoogleOutlined, HomeOutlined, LogoutOutlined, SettingOutlined, TeamOutlined } from '@ant-design/icons'
import { api } from './api'
import { isOfficial, useAuth } from './auth'
import AdminPage, { AthletesPage, OfficialsPage } from './AdminPage'
import ClubsPage from './ClubsPage'
import EventsPage from './EventsPage'
import HomePage from './HomePage'
import { NotificationBell, NotificationsProvider } from './Notifications'
import PublicEvents from './PublicEvents'
import { TestingBar } from './TestRun'
import { ErrorAlert, Muted, Paragraph, Text, Title } from './ui'

const pageIcons = { home: <HomeOutlined />, events: <CalendarOutlined />, clubs: <TeamOutlined />, athletes: <UserOutlined />, officials: <SafetyCertificateOutlined />, admin: <SettingOutlined /> }

export default function App() {
  const { session, profile, can, loading } = useAuth()
  // Bumped on every tab click so clicking the current tab again goes back to its list.
  const [visit, setVisit] = useState(0)
  // Where a link from Home (or an alert) asked to go: { eventId, tab } or { clubId }.
  const [target, setTarget] = useState({})
  const hash = useHash()
  const route = routeFor(hash)

  // The page lives in the address bar (#home, #events, #clubs…), so refresh, Back and links keep it.
  // Once signed in, the sign-in page (or the bare root a sign-in link leaves behind) moves on to Home.
  const page = pageFor(hash)
  useEffect(() => {
    if (session && (route === 'login' || (route === 'app' && !page))) goTo('#home')
  }, [session, route, page])

  // The site root is the public list of upcoming events; it needs no sign-in.
  if (route === 'public') return <PublicEvents signedIn={Boolean(session)} />

  if (loading) {
    return <main className="center-screen"><Spin description="Loading…" /></main>
  }

  // #login, or any app page while signed out: sign in, then carry on to Home.
  if (!session) return api.mode === 'mock' ? <MockLogin /> : <Login />

  const pages = [
    ['home', 'Home'],
    can('pages:read') && ['events', 'Events'],
    // Officials don't see clubs (Bhavek, 2026-11-02).
    can('pages:read') && !isOfficial(profile) && ['clubs', 'Clubs'],
    // The site Admin gets Athletes and Officials in the top nav, not tucked under Admin (Bhavek, 2026-11-02).
    can('users:manage') && ['athletes', 'Athletes'],
    can('users:manage') && ['officials', 'Officials'],
    can('users:manage') && ['admin', 'Admin'],
  ].filter(Boolean)
  const current = pages.find(([key]) => key === page)?.[0] ?? pages[0]?.[0]
  // A link only counts for the user who clicked it (demo mode can switch users).
  const linked = target.userId === profile?.id ? target : {}

  // Go to a page, optionally straight to one event (and tab) or club:
  // open({ page: 'events', eventId, tab }) or open({ page: 'clubs', clubId }).
  function open({ page: next, ...rest }) {
    if (pageFor(window.location.hash) !== next) window.location.hash = next
    setTarget({ ...rest, userId: profile?.id })
    setVisit((v) => v + 1)
    window.scrollTo(0, 0)
  }

  return (
    <NotificationsProvider userId={profile?.id}>
      <Layout className="page">
        {api.mode === 'mock' && <DemoBanner userId={session.user.id} />}
        <TestingBar email={session.user.email} />
        <Layout.Header className={pages.length > 4 ? 'app-header many-pages' : 'app-header'}>
          <div className="app-header-inner">
            <span className="brand">Match Making</span>
            {pages.length > 1 ? (
              <nav className="pill-nav" aria-label="Pages">
                {pages.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={current === key ? 'pill active' : 'pill'}
                    aria-current={current === key ? 'page' : undefined}
                    aria-label={label}
                    onClick={() => open({ page: key })}
                  >
                    {pageIcons[key]}
                    <span className="pill-label">{label}</span>
                  </button>
                ))}
              </nav>
            ) : <span style={{ flex: 1 }} />}
            <span className="who">
              <NotificationBell onOpen={open} />
              <Text className="who-name" title={profile?.name || session.user.email}>{profile?.name || session.user.email}</Text>
              {/* The site role is a label, not a button. Everyone is a User, so only Admin and Official show. */}
              {siteRoleLabel(profile) && <span className="who-role">{siteRoleLabel(profile)}</span>}
              <Button icon={<LogoutOutlined />} aria-label="Sign out" onClick={() => api.signOut().then(() => goTo(''))}>Sign out</Button>
            </span>
          </div>
        </Layout.Header>
        <Layout.Content id="main-content">
          {current === 'home' && <HomePage key={`${profile?.id}-${visit}`} profile={profile} can={can} onOpen={open} />}
          {current === 'events' && <EventsPage key={`${profile?.id}-${visit}`} profile={profile} can={can} eventId={linked.eventId} tab={linked.tab} />}
          {current === 'clubs' && <ClubsPage key={`${profile?.id}-${visit}`} profile={profile} can={can} clubId={linked.clubId} />}
          {current === 'athletes' && <AthletesPage key={visit} />}
          {current === 'officials' && <OfficialsPage key={visit} />}
          {current === 'admin' && <AdminPage key={visit} />}
        </Layout.Content>
      </Layout>
    </NotificationsProvider>
  )
}

// Routes live in the URL hash so GitHub Pages serves them without any server setup:
//   (none), #upcoming  public upcoming events (the site root)
//   #login             sign-in page
//   #home, #events, #clubs, #athletes, #officials, #admin   the signed-in app's pages
//                      (anything else goes to #home, e.g. a sign-in link's #access_token=…)
function routeFor(hash) {
  const key = hash.replace(/^#\/?/, '')
  if (key === '' || key === 'upcoming') return 'public'
  if (key === 'login') return 'login'
  return 'app'
}

const appPages = ['home', 'events', 'clubs', 'athletes', 'officials', 'admin']

// Which app page a hash names (#events, #/clubs…), or null.
function pageFor(hash) {
  const key = hash.replace(/^#\/?/, '')
  return appPages.includes(key) ? key : null
}

const siteRoleLabels = { admin: 'Admin', official: 'Official' }
function siteRoleLabel(profile) {
  const key = profile?.role_id
  if (siteRoleLabels[key]) return siteRoleLabels[key]
  const name = profile?.roles?.name
  return name === 'Admins' ? 'Admin' : name === 'Officials' ? 'Official' : null
}

function goTo(hash) {
  const url = window.location.pathname + window.location.search + (hash ? hash : '')
  window.history.replaceState(null, '', url)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

// A sign-in link (magic link or Google) comes back to the root with #access_token=… or ?code=…,
// which Supabase strips from the address bar as it signs in. Read it now, before that happens,
// so the person lands on Home and not on the public list.
const backFromSignIn = /access_token=|error_description=/.test(window.location.hash) || /[?&]code=/.test(window.location.search)

// Google sign-in for an email nobody invited comes back with an error instead of a session.
function signInErrorFromUrl() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, '') + '&' + window.location.search.replace(/^\?/, ''))
  const description = params.get('error_description')
  if (!description) return null
  return /database error saving new user|has not been invited/i.test(description)
    ? 'That Google account\'s email hasn\'t been invited. Ask a site Admin or the person running your event to add you, then try again.'
    : description
}
const signInErrorOnLoad = signInErrorFromUrl()

function useHash() {
  const [hash, setHash] = useState(backFromSignIn ? '#home' : window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

const publicLink = <Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}><a href="#">Back to upcoming events</a></Paragraph>

function DemoBanner({ userId }) {
  const [users, setUsers] = useState([])

  useEffect(() => {
    api.listUsers().then((all) => setUsers(all.filter((u) => u.id && u.id !== api.adminId && u.state === 'Active')))
  }, [])

  function reset() {
    api.resetDemoData()
    window.location.reload()
  }

  return (
    <Alert
      className="demo-banner"
      type="info"
      title={
        <>
          <span>Demo mode: sample data, saved only in this browser.</span>
          <span>
            Viewing as{' '}
            <Select
              size="small"
              value={userId}
              onChange={(value) => api.viewAs(value)}
              popupMatchSelectWidth={false}
              style={{ minWidth: 160 }}
              options={[{ value: api.adminId, label: 'Demo Admin' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
            />
          </span>
          <Button type="link" size="small" onClick={reset}>Reset sample data</Button>
        </>
      }
    />
  )
}

function SignedOutCard({ title, children }) {
  return (
    <main className="center-screen">
      <Card className="center-card">
        <Title level={2} style={{ marginTop: 0 }}>{title}</Title>
        {children}
      </Card>
    </main>
  )
}

// Google shows only once it's switched on in Supabase and the build has VITE_GOOGLE_SIGN_IN=true.
const googleEnabled = import.meta.env.VITE_GOOGLE_SIGN_IN === 'true'

function Login() {
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState(signInErrorOnLoad)
  const [busy, setBusy] = useState(false)

  async function run(action) {
    setError(null)
    setBusy(true)
    try {
      await action()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function sendCode(event) {
    event.preventDefault()
    run(async () => {
      await api.sendMagicLink(email.trim())
      setCode('')
      setSentTo(email.trim())
    })
  }

  function verifyCode(event) {
    event.preventDefault()
    run(() => api.verifyEmailCode(sentTo, code.trim()))
  }

  if (sentTo) {
    return (
      <SignedOutCard title="Check your email">
        <form onSubmit={verifyCode} className="login-form">
          {/@demo\.test$/i.test(sentTo) ? (
            <Paragraph><strong>{sentTo}</strong> is a demo account from the test data. Type its demo code.</Paragraph>
          ) : (
            <Paragraph>We sent a sign-in code to <strong>{sentTo}</strong>. Type it below, or click the link in the same email.</Paragraph>
          )}
          <Input
            size="large"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6,10}"
            maxLength={10}
            placeholder="6-digit code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            autoFocus
          />
          <Button type="primary" htmlType="submit" size="large" block loading={busy} style={{ marginTop: 12 }}>
            Sign in
          </Button>
        </form>
        <ErrorAlert>{error}</ErrorAlert>
        <Button type="link" onClick={() => { setSentTo(null); setError(null) }} style={{ paddingLeft: 0, marginTop: 8 }}>
          Use a different email
        </Button>
      </SignedOutCard>
    )
  }

  return (
    <SignedOutCard title="Match Making">
      {googleEnabled && (
        <>
          <Button size="large" block icon={<GoogleOutlined />} disabled={busy} onClick={() => run(() => api.signInWithGoogle())}>
            Continue with Google
          </Button>
          <Divider plain>or</Divider>
        </>
      )}
      <form onSubmit={sendCode} className="login-form">
        <Paragraph>Enter your email and we'll send you a sign-in code.</Paragraph>
        <Paragraph type="secondary">Testing with a demo account (ending @demo.test)? No email is sent: you'll type its demo code on the next screen.</Paragraph>
        <Input
          size="large"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button type="primary" htmlType="submit" size="large" block loading={busy} style={{ marginTop: 12 }}>
          {busy ? 'Sending…' : 'Email me a code'}
        </Button>
      </form>
      <ErrorAlert>{error}</ErrorAlert>
      {publicLink}
    </SignedOutCard>
  )
}

// Demo mode: only the one special account configured for the build can sign in.
function MockLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)

  async function signIn(event) {
    event.preventDefault()
    setError(null)
    try {
      await api.signInWithPassword(email, password)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <SignedOutCard title="Match Making">
      <form onSubmit={signIn}>
        <Paragraph>Demo mode. Sign in with the demo admin account.</Paragraph>
        <Input
          size="large"
          type="email"
          required
          autoComplete="username"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input.Password
          size="large"
          required
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          style={{ marginTop: 12 }}
        />
        <Button type="primary" htmlType="submit" size="large" block style={{ marginTop: 12 }}>Sign in</Button>
      </form>
      <ErrorAlert>{error}</ErrorAlert>
      {publicLink}
    </SignedOutCard>
  )
}
