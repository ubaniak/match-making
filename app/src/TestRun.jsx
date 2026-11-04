import { useEffect, useState } from 'react'
import { Alert, Button, Popover, Select } from 'antd'
import { DownOutlined, EyeOutlined, RollbackOutlined } from '@ant-design/icons'
import { api } from './api'
import { showError } from './dialogs'
import { ErrorAlert, Text } from './ui'

// The demo accounts "Load test data" makes (migrations 20 and 33), one per role to test.
// "Test as" only ever signs in to these; real accounts have no password and can't be used.
const demoAccounts = [
  { email: 'owner1@demo.test', name: 'TEST Event Owner 1', role: 'Event owner', detail: 'Owner of TEST One-Day Card' },
  { email: 'owner2@demo.test', name: 'TEST Event Owner 2', role: 'Event owner', detail: 'Owner of TEST Multi-Day Open' },
  { email: 'official1@demo.test', name: 'TEST Official 1', role: 'Official', detail: 'Chief Official of TEST One-Day Card, Deputy of TEST Multi-Day Open' },
  { email: 'official2@demo.test', name: 'TEST Official 2', role: 'Official', detail: 'Chief Official of TEST Multi-Day Open, Deputy of TEST One-Day Card' },
  { email: 'official@demo.test', name: 'TEST Demo Official', role: 'Official', detail: 'An accepted official on both TEST events (not Chief or Deputy)' },
  { email: 'club-owner@demo.test', name: 'TEST Demo Club Owner', role: 'Club owner', detail: 'Owner of TEST North End Boxing' },
  { email: 'event-owner@demo.test', name: 'TEST Demo Event Owner', role: 'User', detail: 'A plain User: a viewer on both TEST events, can request new events' },
]

const accountFor = (email) => demoAccounts.find((a) => a.email === email?.toLowerCase())

const options = demoAccounts.map((a) => ({
  value: a.email,
  label: `${a.role}: ${a.email}`,
  title: a.detail,
}))

// Picks a demo account and signs in as it. Used on Admin > Test data and in the test-run bar.
export function TestAsPicker({ currentEmail, placeholder = 'Pick a role to test…', size }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function actAs(email) {
    if (!email || email === currentEmail) return
    setBusy(true)
    setError(null)
    try {
      await api.actAsDemo(email)
      window.location.hash = 'home'
      window.scrollTo(0, 0)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Select
        aria-label="Test as"
        size={size}
        value={accountFor(currentEmail) ? currentEmail : undefined}
        placeholder={placeholder}
        onChange={actAs}
        loading={busy}
        disabled={busy}
        options={options}
        optionRender={(option) => (
          <div>
            <div>{option.label}</div>
            <Text type="secondary" style={{ fontSize: 15 }}>{option.data.title}</Text>
          </div>
        )}
        popupMatchSelectWidth={false}
        style={{ minWidth: 260 }}
      />
      <ErrorAlert>{error}</ErrorAlert>
    </>
  )
}

// The gold "View as" button in the header for site Admins: search for any real person and see
// the app exactly as they do (read-only). Demo roles aren't listed; they're on Admin > Test data.
const accountLabels = { admin: 'Admin', user: 'User', official: 'Official', public: 'Public' }

export function ViewAsMenu({ myId }) {
  const [open, setOpen] = useState(false)
  const [people, setPeople] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || people) return
    api.listUsers()
      .then((all) => setPeople(all.filter((u) => u.id && u.id !== myId && !/@demo\.test$/i.test(u.email ?? ''))))
      .catch((err) => { showError(err.message); setPeople([]) })
  }, [open, people, myId])

  async function viewAs(id) {
    const person = people.find((u) => u.id === id)
    if (!person) return
    setBusy(true)
    try {
      await api.startViewAs(person)
      setOpen(false)
      window.location.hash = 'home'
      window.scrollTo(0, 0)
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const options = (people ?? []).map((u) => ({
    value: u.id,
    label: u.name || u.email,
    search: `${u.name ?? ''} ${u.email ?? ''} ${u.role_name ?? ''}`.toLowerCase(),
    email: u.email,
    role: accountLabels[u.role_id] ?? u.role_name,
  }))

  const picker = (
    <div className="view-as-picker">
      <Select
        aria-label="View as"
        showSearch
        autoFocus
        defaultOpen
        placeholder="Search by name or email…"
        loading={!people || busy}
        disabled={busy}
        onChange={viewAs}
        options={options}
        filterOption={(input, option) => option.search.includes(input.toLowerCase())}
        optionRender={(option) => (
          <div className="test-as-item">
            <div><strong>{option.data.label}</strong>{option.data.role ? ` · ${option.data.role}` : ''}</div>
            <Text type="secondary" style={{ fontSize: 15 }}>{option.data.email}</Text>
          </div>
        )}
        notFoundContent={people ? 'Nobody matches' : 'Loading people…'}
        style={{ width: '100%' }}
        getPopupContainer={(node) => node.parentElement}
      />
      <Text type="secondary" style={{ fontSize: 15 }}>
        Read-only: you see exactly what they see. To try the demo roles, use Admin &gt; Test data.
      </Text>
    </div>
  )

  return (
    <Popover content={picker} trigger="click" open={open} onOpenChange={setOpen} placement="bottomRight" destroyOnHidden>
      <Button type="primary" icon={<EyeOutlined />} aria-label="View as" title="See the app as another person">
        <span className="test-as-label">View as</span> <DownOutlined />
      </Button>
    </Popover>
  )
}

// Shown on every page while a site Admin is acting as a demo account: who you are now,
// a quick switch to another role, and the way back to your own account.
export function TestingBar({ email }) {
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const from = api.mode === 'supabase' ? api.testingFrom() : null
  if (!from) return null
  const account = accountFor(email)

  async function back() {
    setBusy(true)
    setError(null)
    try {
      await api.backToMyAccount()
      window.location.hash = 'admin'
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Alert
      className="demo-banner testing-bar"
      type="warning"
      title={
        <>
          <span>
            <strong>Test run</strong> as <strong>{email}</strong>
            {account ? `: ${account.detail}` : ''}
          </span>
          <span className="testing-bar-switch">
            Switch to <TestAsPicker currentEmail={email} />
          </span>
          <Button icon={<RollbackOutlined />} loading={busy} onClick={back}>
            Back to {from.name || from.email}
          </Button>
          <ErrorAlert>{error}</ErrorAlert>
        </>
      }
    />
  )
}

// Shown on every page while a site Admin uses View as: whose view this is, that it's read-only,
// and the way back.
export function ViewingBar({ viewing }) {
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  if (!viewing) return null

  async function back() {
    setBusy(true)
    setError(null)
    try {
      await api.stopViewAs()
      window.location.hash = 'admin'
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Alert
      className="demo-banner testing-bar"
      type="warning"
      title={
        <>
          <span>
            <EyeOutlined /> <strong>Viewing as {viewing.name}</strong>
            {viewing.email && viewing.email !== viewing.name ? ` (${viewing.email})` : ''}.
            {' '}Read-only: you see exactly what they see, but nothing can be changed.
          </span>
          <Button icon={<RollbackOutlined />} loading={busy} onClick={back}>Back to my account</Button>
          <ErrorAlert>{error}</ErrorAlert>
        </>
      }
    />
  )
}
