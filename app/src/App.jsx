import { useEffect, useState } from 'react'
import { Alert, Button, Card, Input, Layout, Select, Spin } from 'antd'
import { CalendarOutlined, LogoutOutlined, SettingOutlined, TeamOutlined } from '@ant-design/icons'
import { api } from './api'
import { useAuth } from './auth'
import AdminPage from './AdminPage'
import ClubsPage from './ClubsPage'
import EventsPage from './EventsPage'
import PublicEvents from './PublicEvents'
import { Badge, ErrorAlert, Muted, Paragraph, Text, Title } from './ui'

const pageIcons = { events: <CalendarOutlined />, clubs: <TeamOutlined />, admin: <SettingOutlined /> }

export default function App() {
  const { session, profile, can, loading } = useAuth()
  const [page, setPage] = useState('events')
  // Bumped on every tab click so clicking the current tab again goes back to its list.
  const [visit, setVisit] = useState(0)
  const hash = useHash()

  // The public page needs no sign-in.
  if (hash === '#upcoming') return <PublicEvents signedIn={Boolean(session)} />

  if (loading) {
    return <main className="center-screen"><Spin description="Loading…" /></main>
  }

  if (!session) return api.mode === 'mock' ? <MockLogin /> : <Login />

  const pages = [
    can('pages:read') && ['events', 'Events'],
    can('pages:read') && ['clubs', 'Clubs'],
    can('users:manage') && ['admin', 'Admin'],
  ].filter(Boolean)
  const current = pages.find(([key]) => key === page)?.[0] ?? pages[0]?.[0]

  return (
    <Layout className="page">
      {api.mode === 'mock' && <DemoBanner userId={session.user.id} />}
      <Layout.Header className="app-header">
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
                  onClick={() => { setPage(key); setVisit((v) => v + 1) }}
                >
                  {pageIcons[key]}
                  <span className="pill-label">{label}</span>
                </button>
              ))}
            </nav>
          ) : <span style={{ flex: 1 }} />}
          <span className="who">
            <Text className="who-name">{profile?.name || session.user.email}</Text>
            {profile && <Badge>{profile.roles?.name}</Badge>}
            <Button icon={<LogoutOutlined />} onClick={() => api.signOut()}>Sign out</Button>
          </span>
        </div>
      </Layout.Header>
      <Layout.Content id="main-content">
        {current === 'events' && <EventsPage key={`${profile?.id}-${visit}`} profile={profile} can={can} />}
        {current === 'clubs' && <ClubsPage key={`${profile?.id}-${visit}`} profile={profile} can={can} />}
        {current === 'admin' && <AdminPage key={visit} />}
        {!current && <Hello profile={profile} email={session.user.email} />}
      </Layout.Content>
    </Layout>
  )
}

function useHash() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

const publicLink = <Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}><a href="#upcoming">See upcoming events</a></Paragraph>

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

function Login() {
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState(null)
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)

  async function sendLink(event) {
    event.preventDefault()
    setError(null)
    setSending(true)
    try {
      await api.sendMagicLink(email.trim())
      setSentTo(email.trim())
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  if (sentTo) {
    return (
      <SignedOutCard title="Check your email">
        <Paragraph>We sent a sign-in link to <strong>{sentTo}</strong>. Open it on this device to sign in.</Paragraph>
        <Button onClick={() => setSentTo(null)}>Use a different email</Button>
      </SignedOutCard>
    )
  }

  return (
    <SignedOutCard title="Match Making">
      <form onSubmit={sendLink} className="login-form">
        <Paragraph>Enter your email and we'll send you a sign-in link.</Paragraph>
        <Input
          size="large"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button type="primary" htmlType="submit" size="large" block loading={sending} style={{ marginTop: 12 }}>
          {sending ? 'Sending…' : 'Email me a sign-in link'}
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

function Hello({ profile, email }) {
  return (
    <main className="panel">
      <Card>
        <Title level={2} style={{ marginTop: 0 }}>Hello world</Title>
        <Paragraph>Signed in as {email}</Paragraph>
        {profile?.role_id === 'public' && (
          <Muted>You don't have a role yet. Ask an Admin to add you as a user.</Muted>
        )}
      </Card>
    </main>
  )
}
