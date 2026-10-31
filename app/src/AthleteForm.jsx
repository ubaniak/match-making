import { useState } from 'react'
import { athleteProblems, genders } from './athletes'

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

  const field = (key) => ({ value: form[key], onChange: (e) => setForm({ ...form, [key]: e.target.value }) })
  const activeUsers = (users ?? []).filter((u) => u.id && u.state === 'Active')

  return (
    <>
      <form onSubmit={save} className="row-form">
        <h2>{title ?? (editing ? `Edit ${athlete.name}` : 'Add an athlete')}</h2>
        <label>Name<input required {...field('name')} /></label>
        {!editing && (
          <label>Email <span className="muted">(optional, lets them sign in)</span><input type="email" {...field('email')} /></label>
        )}
        <label>
          Coach <span className="muted">(optional)</span>
          <select {...field('coachId')}>
            <option value="">No coach</option>
            {activeUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name || u.email}</option>
            ))}
          </select>
        </label>
        <label>Date of birth<input type="date" required {...field('dateOfBirth')} /></label>
        <label>
          Gender
          <select required {...field('gender')}>
            <option value="">Choose…</option>
            {genders.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Weight (kg)<input type="number" required min="20" max="200" step="0.1" {...field('weightKg')} /></label>
        <label>Experience (bouts)<input type="number" required min="0" max="1000" step="1" {...field('bouts')} /></label>
        {clubs && !editing && (
          <label>
            Club
            <select required {...field('clubId')}>
              <option value="">{clubs.length ? 'Choose a club…' : 'Create a club first'}</option>
              {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add athlete'}</button>
        {onCancel && <button type="button" className="secondary" onClick={onCancel}>Cancel</button>}
      </form>
      {message && <p className={message.error ? 'error' : 'success'}>{message.text}</p>}
    </>
  )
}
