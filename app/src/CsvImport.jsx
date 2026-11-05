import { useState } from 'react'
import { Button, Collapse, Space, Upload } from 'antd'
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons'
import DataTable from './DataTable'
import { downloadCsv, parseCsv, rowsToRecords } from './csv'
import { checkRecords, importSpecs } from './imports'
import { ErrorAlert, Muted, Paragraph, SuccessAlert, Text, WarningAlert } from './ui'

const count = (n, spec) => `${n} ${n === 1 ? spec.singular : spec.label}`

// Bulk add from a CSV file: download a template, preview with per-row problems, then import the good rows.
// importRow(value) saves one row; it can return { note } to flag something (e.g. an email that didn't go out).
// title replaces "Bulk add <things> from a CSV file"; children add help under the column list.
export default function CsvImport({ kind, context, importRow, onDone, title, templateName, children }) {
  const spec = importSpecs[kind]
  const [fileName, setFileName] = useState(null)
  const [check, setCheck] = useState(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const [looking, setLooking] = useState(false)
  const [lookError, setLookError] = useState(null)

  async function chooseFile(file) {
    if (!file) return
    const { columns, records } = rowsToRecords(parseCsv(await file.text()))
    setFileName(file.name)
    setResult(null)
    const checked = checkRecords(spec, columns, records, context)
    // Some imports also ask the database, e.g. athletes already in another club.
    if (spec.findExisting && checked.missingColumns.length === 0) {
      setCheck(null)
      setLooking(true)
      try {
        const existing = await spec.findExisting(checked.rows, context)
        for (const row of checked.rows) if (existing[row.line]) row.errors.push(existing[row.line])
        setLookError(null)
      } catch (err) {
        setLookError(`Couldn't check for athletes already in the system: ${err.message}. The database will still refuse them when you add.`)
      } finally {
        setLooking(false)
      }
    } else setLookError(null)
    setCheck(checked)
  }

  async function runImport() {
    const ready = check.rows.filter((row) => row.errors.length === 0)
    setImporting(true)
    const failed = []
    const notes = []
    for (const row of ready) {
      const name = describe(row.values)
      try {
        const saved = await importRow(row.value)
        if (saved?.note) notes.push({ line: row.line, name, message: saved.note })
      } catch (err) {
        failed.push({ line: row.line, name, message: err.message })
      }
    }
    setImporting(false)
    const skipped = check.rows.filter((row) => row.errors.length > 0).map((row) => ({ line: row.line, name: describe(row.values), message: row.errors.join('; ') }))
    setResult({ added: ready.length - failed.length, failed, notes, skipped })
    setCheck(null)
    await onDone?.()
  }

  const describe = spec.describe ?? ((values) => values.name || values.email || '')
  const ready = check?.rows.filter((row) => row.errors.length === 0).length ?? 0
  const problems = (check?.rows.length ?? 0) - ready

  const columns = [
    { title: 'Line', dataIndex: 'line', key: 'line' },
    {
      title: 'Problems',
      key: 'problems',
      value: (row) => row.errors.join('; ') || 'OK',
      width: 240,
      render: (_, row) => (row.errors.length ? <Text type="danger">{row.errors.join('; ')}</Text> : 'OK'),
    },
    ...spec.columns.map((c) => ({ title: c, key: c, render: (_, row) => row.values[c] || '—' })),
  ]

  const body = (
    <>
      <Muted>
        Columns: {spec.columns.map((c, i) => (
          <span key={c}>
            {i > 0 && ', '}<code>{c}</code>
            {spec.required.includes(c) && ' (required)'}
            {spec.notes?.[c] && ` (${spec.notes[c]})`}
          </span>
        ))}. The first row must be the column names.
      </Muted>
      {children}
      <Space wrap>
        <Button icon={<DownloadOutlined />} onClick={() => downloadCsv(`${templateName ?? kind}-template.csv`, [spec.columns, ...spec.example])}>
          Download template
        </Button>
        <Upload accept=".csv,text/csv" showUploadList={false} beforeUpload={(file) => { chooseFile(file); return false }}>
          <Button icon={<UploadOutlined />} loading={looking}>{looking ? 'Checking…' : 'Choose CSV file'}</Button>
        </Upload>
      </Space>

      {lookError && check && <WarningAlert>{lookError}</WarningAlert>}

      {check?.missingColumns.length > 0 && (
        <ErrorAlert>
          {fileName} is missing the column{check.missingColumns.length > 1 ? 's' : ''} {check.missingColumns.join(', ')}.
          Download the template to see the expected layout.
        </ErrorAlert>
      )}

      {check && check.missingColumns.length === 0 && (
        <>
          <Paragraph style={{ marginTop: 12 }}>
            <strong>{fileName}</strong>: {ready} ready to add
            {problems > 0 && <Text type="danger">, {problems} with problems that will be skipped</Text>}.
          </Paragraph>
          {check.rows.length > 0 && (
            <DataTable
              rowKey="line"
              columns={columns}
              dataSource={check.rows}
              csvName={`${fileName} checked`}
              rowClassName={(row) => (row.errors.length ? 'row-error' : '')}
            />
          )}
          <Space wrap style={{ marginTop: 12 }}>
            <Button type="primary" disabled={ready === 0} loading={importing} onClick={runImport}>
              {importing ? 'Adding…' : `Add ${count(ready, spec)}`}
            </Button>
            <Button disabled={importing} onClick={() => setCheck(null)}>Cancel</Button>
          </Space>
        </>
      )}

      {result && (
        <>
          <SuccessAlert>
            Added {count(result.added, spec)}.
            {result.skipped.length > 0 && ` Skipped ${result.skipped.length} with problems (listed below).`}
          </SuccessAlert>
          {result.skipped.length > 0 && (
            <WarningAlert>
              Not added:
              <ul style={{ margin: 0 }}>
                {result.skipped.map((s) => <li key={s.line}>Line {s.line}{s.name ? ` (${s.name})` : ''}: {s.message}</li>)}
              </ul>
            </WarningAlert>
          )}
          {result.notes.length > 0 && (
            <WarningAlert>
              Added, but check these:
              <ul style={{ margin: 0 }}>
                {result.notes.map((n) => <li key={n.line}>Line {n.line} ({n.name}): {n.message}</li>)}
              </ul>
            </WarningAlert>
          )}
          {result.failed.length > 0 && (
            <ErrorAlert>
              These rows couldn't be saved:
              <ul style={{ margin: 0 }}>
                {result.failed.map((f) => <li key={f.line}>Line {f.line} ({f.name}): {f.message}</li>)}
              </ul>
            </ErrorAlert>
          )}
        </>
      )}
    </>
  )

  return (
    <Collapse
      className="gap"
      items={[{ key: 'csv', label: <strong>{title ?? `Bulk add ${spec.label} from a CSV file`}</strong>, children: body }]}
    />
  )
}
