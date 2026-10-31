// What each CSV import expects, and how a row is checked before anything is saved.

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

function checkEmail(email, errors, { required = false } = {}) {
  if (!email) {
    if (required) errors.push('Email is missing')
    return
  }
  if (!EMAIL.test(email)) errors.push(`"${email}" isn't a valid email`)
}

export const importSpecs = {
  users: {
    label: 'users',
    singular: 'user',
    columns: ['name', 'email'],
    required: ['name', 'email'],
    example: [['Maria Lopez', 'maria@example.com']],
    check(values, errors) {
      if (!values.name) errors.push('Name is missing')
      checkEmail(values.email, errors, { required: true })
      return { name: values.name, email: values.email.toLowerCase() }
    },
  },

  athletes: {
    label: 'athletes',
    singular: 'athlete',
    columns: ['name', 'email', 'coach_email', 'date_of_birth', 'weight_class', 'club'],
    required: ['name'],
    example: [
      ['Ali Hassan', 'ali@example.com', 'maria@example.com', '2004-03-12', 'Lightweight', 'Eastside BC'],
      ['Tom Becker', '', '', '', 'Middleweight', ''],
    ],
    check(values, errors, { usersByEmail }) {
      if (!values.name) errors.push('Name is missing')
      checkEmail(values.email, errors)

      let coachId = null
      const coachEmail = (values.coach_email ?? '').toLowerCase()
      if (coachEmail) {
        const coach = usersByEmail.get(coachEmail)
        if (!coach) errors.push(`No user with email ${coachEmail}`)
        else if (!coach.id) errors.push(`${coachEmail} hasn't signed in yet, so athletes can't be assigned to them`)
        else coachId = coach.id
      }

      const dob = values.date_of_birth ?? ''
      if (dob && (!DATE.test(dob) || Number.isNaN(Date.parse(dob)))) {
        errors.push(`Date of birth "${dob}" should look like 2004-03-12`)
      }

      return {
        name: values.name,
        invite_email: (values.email ?? '').toLowerCase() || null,
        coach_id: coachId,
        date_of_birth: dob || null,
        weight_class: values.weight_class || null,
        club: values.club || null,
      }
    },
  },

  officials: {
    label: 'officials',
    singular: 'official',
    columns: ['name', 'email', 'qualifications'],
    required: ['name', 'email'],
    example: [['Pat Kim', 'pat@example.com', 'Level 2 referee']],
    check(values, errors) {
      if (!values.name) errors.push('Name is missing')
      checkEmail(values.email, errors, { required: true })
      return {
        name: values.name,
        invite_email: (values.email ?? '').toLowerCase(),
        qualifications: values.qualifications || null,
      }
    },
  },
}

// Checks every record and flags emails repeated within the file.
export function checkRecords(spec, columns, records, context) {
  const missingColumns = spec.required.filter((column) => !columns.includes(column))
  if (missingColumns.length) {
    return { missingColumns, rows: [] }
  }

  const seen = new Map()
  const rows = records.map(({ line, values }) => {
    const errors = []
    const value = spec.check(values, errors, context)
    const email = (values.email ?? '').toLowerCase()
    if (email) {
      if (seen.has(email)) errors.push(`Same email as line ${seen.get(email)}`)
      else seen.set(email, line)
      if (context?.existingEmails?.has(email)) errors.push(`${email} is already on the list`)
    }
    return { line, values, value, errors }
  })
  return { missingColumns: [], rows }
}
