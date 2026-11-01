import { useState } from 'react'
import { Button, Input } from 'antd'
import { athleteProblems, genders } from './athletes'
import { DateInput, Field, FormCard, FormMessage, NumberInput, Pick } from './ui'

const fromAthlete = (a) => ({
  name: a?.name ?? '',
  email: a?.invite_email ?? '',
  coachId: a?.coach_id ?? '',
  dateOfBirth: a?.date_of_birth ?? '',
  gender: a?.gender ?? '',
  weightKg: a?.weight_kg ?? '',
  bouts: a?.bouts ?? '',
  clubId: a?.club_id ?? '',
})

// Add or edit an athlete. Pass `clubs` to choose the club, or `clubId` to fix it (club pages).
// When editing, the club can't be changed here: athletes move through transfers.
export default function AthleteForm({ athlete, clubs, clubId, users, onSave, onCancel, title }) {
  const editing = Boolean(athlete)
  const [form, setForm] = useState(() => ({ ...fromAthlete(athlete), clubId: athlete?.club_id ?? clubId ?? '' }))
  const [message, setMessage] = useState(null)
  const [saving, setSaving] = useState(false)

  async function save(event) {
    event.preventDefault()
    const record = {
      name: form.name.trim(),
      coach_id: form.coachId || null,
      date_of_birth: form.dateOfBirth,
      gender: form.gender,
      weight_kg: form.weightKg === '' ? '' : Number(form.weightKg),
      bouts: form.bouts === '' ? '' : Number(form.bouts),
      club_id: form.clubId,
    }
    if (!editing) record.invite_email = form.email.trim().toLowerCase() || null
    const problems = athleteProblems(record)
    if (problems.length) return setMessage({ error: true, text: problems.join('. ') })
    if (editing) delete record.club_id
    setSaving(true)
    setMessage(null)
    try {
      await onSave(record)
    } catch (err) {
      setSaving(false)
      return setMessage({ error: true, text: err.message })
    }
    setSaving(false)
    if (!editing) {
      setMessage({ text: form.email ? `${form.name} is added. They can sign in with ${form.email} to see their profile.` : `${form.name} is added.` })
      setForm({ ...fromAthlete(null), clubId: clubId ?? '' })
    }
  }

  const set = (key) => (value) => setForm({ ...form, [key]: value })
  const text = (key) => ({ value: form[key], onChange: (e) => set(key)(e.target.value) })
  const activeUsers = (users ?? []).filter((u) => u.id && u.state === 'Active')

  return (
    <>
      <FormCard
        title={title ?? (editing ? `Edit ${athlete.name}` : 'Add an athlete')}
        onSubmit={save}
        actions={
          <>
            <Button type="primary" htmlType="submit" loading={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add athlete'}</Button>
            {onCancel && <Button onClick={onCancel}>Cancel</Button>}
          </>
        }
      >
        <Field label="Name"><Input required {...text('name')} /></Field>
        {!editing && (
          <Field label="Email" hint="optional, lets them sign in"><Input type="email" {...text('email')} /></Field>
        )}
        <Field label="Coach" hint="optional">
          <Pick
            allowEmpty
            value={form.coachId}
            onChange={set('coachId')}
            options={[{ value: '', label: 'No coach' }, ...activeUsers.map((u) => ({ value: u.id, label: u.name || u.email }))]}
          />
        </Field>
        <Field label="Date of birth"><DateInput value={form.dateOfBirth} onChange={set('dateOfBirth')} placeholder="YYYY-MM-DD" /></Field>
        <Field label="Gender">
          <Pick value={form.gender} onChange={set('gender')} placeholder="Choose…" options={genders.map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Weight (kg)"><NumberInput min={20} max={200} step={0.1} value={form.weightKg} onChange={set('weightKg')} /></Field>
        <Field label="Experience (bouts)"><NumberInput min={0} max={1000} step={1} precision={0} value={form.bouts} onChange={set('bouts')} /></Field>
        {clubs && !editing && (
          <Field label="Club">
            <Pick
              value={form.clubId}
              onChange={set('clubId')}
              placeholder={clubs.length ? 'Choose a club…' : 'Create a club first'}
              options={clubs.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Field>
        )}
      </FormCard>
      <FormMessage message={message} />
    </>
  )
}
