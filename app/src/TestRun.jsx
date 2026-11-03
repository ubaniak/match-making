import { useState } from 'react'
import { Alert, Button, Select } from 'antd'
import { RollbackOutlined } from '@ant-design/icons'
import { api } from './api'
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
