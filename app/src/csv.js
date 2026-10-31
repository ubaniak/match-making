// Minimal CSV reading and writing: commas, quoted fields with "" escapes, CRLF or LF line endings.

export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  const input = text.replace(/^\uFEFF/, '') // Excel adds a byte-order mark
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const isBlank = (row) => row.every((cell) => cell.trim() === '')

// "Date of birth", "date_of_birth" and "DATE OF BIRTH" all become "date_of_birth".
export function normalizeHeader(header) {
  return header.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

// Turns parsed rows into objects keyed by normalized header, keeping each row's line number.
export function rowsToRecords(rows) {
  const headerIndex = rows.findIndex((row) => !isBlank(row))
  if (headerIndex === -1) return { columns: [], records: [] }
  const keys = rows[headerIndex].map(normalizeHeader)
  const records = []
  rows.forEach((cells, index) => {
    if (index <= headerIndex || isBlank(cells)) return
    records.push({
      line: index + 1,
      values: Object.fromEntries(keys.map((key, i) => [key, (cells[i] ?? '').trim()])),
    })
  })
  return { columns: keys, records }
}

function escapeCell(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows) {
  return rows.map((row) => row.map(escapeCell).join(',')).join('\r\n') + '\r\n'
}

export function downloadCsv(filename, rows) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
