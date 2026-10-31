// Competition categories for an athlete entered into an event: age, weight and experience.
// Sources and the reasoning behind each table are in plan/categories.md. In short:
//   - World Boxing Competition Rules (Feb 2024, v3.99) for the age groups and weight tables.
//   - Boxing Canada's domestic rules, as applied in Boxing Ontario's 2025 match guidelines, where
//     they differ or add to World Boxing (U13, Fun Box, Masters at 40, Novice/Open).

// Age is judged by calendar year of birth (World Boxing rule 2.1.1): the age a boxer turns in the
// year of the event, whatever their birthday. A multi-day event uses its start date.
export function competitionAge(dateOfBirth, eventDate) {
  if (!dateOfBirth || !eventDate) return null
  return Number(eventDate.slice(0, 4)) - Number(dateOfBirth.slice(0, 4))
}

export const ageCategories = [
  { key: 'funbox', label: 'Fun Box', min: 6, max: 10 },
  { key: 'u13', label: 'U13', min: 11, max: 12 },
  { key: 'u15', label: 'U15', min: 13, max: 14 },
  { key: 'u17', label: 'U17', min: 15, max: 16 },
  { key: 'u19', label: 'U19', min: 17, max: 18 },
  { key: 'elite', label: 'Elite', min: 19, max: 39 },
  { key: 'masters', label: 'Masters', min: 40, max: Infinity },
]

export function ageCategory(dateOfBirth, eventDate) {
  const age = competitionAge(dateOfBirth, eventDate)
  if (age == null || Number.isNaN(age)) return null
  const category = ageCategories.find((c) => age >= c.min && age <= c.max)
  return category ? { ...category, age } : { key: 'too-young', label: 'Too young', age }
}

// Weight tables, lightest first. A boxer is in a class when they weigh more than its lower limit
// and no more than its upper limit (`max: null` is the open-ended heaviest class).
const juniorClasses = [
  ['Pinweight', 44, 46],
  ['Light Flyweight', 46, 48],
  ['Flyweight', 48, 50],
  ['Light Bantamweight', 50, 52],
  ['Bantamweight', 52, 54],
  ['Featherweight', 54, 57],
  ['Lightweight', 57, 60],
  ['Light Welterweight', 60, 63],
  ['Welterweight', 63, 66],
  ['Light Middleweight', 66, 70],
  ['Middleweight', 70, 75],
  ['Light Heavyweight', 75, 80],
  ['Heavyweight', 80, null],
]

// World Boxing's U19 tables, which are also its Elite tables from 1 January 2025.
const menClasses = [
  ['Flyweight', 47, 50],
  ['Bantamweight', 50, 55],
  ['Lightweight', 55, 60],
  ['Welterweight', 60, 65],
  ['Light Middleweight', 65, 70],
  ['Middleweight', 70, 75],
  ['Light Heavyweight', 75, 80],
  ['Cruiserweight', 80, 85],
  ['Heavyweight', 85, 90],
  ['Super Heavyweight', 90, null],
]

const womenClasses = [
  ['Light Flyweight', 45, 48],
  ['Flyweight', 48, 51],
  ['Bantamweight', 51, 54],
  ['Featherweight', 54, 57],
  ['Lightweight', 57, 60],
  ['Welterweight', 60, 65],
  ['Light Middleweight', 65, 70],
  ['Middleweight', 70, 75],
  ['Light Heavyweight', 75, 80],
  ['Heavyweight', 80, null],
]

export function weightTable(ageKey, gender) {
  if (['u13', 'u15', 'u17'].includes(ageKey)) return juniorClasses
  if (['u19', 'elite', 'masters'].includes(ageKey)) return gender === 'female' ? womenClasses : gender === 'male' ? menClasses : null
  return null // Fun Box has no classes: boxers are matched within 3 kg.
}

export function weightCategory(weightKg, ageKey, gender) {
  if (weightKg == null || weightKg === '') return null
  const kg = Number(weightKg)
  const table = weightTable(ageKey, gender)
  if (!table) return null
  const [, lightestMin] = table[0]
  if (kg <= lightestMin) return { key: `-${lightestMin}`, label: `Under ${lightestMin} kg`, name: 'Below the lightest class', order: 0, below: true }
  const index = table.findIndex(([, , max]) => max == null || kg <= max)
  const [name, min, max] = table[index]
  return { key: max == null ? `+${min}` : `${max}`, label: max == null ? `+${min} kg` : `${max} kg`, name, order: index + 1 }
}

// Boxing Canada: Novice is 10 bouts or fewer (exhibitions count), Open is more than 10.
export const NOVICE_MAX_BOUTS = 10

export function experienceCategory(bouts) {
  if (bouts == null || bouts === '') return null
  return Number(bouts) <= NOVICE_MAX_BOUTS ? { key: 'novice', label: 'Novice' } : { key: 'open', label: 'Open' }
}

export function categorise(athlete, eventDate) {
  const age = ageCategory(athlete.date_of_birth, eventDate)
  return {
    age,
    weight: age ? weightCategory(athlete.weight_kg, age.key, athlete.gender) : null,
    experience: experienceCategory(athlete.bouts),
  }
}

const ageOrder = (key) => {
  const index = ageCategories.findIndex((c) => c.key === key)
  return index === -1 ? -1 : index
}

// Sorts entered athletes into their divisions: age group, then gender, then weight class, then
// experience, so boxers who could meet sit next to each other.
export function compareByCategory(a, b) {
  return (
    ageOrder(a.categories.age?.key) - ageOrder(b.categories.age?.key) ||
    (a.gender ?? '').localeCompare(b.gender ?? '') ||
    (a.categories.weight?.order ?? 0) - (b.categories.weight?.order ?? 0) ||
    Number(a.weight_kg ?? 0) - Number(b.weight_kg ?? 0) ||
    (a.categories.experience?.key ?? '').localeCompare(b.categories.experience?.key ?? '') ||
    a.name.localeCompare(b.name)
  )
}
