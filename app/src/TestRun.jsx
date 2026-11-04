import { useEffect, useState } from 'react'
import { Alert, Button, Popover, Select } from 'antd'
import { DownOutlined, EyeOutlined, RollbackOutlined } from '@ant-design/icons'
import { api } from './api'
import { showError } from './dialogs'
import { ErrorAlert, Text } from './ui'

// The gold "View as" button in the header for site Admins: search for any real person and see
// the app exactly as they do (read-only). Demo accounts aren't listed: sign in as them instead.
const accountLabels = { admin: 'Admin', member: 'Member' }

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
        Read-only: you see exactly what they see. To try the demo accounts, sign in as them (Admin &gt; Test data lists them).
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
