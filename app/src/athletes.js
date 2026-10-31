// The details every athlete needs, and how they're shown. Matches the checks in
// supabase/migrations/20261031220000_athlete_details.sql.

export const genders = [['male', 'Male'], ['female', 'Female']]
export const genderLabel = (gender) => genders.find(([value]) => value === gender)?.[1] ?? '—'

export const formatWeight = (kg) => (kg == null || kg === '' ? '—' : `${Number(kg)} kg`)
export const formatBouts = (bouts) => (bouts == null || bouts === '' ? '—' : `${bouts} ${Number(bouts) === 1 ? 'bout' : 'bouts'}`)

// Problems with an athlete's details, as messages. Empty when all is well.
export function athleteProblems({ name, date_of_birth, gender, weight_kg, bouts, club }) {
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
  if (!club?.trim()) problems.push('Club is missing')
  return problems
}
