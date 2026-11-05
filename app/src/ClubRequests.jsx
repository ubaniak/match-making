import { useCallback, useEffect, useState } from 'react'
import { Button, Input, Modal, Space } from 'antd'
import DataTable from './DataTable'
import { api } from './api'
import { askConfirm, askText, dash } from './dialogs'
import { sendWelcome } from './welcome'
import WelcomeNotice from './WelcomeNotice'
import { Badge, ErrorAlert, Field, FormCard, FullRow, Muted, Section, SuccessAlert } from './ui'

// New clubs need a site Admin's approval (migration 60). Anyone else asks for one here, with a
// required owner email: that person becomes its Owner. From an event they run, the club is invited to it once approved.

const statusLabels = { pending: 'Waiting for Admin', approved: 'Approved', denied: 'Declined', withdrawn: 'Withdrawn' }
const personName = (user) => (user ? user.name || user.email : '—')
const formatWhen = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const blank = { name: '', contactName: '', contactEmail: '', note: '' }

function useClubRequests(filter) {
  const [requests, setRequests] = useState(null)
  const [error, setError] = useState(null)
  const eventId = filter?.eventId
  const reload = useCallback(async () => {
    try {
      setRequests(await api.listClubRequests(eventId ? { eventId } : {}))
    } catch (err) {
      setError(err.message)
    }
  }, [eventId])
  useEffect(() => {
    reload()
  }, [reload])
  return { requests, error, setError, reload }
}

function StatusBadge({ status }) {
  return <Badge strong={status === 'approved'} muted={status === 'denied' || status === 'withdrawn'}>{statusLabels[status] ?? status}</Badge>
}

// The form to ask for a new club, and the asker's own requests under it.
export function RequestClub({ eventId, title = 'Request a new club', intro }) {
  const { requests, error: listError, reload } = useClubRequests({ eventId })
  const [form, setForm] = useState(blank)
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(null)
  const [busy, setBusy] = useState(false)
  const field = (key) => ({ value: form[key], onChange: (e) => setForm({ ...form, [key]: e.target.value }) })

  async function send(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSent(null)
    try {
      await api.requestClub({ ...form, eventId })
      setSent(`Sent. A site Admin will look at ${form.name.trim()} and you'll get an alert when they decide.`)
      setForm(blank)
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function withdraw(r) {
    if (!(await askConfirm(`Withdraw your request for ${r.name}?`, { okText: 'Withdraw' }))) return
    setError(null)
    try {
      await api.withdrawClubRequest(r.id)
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  const columns = [
    { title: 'Club', dataIndex: 'name', key: 'name' },
    { title: 'Owner', key: 'contact', value: (r) => `${r.contact_name} ${r.contact_email}`, render: (_, r) => `${r.contact_name} (${r.contact_email})` },
    ...(eventId ? [] : [{ title: 'For event', key: 'event', value: (r) => r.event?.name ?? '', render: (_, r) => dash(r.event?.name) }]),
    { title: 'Asked', key: 'asked', value: (r) => r.requested_at, render: (_, r) => formatWhen(r.requested_at) },
    { title: 'Status', key: 'status', value: (r) => statusLabels[r.status], render: (_, r) => <StatusBadge status={r.status} /> },
    { title: 'Admin note', key: 'note', value: (r) => r.decision_note ?? '', render: (_, r) => dash(r.decision_note) },
    {
      key: 'actions',
      className: 'actions',
      render: (_, r) => r.status === 'pending' && <Button size="small" onClick={() => withdraw(r)}>Withdraw</Button>,
    },
  ]

  return (
    <>
      <FormCard
        compact
        title={title}
        onSubmit={send}
        actions={<Button type="primary" htmlType="submit" disabled={busy || !form.name.trim() || !form.contactName.trim() || !form.contactEmail.trim()}>Send to Admin</Button>}
      >
        <Field label="Club name"><Input {...field('name')} maxLength={120} placeholder="e.g. Riverside Boxing" /></Field>
        <Field label="Owner name" hint="who runs the club"><Input {...field('contactName')} maxLength={120} placeholder="e.g. Maria Lopez" /></Field>
        <Field label="Owner email" hint="required: they sign in with it"><Input type="email" required {...field('contactEmail')} maxLength={200} placeholder="maria@example.com" /></Field>
        <Field label="Note for the Admin" hint="optional"><Input {...field('note')} maxLength={500} placeholder="e.g. New club in Brandon, coach is Boxing Canada certified" /></Field>
        <FullRow>
          <Muted>{intro ?? 'Only clubs already in the app can be invited. A site Admin checks a new club and its owner first. Once approved, the owner email becomes the club\'s Owner and can sign in.'}</Muted>
        </FullRow>
      </FormCard>
      <SuccessAlert>{sent}</SuccessAlert>
      <ErrorAlert>{error || listError}</ErrorAlert>
      {requests?.length > 0 && (
        <DataTable rowKey="id" columns={columns} dataSource={requests} csvName="Club requests" />
      )}
    </>
  )
}

// Site Admins: requests waiting for a decision, and past ones.
export function AdminClubRequests({ onChange }) {
  const { requests, error, setError, reload } = useClubRequests()
  const [approving, setApproving] = useState(null) // { request, name, note }
  const [busy, setBusy] = useState(false)
  const [showPast, setShowPast] = useState(false)
  const [welcome, setWelcome] = useState(null)

  async function run(action) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await reload()
      onChange?.()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function approve() {
    const { request, name, note } = approving
    let result = null
    const ok = await run(async () => {
      result = await api.decideClubRequest(request.id, true, { name, note })
    })
    if (!ok) return
    setApproving(null)
    if (result?.new_account) setWelcome(await sendWelcome({ name: request.contact_name, email: result.email, roleId: 'member' }))
  }

  async function deny(r) {
    const reason = await askText(`Decline the request for ${r.name}?`, { okText: 'Decline', placeholder: 'Reason (optional, the person who asked sees it)' })
    if (reason === null) return
    run(() => api.decideClubRequest(r.id, false, { note: reason }))
  }

  async function remove(r) {
    if (!(await askConfirm(`Delete the request for ${r.name}? This only removes the record.`, { okText: 'Delete', danger: true }))) return
    run(() => api.deleteClubRequest(r.id))
  }

  if (!requests && !error) return null
  const pending = (requests ?? []).filter((r) => r.status === 'pending')
  const past = (requests ?? []).filter((r) => r.status !== 'pending')
  if (pending.length === 0 && past.length === 0 && !error && !welcome) return null

  const columns = (open) => [
    { title: 'Club', dataIndex: 'name', key: 'name' },
    { title: 'Owner', key: 'contact', value: (r) => `${r.contact_name} ${r.contact_email}`, render: (_, r) => `${r.contact_name} (${r.contact_email})` },
    { title: 'Asked by', key: 'by', value: (r) => personName(r.requester), render: (_, r) => personName(r.requester) },
    { title: 'For event', key: 'event', value: (r) => r.event?.name ?? '', render: (_, r) => dash(r.event?.name) },
    { title: 'Note', key: 'note', value: (r) => r.note ?? '', render: (_, r) => dash(r.note) },
    { title: 'Asked', key: 'asked', value: (r) => r.requested_at, render: (_, r) => formatWhen(r.requested_at) },
    ...(open ? [] : [
      { title: 'Status', key: 'status', value: (r) => statusLabels[r.status], render: (_, r) => <StatusBadge status={r.status} /> },
      { title: 'Admin note', key: 'decision', value: (r) => r.decision_note ?? '', render: (_, r) => dash(r.decision_note) },
    ]),
    {
      key: 'actions',
      className: 'actions',
      render: (_, r) => (open ? (
        <Space>
          <Button size="small" type="primary" disabled={busy} onClick={() => setApproving({ request: r, name: r.name, note: '' })}>Approve</Button>
          <Button size="small" disabled={busy} onClick={() => deny(r)}>Decline</Button>
        </Space>
      ) : (
        <Button size="small" disabled={busy} onClick={() => remove(r)}>Delete</Button>
      )),
    },
  ]

  return (
    <Section
      title={`New club requests (${pending.length})`}
      extra={past.length > 0 && <Button size="small" onClick={() => setShowPast(!showPast)}>{showPast ? 'Hide past requests' : `Past requests (${past.length})`}</Button>}
    >
      <WelcomeNotice welcome={welcome} onDismiss={() => setWelcome(null)} />
      <ErrorAlert>{error}</ErrorAlert>
      {pending.length > 0
        ? <DataTable rowKey="id" columns={columns(true)} dataSource={pending} csvName="Club requests" />
        : <Muted>Nothing waiting.</Muted>}
      {showPast && past.length > 0 && <DataTable rowKey="id" columns={columns(false)} dataSource={past} csvName="Past club requests" />}
      <Modal
        open={Boolean(approving)}
        title={`Approve ${approving?.request.name ?? ''}`}
        okText="Approve and create club"
        okButtonProps={{ disabled: busy || !approving?.name.trim(), loading: busy }}
        onOk={approve}
        onCancel={() => setApproving(null)}
      >
        {approving && (
          <>
            <Field label="Club name" hint="fix the spelling if needed">
              <Input value={approving.name} onChange={(e) => setApproving({ ...approving, name: e.target.value })} maxLength={120} />
            </Field>
            <Field label="Note to the person who asked" hint="optional">
              <Input value={approving.note} onChange={(e) => setApproving({ ...approving, note: e.target.value })} maxLength={500} />
            </Field>
            <Muted>
              {approving.request.contact_name} ({approving.request.contact_email}) becomes the club&apos;s Owner
              {approving.request.event?.name ? `, and the club is invited to ${approving.request.event.name}` : ''}.
              {' '}If they have no account yet, they get one and we email them how to sign in.
            </Muted>
            <ErrorAlert>{error}</ErrorAlert>
          </>
        )}
      </Modal>
    </Section>
  )
}
