import { useState } from 'react'
import { Button, Collapse, Space, Table, Upload } from 'antd'
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons'
import { downloadCsv, parseCsv, rowsToRecords } from './csv'
import { checkRecords, importSpecs } from './imports'
import { ErrorAlert, Muted, Paragraph, SuccessAlert, Text } from './ui'

const count = (n, spec) => `${n} ${n === 1 ? spec.singular : spec.label}`

// Bulk add from a CSV file: download a template, preview with per-row problems, then import the good rows.
export default function CsvImport({ kind, context, importRow, onDone }) {
  const spec = importSpecs[kind]
  const [fileName, setFileName] = useState(null)
  const [check, setCheck] = useState(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)

  async function chooseFile(file) {
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

  const columns = [
    { title: 'Line', dataIndex: 'line', key: 'line' },
    {
      title: 'Problems',
      key: 'problems',
      width: 240,
      render: (_, row) => (row.errors.length ? <Text type="danger">{row.errors.join('; ')}</Text> : 'OK'),
    },
    ...spec.columns.map((c) => ({ title: c, key: c, render: (_, row) => row.values[c] || '—' })),
  ]

  const body = (
    <>
      <Muted>
        Columns: {spec.columns.map((c, i) => (
          <span key={c}>{i > 0 && ', '}<code>{c}</code>{spec.required.includes(c) && ' (required)'}</span>
        ))}. The first row must be the column names.
      </Muted>
      <Space wrap>
        <Button icon={<DownloadOutlined />} onClick={() => downloadCsv(`${kind}-template.csv`, [spec.columns, ...spec.example])}>
          Download template
        </Button>
        <Upload accept=".csv,text/csv" showUploadList={false} beforeUpload={(file) => { chooseFile(file); return false }}>
          <Button icon={<UploadOutlined />}>Choose CSV file</Button>
        </Upload>
      </Space>

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
            <Table
              size="small"
              rowKey="line"
              columns={columns}
              dataSource={check.rows}
              pagination={false}
              scroll={{ x: true }}
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
            {result.skipped > 0 && ` Skipped ${result.skipped} with problems.`}
          </SuccessAlert>
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
      items={[{ key: 'csv', label: <strong>Bulk add {spec.label} from a CSV file</strong>, children: body }]}
    />
  )
}
