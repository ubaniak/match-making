import { api } from './api'
import { athleteBcKey, athleteNameKey, athleteProblems, cleanText, duplicateAthleteText } from './athletes'
import { daysBetween, MAX_EVENT_DAYS } from './dates'
import { checkMatch } from './matching'

// What each CSV import expects, and how a row is checked before anything is saved.

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function checkEmail(email, errors, { required = false } = {}) {
  if (!email) {
    if (required) errors.push('Email is missing')
    return
  }
  if (!EMAIL.test(email)) errors.push(`"${email}" isn't a valid email`)
}

const lower = (text) => (text ?? '').trim().toLowerCase()
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const isDay = (text) => ISO_DAY.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`)) && new Date(`${text}T00:00:00Z`).toISOString().startsWith(text)

// Several emails in one cell, split by semicolons, commas or spaces.
const emailList = (text) => (text ?? '').split(/[;,\s]+/).map(lower).filter(Boolean)

// A user who can be given a role: they must have signed in and not be disabled.
function activeUser(email, usersByEmail, errors) {
  const user = usersByEmail?.get(lower(email))
  if (!user) errors.push(`No user with email ${lower(email)}. Add them on the Admin page first`)
  else if (!user.id) errors.push(`${lower(email)} hasn't signed in yet`)
  else if (user.state && user.state !== 'Active') errors.push(`${lower(email)} is disabled`)
  else return user
  return null
}

function validTimeZone(zone) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

// Finds one athlete by name (and club, when given) in a list. Pushes a problem when there's
// no match or more than one.
function findAthlete(list, name, club, errors, { what = 'athlete', notFound } = {}) {
  if (!name) {
    errors.push(`${what[0].toUpperCase()}${what.slice(1)} is missing`)
    return null
  }
  let matches = list.filter((a) => lower(a.name) === lower(name))
  if (club) matches = matches.filter((a) => lower(a.club) === lower(club))
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) errors.push(`${matches.length} athletes called ${name}${club ? ` in ${club}` : ''}. Add their club to tell them apart`)
  else errors.push(notFound ? notFound(name, club) : `No ${what} called ${name}${club ? ` in ${club}` : ''}`)
  return null
}

// An athlete can be in the system only once (migration 57). Flags a row that repeats an earlier
// row of the same file: same name + date of birth, same BC number, or same email.
function repeatedAthlete(athlete, errors, state) {
  state.athleteLines ??= new Map()
  const keys = [
    athlete.name && athlete.date_of_birth && ['name and date of birth', `n:${athleteNameKey(athlete.name)}|${athlete.date_of_birth}`],
    athleteBcKey(athlete.bc_number) && ['BC number', `b:${athleteBcKey(athlete.bc_number)}`],
    athlete.invite_email && ['email', `e:${athlete.invite_email}`],
  ].filter(Boolean)
  const repeat = keys.find(([, key]) => state.athleteLines.has(key))
  if (repeat) errors.push(`Same athlete as line ${state.athleteLines.get(repeat[1])} (same ${repeat[0]})`)
  for (const [, key] of keys) if (!state.athleteLines.has(key)) state.athleteLines.set(key, state.line)
}

// Asks the database which rows are athletes already in the system, in any club. Returns
// { line: problem } for the rows to skip.
async function findExistingAthletes(rows) {
  const ready = rows.filter((row) => row.errors.length === 0)
  if (!ready.length) return {}
  const matches = await api.findAthleteDuplicates(ready.map(({ value }) => ({ name: value.name, date_of_birth: value.date_of_birth, bc_number: value.bc_number })))
  const problems = {}
  for (const match of matches) {
    const line = ready[match.row_index]?.line
    if (line != null && !problems[line]) problems[line] = duplicateAthleteText(match)
  }
  return problems
}

// Older files may still say user or official: both are Members now, and official also puts them on the Officials list.
const accountIds = { admin: 'admin', member: 'member', user: 'member', official: 'member' }
const boutTypes = { scored: 'scored', developmental: 'developmental', sparring: 'sparring' }

export const importSpecs = {
  users: {
    label: 'users',
    singular: 'user',
    columns: ['name', 'email', 'account', 'official'],
    required: ['name', 'email'],
    example: [['Maria Lopez', 'maria@example.com', 'member', ''], ['Pat Kim', 'pat@example.com', 'member', 'yes']],
    notes: { account: 'admin or member; blank means member', official: 'yes adds them to the Officials list' },
    check(values, errors) {
      if (!values.name) errors.push('Name is missing')
      checkEmail(values.email, errors, { required: true })
      const account = lower(values.account) || 'member'
      if (!accountIds[account]) errors.push(`Account "${values.account}" should be admin or member`)
      const official = account === 'official' || ['yes', 'y', 'true', '1'].includes(lower(values.official))
      return { name: values.name, email: lower(values.email), roleId: accountIds[account] ?? 'member', official }
    },
  },

  athletes: {
    label: 'athletes',
    singular: 'athlete',
    columns: ['name', 'email', 'date_of_birth', 'gender', 'weight_kg', 'bouts', 'club', 'bc_number', 'last_medical'],
    required: ['name', 'date_of_birth', 'gender', 'weight_kg', 'bouts', 'club'],
    example: [
      ['Ali Hassan', 'ali@example.com', '2004-03-12', 'male', '60.5', '12', 'Eastside BC', 'BC-123456', '2026-09-15'],
      ['Jade Murphy', '', '2006-07-30', 'female', '51', '0', 'Eastside BC', '', ''],
    ],
    notes: { bc_number: 'Boxing Canada registration number, optional', last_medical: 'date of last medical, optional' },
    unique: () => null, // repeats are checked in check() below: same name + date of birth, BC number or email
    findExisting: findExistingAthletes,
    check(values, errors, { clubsByName }, state = {}) {
      checkEmail(values.email, errors)

      const athlete = {
        name: values.name ?? '',
        invite_email: (values.email ?? '').toLowerCase() || null,
        date_of_birth: values.date_of_birth ?? '',
        gender: { m: 'male', f: 'female' }[(values.gender ?? '').toLowerCase()] ?? (values.gender ?? '').toLowerCase(),
        weight_kg: values.weight_kg ?? '',
        bouts: values.bouts ?? '',
        club_id: null,
        bc_number: cleanText(values.bc_number),
        last_medical: (values.last_medical ?? '').trim() || null,
      }
      // The club must already exist; match its name ignoring case.
      const clubName = (values.club ?? '').trim()
      const club = clubName && clubsByName?.get(clubName.toLowerCase())
      if (club) athlete.club_id = club.id
      errors.push(...athleteProblems(athlete).map((p) => (p === 'Club is missing' && clubName ? `No club called "${clubName}". Create it on the Clubs page first` : p)))
      repeatedAthlete(athlete, errors, state)
      return { ...athlete, weight_kg: Number(athlete.weight_kg), bouts: Number(athlete.bouts) }
    },
  },

  // Athletes added on a club's page: the club is that club, so there's no club column.
  clubAthletes: {
    label: 'athletes',
    singular: 'athlete',
    columns: ['name', 'email', 'date_of_birth', 'gender', 'weight_kg', 'bouts', 'bc_number', 'last_medical'],
    required: ['name', 'date_of_birth', 'gender', 'weight_kg', 'bouts'],
    example: [
      ['Ali Hassan', 'ali@example.com', '2004-03-12', 'male', '60.5', '12', 'BC-123456', '2026-09-15'],
      ['Jade Murphy', '', '2006-07-30', 'female', '51', '0', '', ''],
    ],
    notes: { gender: 'male or female', bouts: 'number of bouts boxed', bc_number: 'Boxing Canada registration number, optional', last_medical: 'date of last medical, optional' },
    unique: () => null,
    findExisting: findExistingAthletes,
    check(values, errors, context, state) {
      const club = { id: context.clubId, name: context.clubName }
      return importSpecs.athletes.check({ ...values, club: club.name }, errors, { ...context, clubsByName: new Map([[lower(club.name), club]]) }, state)
    },
  },

  clubs: {
    label: 'clubs',
    singular: 'club',
    columns: ['name', 'owner_email'],
    required: ['name'],
    example: [['Eastside BC', 'maria@example.com'], ['Riverside Boxing', '']],
    notes: { owner_email: 'optional; must have signed in' },
    unique: (values) => lower(values.name),
    check(values, errors, { clubsByName, usersByEmail }) {
      const name = (values.name ?? '').trim()
      if (!name) errors.push('Name is missing')
      else if (clubsByName?.has(lower(name))) errors.push(`There's already a club called ${name}`)
      const owner = values.owner_email ? activeUser(values.owner_email, usersByEmail, errors) : null
      return { name, ownerIds: owner ? [owner.id] : [] }
    },
  },

  clubPeople: {
    label: 'people',
    singular: 'person',
    columns: ['email', 'role'],
    required: ['email'],
    example: [['maria@example.com', 'owner'], ['sam@example.com', 'coach']],
    notes: { role: 'owner or coach; blank means coach' },
    describe: (values) => values.email,
    // byEmail: a club owner only sees their own club's people, so the server looks each email up.
    check(values, errors, { usersByEmail, memberIds, byEmail }) {
      checkEmail(values.email, errors, { required: true })
      const role = lower(values.role) || 'coach'
      if (!['owner', 'coach'].includes(role)) errors.push(`Role "${values.role}" should be owner or coach`)
      if (byEmail) {
        const known = usersByEmail?.get(lower(values.email))
        if (known && memberIds?.has(known.id)) errors.push(`${lower(values.email)} is already in this club`)
        return { email: lower(values.email), role }
      }
      const user = values.email && EMAIL.test(values.email) ? activeUser(values.email, usersByEmail, errors) : null
      if (user && memberIds?.has(user.id)) errors.push(`${lower(values.email)} is already in this club`)
      return { userId: user?.id, role }
    },
  },

  events: {
    label: 'events',
    singular: 'event',
    columns: ['name', 'venue', 'start_date', 'end_date', 'owner_email', 'timezone'],
    required: ['name', 'venue', 'start_date', 'owner_email'],
    example: [
      ['Winter Box Cup', 'Eastside Community Centre', '2027-01-16', '2027-01-17', 'maria@example.com', 'America/Winnipeg'],
      ['Spring Open', 'Riverside Boxing Club, Winnipeg', '2027-04-10', '', 'maria@example.com', ''],
    ],
    notes: {
      venue: 'the bout location; drop its map pin later with Edit details',
      start_date: 'like 2027-01-16',
      end_date: 'blank means a one-day event',
      owner_email: 'must have signed in',
      timezone: 'like America/Winnipeg; blank means yours',
    },
    unique: (values) => `${lower(values.name)}|${values.start_date}`,
    check(values, errors, { usersByEmail, defaultTimeZone }) {
      const name = (values.name ?? '').trim()
      if (!name) errors.push('Name is missing')
      if (!(values.venue ?? '').trim()) errors.push('Venue (the bout location) is missing')
      const startDate = values.start_date ?? ''
      const endDate = values.end_date || startDate
      if (!startDate) errors.push('Start date is missing')
      else if (!isDay(startDate)) errors.push(`Start date "${startDate}" should look like 2027-01-16`)
      if (values.end_date && !isDay(values.end_date)) errors.push(`End date "${values.end_date}" should look like 2027-01-17`)
      else if (isDay(startDate) && isDay(endDate) && daysBetween(startDate, endDate).length === 0) {
        errors.push(endDate < startDate ? 'The end date is before the start date' : `An event can be at most ${MAX_EVENT_DAYS} days long`)
      }
      const owner = values.owner_email ? activeUser(values.owner_email, usersByEmail, errors) : null
      if (!values.owner_email) errors.push('Owner email is missing')
      const timezone = (values.timezone ?? '').trim() || defaultTimeZone
      if (!validTimeZone(timezone)) errors.push(`Time zone "${values.timezone}" isn't one we know, try something like America/Winnipeg`)
      return { name, venue: (values.venue ?? '').trim(), startDate, endDate, ownerId: owner?.id ?? '', timezone }
    },
  },



  // Clubs in an event: an existing club is invited; a new one is made with its owners and joins.
  eventClubs: {
    label: 'clubs',
    singular: 'club',
    columns: ['club', 'owner_emails'],
    required: ['club'],
    example: [['Eastside BC', ''], ['Riverside Boxing', 'maria@example.com; sam@example.com']],
    notes: { owner_emails: 'only for a new club; separate several with ;' },
    describe: (values) => values.club,
    unique: (values) => lower(values.club),
    check(values, errors, { clubsByName, statusByClub, usersByEmail, canCreate }) {
      const name = (values.club ?? '').trim()
      if (!name) {
        errors.push('Club is missing')
        return {}
      }
      const club = clubsByName?.get(lower(name))
      if (club) {
        if (statusByClub?.[club.id] === 'accepted') errors.push(`${club.name} is already in this event`)
        else if (statusByClub?.[club.id] === 'invited') errors.push(`${club.name} is already invited`)
        return { clubId: club.id }
      }
      const emails = emailList(values.owner_emails)
      if (!canCreate) errors.push(`No club called ${name}`)
      else if (emails.length === 0) errors.push(`No club called ${name}. To add it as a new club, fill in owner_emails`)
      const owners = emails.map((email) => activeUser(email, usersByEmail, errors)).filter(Boolean)
      return { name, ownerIds: owners.map((u) => u.id) }
    },
  },

  // Entering athletes in an event, by name from the clubs the uploader can enter.
  entries: {
    label: 'athletes',
    singular: 'athlete',
    columns: ['athlete', 'club', 'suggested_opponent', 'opponent_club', 'note'],
    required: ['athlete'],
    example: [['Ali Hassan', 'Eastside BC', 'Sam Lee', 'Riverside Boxing', ''], ['Jade Murphy', 'Eastside BC', '', '', '']],
    notes: {
      club: 'only needed when two athletes share a name',
      note: 'only for late entries',
    },
    describe: (values) => values.athlete,
    unique: (values, value) => value?.athleteId,
    duplicateText: (line) => `Same athlete as line ${line}`,
    check(values, errors, { available, entered }) {
      const athlete = findAthlete(available, values.athlete, values.club, errors, {
        notFound: (name, club) => (findAthlete(entered, name, club, [])
          ? `${name} is already entered or waiting for a late entry`
          : `No athlete called ${name}${club ? ` in ${club}` : ''} in your clubs in this event`),
      })
      const opponentName = (values.suggested_opponent ?? '').trim()
      const opponentClub = (values.opponent_club ?? '').trim()
      if (opponentName.length > 100 || opponentClub.length > 100) errors.push('Suggested opponent and their club can be at most 100 characters')
      if ((values.note ?? '').length > 500) errors.push('Note can be at most 500 characters')
      return { athleteId: athlete?.id, opponentName, opponentClub, note: (values.note ?? '').trim() }
    },
  },

  // Inviting officials to an event: someone on the Officials list is invited; anyone else is
  // added (with an Official account) and invited, which needs their name.
  eventOfficials: {
    label: 'officials',
    singular: 'official',
    columns: ['name', 'email'],
    required: ['email'],
    example: [['Pat Kim', 'pat@example.com']],
    notes: { name: 'needed for someone not on the Officials list yet' },
    check(values, errors, { officialsByEmail }) {
      checkEmail(values.email, errors, { required: true })
      const email = lower(values.email)
      const official = officialsByEmail?.get(email)
      if (official?.accepted) errors.push(`${official.name || email} has already accepted`)
      if (official) return { officialId: official.id, name: official.name, email }
      if (!values.name) errors.push(`${email || 'This person'} isn't on the Officials list, so their name is needed`)
      return { name: (values.name ?? '').trim(), email }
    },
  },

  // Making bouts by name. Rows that break the match rules are refused: a Developmental bout
  // with an override is made on the form, where the official gives a reason.
  bouts: {
    label: 'bouts',
    singular: 'bout',
    columns: ['day', 'red', 'red_club', 'blue', 'blue_club', 'bout_type'],
    required: ['red', 'blue'],
    example: [['2027-01-16', 'Ali Hassan', 'Eastside BC', 'Sam Lee', 'Riverside Boxing', 'scored']],
    notes: {
      day: 'like 2027-01-16; can be blank for a one-day event',
      red_club: 'only needed when two athletes share a name',
      bout_type: 'scored, developmental or sparring; blank means scored',
    },
    describe: (values) => `${values.red || '?'} vs ${values.blue || '?'}`,
    check(values, errors, { days, athletes, takenByDay, weightsByDay, lockedDays, eventDate }, state) {
      let day = values.day ?? ''
      if (!day && days.length === 1) day = days[0]
      if (!day) errors.push('Day is missing')
      else if (!days.includes(day)) errors.push(`Day "${day}" isn't a day of this event (${days[0]}${days.length > 1 ? ` to ${days[days.length - 1]}` : ''})`)
      else if (lockedDays?.has(day)) errors.push(`The weigh-in for ${day} has started, so only a Chief Official can make bouts that day`)

      const boutType = boutTypes[lower(values.bout_type) || 'scored']
      if (!boutType) errors.push(`Bout type "${values.bout_type}" should be scored, developmental or sparring`)

      const red = findAthlete(athletes, values.red, values.red_club, errors, { what: 'red corner athlete', notFound: (n, c) => `No athlete called ${n}${c ? ` in ${c}` : ''} is entered in this event` })
      const blue = findAthlete(athletes, values.blue, values.blue_club, errors, { what: 'blue corner athlete', notFound: (n, c) => `No athlete called ${n}${c ? ` in ${c}` : ''} is entered in this event` })
      if (!red || !blue || !days.includes(day)) return {}

      state.taken ??= {}
      const taken = (state.taken[day] ??= new Set(takenByDay?.[day] ?? []))
      for (const a of [red, blue]) if (taken.has(a.id)) errors.push(`${a.name} is already boxing on ${day}`)

      const check = checkMatch(red, blue, eventDate, weightsByDay?.[day] ?? {})
      errors.push(...check.blocks.map((b) => b.replace(/\.$/, '')))
      if (check.blocks.length && check.hard.length === 0) errors.push('To override the rules, make a Developmental bout on the form instead')
      if (errors.length === 0) {
        taken.add(red.id)
        taken.add(blue.id)
      }
      return { day, redId: red.id, blueId: blue.id, needsSupervisor: check.needsSupervisor, warnings: check.warnings, boutType }
    },
  },

  officials: {
    label: 'officials',
    singular: 'official',
    columns: ['name', 'email', 'phone', 'level', 'bc_number', 'qualifications'],
    required: ['name', 'email'],
    example: [['Pat Kim', 'pat@example.com', '204-555-0134', '2', 'BC-654321', 'Referee']],
    notes: { level: 'a whole number, optional', bc_number: 'Boxing Canada registration number, optional' },
    check(values, errors) {
      if (!values.name) errors.push('Name is missing')
      checkEmail(values.email, errors, { required: true })
      const levelText = (values.level ?? '').trim()
      const level = levelText === '' ? null : Number(levelText)
      if (level != null && !(Number.isInteger(level) && level >= 0 && level <= 100)) errors.push(`Level "${levelText}" should be a whole number`)
      return {
        name: values.name,
        invite_email: (values.email ?? '').toLowerCase(),
        phone: cleanText(values.phone),
        level,
        bc_number: cleanText(values.bc_number),
        qualifications: values.qualifications || null,
      }
    },
  },
}

// Checks every record and flags rows repeated within the file (same email, unless the spec says otherwise).
export function checkRecords(spec, columns, records, context) {
  const missingColumns = spec.required.filter((column) => !columns.includes(column))
  if (missingColumns.length) {
    return { missingColumns, rows: [] }
  }

  const seen = new Map()
  const state = {} // for checks that depend on earlier rows, like an athlete boxing twice in a day
  const rows = records.map(({ line, values }) => {
    const errors = []
    state.line = line
    const value = spec.check(values, errors, context ?? {}, state)
    const key = spec.unique ? spec.unique(values, value) : lower(values.email)
    if (key) {
      if (seen.has(key)) errors.push(spec.duplicateText ? spec.duplicateText(seen.get(key)) : spec.unique ? `Same as line ${seen.get(key)}` : `Same email as line ${seen.get(key)}`)
      else seen.set(key, line)
    }
    const email = lower(values.email)
    if (email && context?.existingEmails?.has(email)) errors.push(`${email} is already on the list`)
    return { line, values, value, errors }
  })
  return { missingColumns: [], rows }
}
