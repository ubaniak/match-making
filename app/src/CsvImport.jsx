import { useState } from 'react'
import { downloadCsv, parseCsv, rowsToRecords } from './csv'
import { checkRecords, importSpecs } from './imports'

const count = (n, spec) => `${n} ${n === 1 ? spec.singular : spec.label}`

// Bulk add from a CSV file: download a template, preview with per-row problems, then import the good rows.
export default function CsvImport({ kind, context, importRow, onDone }) {
  const spec = importSpecs[kind]
  const [fileName, setFileName] = useState(null)
  const [check, setCheck] = useState(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)

  async function chooseFile(event) {
    const file = event.target.files[0]
    event.target.value = ''
    if (!file) return
    const { columns, records } = rowsToRecords(parseCsv(await file.text()))
    setFileName(file.name)
    setResult(null)
    setCheck(checkRecords(spec, columns, records, context))
  }

  async function runImport() {
    const ready = check.rows.filter((row) => row.errors.length === 0)
    setImporting(true)
    const failed = []
    for (const row of ready) {
      try {
        await importRow(row.value)
      } catch (err) {
        failed.push({ line: row.line, name: row.values.name, message: err.message })
      }
    }
    setImporting(false)
    setResult({ added: ready.length - failed.length, failed, skipped: check.rows.length - ready.length })
    setCheck(null)
    onDone()
  }

  const ready = check?.rows.filter((row) => row.errors.length === 0).length ?? 0
  const problems = (check?.rows.length ?? 0) - ready

  return (
    <details className="csv-import">
      <summary>Bulk add {spec.label} from a CSV file</summary>
      <p className="muted">
        Columns: {spec.columns.map((c, i) => (
          <span key={c}>{i > 0 && ', '}<code>{c}</code>{spec.required.includes(c) && ' (required)'}</span>
        ))}. The first row must be the column names.
      </p>
      <div className="csv-actions">
        <button
          type="button"
          className="secondary"
          onClick={() => downloadCsv(`${kind}-template.csv`, [spec.columns, ...spec.example])}
        >
          Download template
        </button>
        <label className="file-button">
          Choose CSV file
          <input type="file" accept=".csv,text/csv" onChange={chooseFile} />
        </label>
      </div>

      {check?.missingColumns.length > 0 && (
        <p className="error">
          {fileName} is missing the column{check.missingColumns.length > 1 ? 's' : ''} {check.missingColumns.join(', ')}.
          Download the template to see the expected layout.
        </p>
      )}

      {check && check.missingColumns.length === 0 && (
        <>
          <p>
            <strong>{fileName}</strong>: {ready} ready to add
            {problems > 0 && <span className="error">, {problems} with problems that will be skipped</span>}.
          </p>
          {check.rows.length > 0 && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Problems</th>
                    {spec.columns.map((c) => <th key={c}>{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {check.rows.map((row) => (
                    <tr key={row.line} className={row.errors.length ? 'row-error' : undefined}>
                      <td>{row.line}</td>
                      <td className="problems">{row.errors.length ? row.errors.join('; ') : <span className="success">OK</span>}</td>
                      {spec.columns.map((c) => <td key={c}>{row.values[c] || '—'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="csv-actions">
            <button type="button" disabled={ready === 0 || importing} onClick={runImport}>
              {importing ? 'Adding…' : `Add ${count(ready, spec)}`}
            </button>
            <button type="button" className="secondary" disabled={importing} onClick={() => setCheck(null)}>
              Cancel
            </button>
          </div>
        </>
      )}

      {result && (
        <div>
          <p className="success">
            Added {count(result.added, spec)}.
            {result.skipped > 0 && ` Skipped ${result.skipped} with problems.`}
          </p>
          {result.failed.length > 0 && (
            <>
              <p className="error">These rows couldn't be saved:</p>
              <ul className="error">
                {result.failed.map((f) => <li key={f.line}>Line {f.line} ({f.name}): {f.message}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
    </details>
  )
}
