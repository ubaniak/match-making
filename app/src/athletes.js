// The details every athlete needs, and how they're shown. Matches the checks in
// supabase/migrations/20261031220000_athlete_details.sql (the club is a club record since 20261101010000_clubs.sql).

export const genders = [['male', 'Male'], ['female', 'Female']]
export const genderLabel = (gender) => genders.find(([value]) => value === gender)?.[1] ?? '—'

export const formatWeight = (kg) => (kg == null || kg === '' ? '—' : `${Number(kg)} kg`)
export const formatBouts = (bouts) => (bouts == null || bouts === '' ? '—' : `${bouts} ${Number(bouts) === 1 ? 'bout' : 'bouts'}`)

// Problems with an athlete's details, as messages. Empty when all is well.
export function athleteProblems({ name, date_of_birth, gender, weight_kg, bouts, club_id, last_medical }) {
  const problems = []
  if (!name?.trim()) problems.push('Name is missing')
  if (!date_of_birth) problems.push('Date of birth is missing')
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(date_of_birth) || Number.isNaN(Date.parse(date_of_birth))) {
    problems.push(`Date of birth "${date_of_birth}" should look like 2004-03-12`)
  }
  if (!gender) problems.push('Gender is missing')
  else if (!genders.some(([value]) => value === gender)) problems.push(`Gender "${gender}" should be male or female`)
  if (weight_kg === '' || weight_kg == null) problems.push('Weight is missing')
  else if (!(Number(weight_kg) >= 20 && Number(weight_kg) <= 200)) problems.push(`Weight "${weight_kg}" should be in kg, between 20 and 200`)
  if (bouts === '' || bouts == null) problems.push('Experience (number of bouts) is missing')
  else if (!Number.isInteger(Number(bouts)) || Number(bouts) < 0 || Number(bouts) > 1000) problems.push(`Bouts "${bouts}" should be a whole number, 0 or more`)
  if (!club_id) problems.push('Club is missing')
  // Optional (migration 40): the date of the athlete's last medical.
  if (last_medical && (!/^\d{4}-\d{2}-\d{2}$/.test(last_medical) || Number.isNaN(Date.parse(last_medical)))) {
    problems.push(`Last medical "${last_medical}" should look like 2026-09-15`)
  }
  return problems
}

// Optional details (migration 40). Blank text is saved as null.
export const cleanText = (text) => (text ?? '').toString().trim() || null
export const formatLevel = (level) => (level == null || level === '' ? '—' : `Level ${level}`)

// An athlete can be in the system only once, across every club (migration 57,
// 20261104160000_unique_athletes.sql). The same athlete is the same name and date of birth
// (ignoring case and extra spaces), or the same BC number (ignoring case).
export const athleteNameKey = (name) => (name ?? '').toString().trim().replace(/\s+/g, ' ').toLowerCase()
export const athleteBcKey = (bc) => (bc ?? '').toString().trim().toLowerCase() || null

// Says who already has the athlete. match is { matched_on, athlete_name, club_name }.
export function duplicateAthleteText({ matched_on, athlete_name, club_name }) {
  const where = club_name ? ` in ${club_name}` : ''
  return matched_on === 'bc_number'
    ? `Already in the system: ${athlete_name}${where} has this BC number`
    : `Already in the system: ${athlete_name}${where}, same name and date of birth`
}

// Matches in a list of athletes (demo mode, which can see everyone). Same shape as the
// find_athlete_duplicates database function.
export function findDuplicatesIn(athletes, rows, ignoreId, clubName = () => null) {
  const found = []
  rows.forEach((row, index) => {
    const bc = athleteBcKey(row.bc_number)
    const name = athleteNameKey(row.name)
    for (const a of athletes) {
      if (a.id === ignoreId) continue
      const sameBc = bc && athleteBcKey(a.bc_number) === bc
      const sameName = row.date_of_birth && a.date_of_birth === row.date_of_birth && athleteNameKey(a.name) === name
      if (sameBc || sameName) found.push({ row_index: index, matched_on: sameBc ? 'bc_number' : 'name_dob', athlete_name: a.name, club_name: clubName(a.club_id) })
    }
  })
  return found
}
