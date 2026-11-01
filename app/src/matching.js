// Match rules for pairing two boxers (plan/categories.md "Matching rules" and plan/events.md
// section 4). checkMatch says whether a bout is allowed, and lists the gaps to warn about.
//
//   blocks:          reasons the bout can't be made (male v female, outside an allowance,
//                    missing details)
//   warnings:        gaps inside the allowances, shown to coaches and officials
//   needsSupervisor: U17 v U19, which only the Chief Official or Deputy can approve
import { ageCategory, experienceCategory, weightCategory } from './categories'

const fmtKg = (kg) => `${Math.round(kg * 10) / 10} kg`

// Whole months between two dates of birth ('YYYY-MM-DD').
export function monthsApart(a, b) {
  const [early, late] = [a, b].sort()
  const [y1, m1, d1] = early.split('-').map(Number)
  const [y2, m2, d2] = late.split('-').map(Number)
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0)
}

// Allowed weight difference (kg) when two boxers are in different classes, from the lighter
// boxer's age group, gender and weight. Infinity means no limit.
export function weightAllowance(ageKey, gender, kg) {
  if (ageKey === 'funbox') return 3
  if (ageKey === 'masters') return 5
  if (['u13', 'u15', 'u17'].includes(ageKey)) {
    if (kg <= 54) return 3
    if (kg <= 66) return 4
    if (kg <= 80) return 5
    return Infinity
  }
  if (gender === 'female') {
    if (kg <= 60) return 3
    if (kg <= 80) return 5
    return Infinity
  }
  return kg <= 90 ? 5 : Infinity
}

const juniors = ['u13', 'u15', 'u17', 'u19']
const ageLabel = { funbox: 'Fun Box', u13: 'U13', u15: 'U15', u17: 'U17', u19: 'U19', elite: 'Elite', masters: 'Masters' }

// a, b: athletes ({ name, date_of_birth, gender, weight_kg, bouts }). eventDate: the event's start
// date. weights: optional { [athleteId]: kg } from the weigh-in, used instead of weight_kg.
export function checkMatch(a, b, eventDate, weights = {}) {
  const blocks = []
  const warnings = []
  let needsSupervisor = false

  if (!a || !b) return { blocks: ['Pick two athletes.'], warnings, needsSupervisor }
  if (a.id && a.id === b.id) return { blocks: ['Pick two different athletes.'], warnings, needsSupervisor }

  const missing = [a, b].flatMap((x) =>
    [!x.date_of_birth && 'date of birth', !x.gender && 'gender', (x.weight_kg == null || x.weight_kg === '') && 'weight', (x.bouts == null || x.bouts === '') && 'experience']
      .filter(Boolean).map((what) => `${x.name} has no ${what}.`),
  )
  if (missing.length) return { blocks: missing, warnings, needsSupervisor }

  if (a.gender !== b.gender) blocks.push('Male and female athletes can\'t box each other.')

  // Age
  const ageA = ageCategory(a.date_of_birth, eventDate)
  const ageB = ageCategory(b.date_of_birth, eventDate)
  for (const [x, age] of [[a, ageA], [b, ageB]]) {
    if (age?.key === 'too-young') blocks.push(`${x.name} is too young to box.`)
  }
  const months = monthsApart(a.date_of_birth, b.date_of_birth)
  const ka = ageA?.key
  const kb = ageB?.key
  if (ka && kb && ka !== 'too-young' && kb !== 'too-young') {
    const pair = [ka, kb].sort((x, y) => juniors.indexOf(x) - juniors.indexOf(y)).join('-')
    const ages = `${ageLabel[ka]} vs ${ageLabel[kb]}`
    if (ka === kb) {
      if ((juniors.includes(ka) || ka === 'funbox') && months > 12) blocks.push(`${months} months apart in age; ${ageLabel[ka]} allows 12.`)
      else if (ka === 'masters' && months > 120) blocks.push(`${Math.floor(months / 12)} years apart in age; Masters allows 10.`)
      else if (months > 0 && ka !== 'elite') warnings.push(`${months} months apart in age`)
    } else if (pair === 'u13-u15' || pair === 'u15-u17') {
      if (months > 24) blocks.push(`${ages}: ${months} months apart; at most 24 allowed.`)
      else warnings.push(`${ages}, ${months} months apart`)
    } else if (pair === 'u17-u19') {
      needsSupervisor = true
      warnings.push(`${ages}: needs the Chief Official's approval`)
    } else if ([ka, kb].includes('funbox') && [ka, kb].includes('u13')) {
      if (months > 12) blocks.push(`Fun Box vs U13: ${months} months apart; at most 12 allowed.`)
      else warnings.push(`Fun Box vs U13, ${months} months apart`)
    } else if ([ka, kb].includes('u19') && [ka, kb].includes('elite')) {
      const youth = ka === 'u19' ? a : b
      const youthAge = ka === 'u19' ? ageA.age : ageB.age
      if (youthAge === 18 && experienceCategory(youth.bouts)?.key === 'open') warnings.push(`${youth.name} (U19) boxing up in Elite`)
      else blocks.push(`A U19 can box Elite only in their 18th year, as Open with at least 10 bouts.`)
    } else {
      blocks.push(`${ages} isn't allowed.`)
    }
  }

  // Experience
  const ea = experienceCategory(a.bouts)
  const eb = experienceCategory(b.bouts)
  const gap = Math.abs(Number(a.bouts) - Number(b.bouts))
  if ([ka, kb].includes('funbox')) {
    if (gap > 10) blocks.push(`${gap} bouts apart; Fun Box allows 10.`)
    else if (gap > 0) warnings.push(`${gap} bouts apart`)
  } else if (ea.key === 'novice' && eb.key === 'novice') {
    if (gap > 7) blocks.push(`Novice vs Novice, ${gap} bouts apart; at most 7 allowed.`)
    else if (gap > 0) warnings.push(`${gap} bouts apart`)
  } else if (ea.key !== eb.key) {
    if (gap > 5) blocks.push(`Novice vs Open, ${gap} bouts apart; at most 5 allowed.`)
    else warnings.push(`Novice vs Open, ${gap} bouts apart`)
  } else if (gap > 0) {
    warnings.push(`Open vs Open, ${gap} bouts apart`)
  }

  // Weight (the weigh-in weight when there is one)
  const kgA = Number(weights[a.id] ?? a.weight_kg)
  const kgB = Number(weights[b.id] ?? b.weight_kg)
  const diff = Math.abs(kgA - kgB)
  if (ka && kb && ka !== 'too-young' && kb !== 'too-young') {
    const wa = weightCategory(kgA, ka, a.gender)
    const wb = weightCategory(kgB, kb, b.gender)
    const sameClass = wa && wb && ka === kb && wa.key === wb.key
    if (!sameClass) {
      const [lighter, lighterAge, lighterKg] = kgA <= kgB ? [a, ka, kgA] : [b, kb, kgB]
      const allowance = weightAllowance(lighterAge, lighter.gender, lighterKg)
      if (diff > allowance) blocks.push(`${fmtKg(diff)} apart; at most ${fmtKg(allowance)} allowed here.`)
      else if (diff > 0) warnings.push(`Different weight classes, ${fmtKg(diff)} apart`)
    } else if (diff > 0) {
      warnings.push(`${fmtKg(diff)} apart`)
    }
  }

  return { blocks, warnings, needsSupervisor }
}

// How far apart two boxers are, for sorting "Best match" opponents: lower is closer. A kilo, a bout
// and a year of age each count about the same; a U17 v U19 pairing (needs the Chief Official) sorts
// after every pairing that doesn't.
export function matchDistance(a, b, eventDate, weights = {}, check = checkMatch(a, b, eventDate, weights)) {
  const kg = Math.abs(Number(weights[a.id] ?? a.weight_kg) - Number(weights[b.id] ?? b.weight_kg))
  const bouts = Math.abs(Number(a.bouts) - Number(b.bouts))
  const years = monthsApart(a.date_of_birth, b.date_of_birth) / 12
  return (check.needsSupervisor ? 1000 : 0) + kg + bouts + years
}

const clubOf = (x) => x.entry_club_id ?? x.club_id ?? null

// "Best match": the opponents `athlete` can actually box, closest first. Leaves out anyone the rules
// block, anyone already boxing that day (taken: Set of athlete ids), and anyone from the same club.
// Returns [{ athlete, check, distance }].
export function bestOpponents(athlete, candidates, eventDate, weights = {}, taken = new Set()) {
  if (!athlete) return []
  return candidates
    .filter((b) => b.id !== athlete.id && !taken.has(b.id))
    .filter((b) => !clubOf(athlete) || clubOf(athlete) !== clubOf(b))
    .map((b) => {
      const check = checkMatch(athlete, b, eventDate, weights)
      return { athlete: b, check, distance: check.blocks.length ? Infinity : matchDistance(athlete, b, eventDate, weights, check) }
    })
    .filter((m) => m.check.blocks.length === 0)
    .sort((x, y) => x.distance - y.distance)
}
