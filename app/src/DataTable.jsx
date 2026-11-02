// Every table in the app: an antd Table with a search box, sortable columns and pagination.
// A column's sort and search value comes from, in order: its `value(row)` function, its `dataIndex`,
// or its `render` when that returns plain text or a number. Columns with none of these (actions,
// inline forms) don't sort. Pass `sortable: false` or `searchable: false` on a column to opt out.
// "Download CSV" saves every row that matches the search (not just the current page), in the shown
// order. A column's CSV text is its `csv(row)`, else its `render` when that returns text or a number,
// else its sort value; columns with none (actions) are left out, as is any with `csv: false`.
import { useMemo, useState } from 'react'
import { Button, Grid, Input, Select, Table } from 'antd'
import { DownloadOutlined, SearchOutlined } from '@ant-design/icons'
import { downloadCsv } from './csv'

const PAGE_SIZES = [10, 25, 50, 100]

function valueGetter(column) {
  if (column.value) return column.value
  if (column.dataIndex) return (row) => row[column.dataIndex]
  if (column.render) {
    return (row) => {
      const out = column.render(undefined, row)
      return typeof out === 'string' || typeof out === 'number' ? out : undefined
    }
  }
  return null
}

const isBlank = (v) => v == null || v === '' || v === '—'

function compare(a, b) {
  if (isBlank(a) && isBlank(b)) return 0
  if (isBlank(a)) return 1
  if (isBlank(b)) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

// A cell's plain text for the CSV, or undefined when the column has nothing to export for that row.
function csvText(value) {
  if (value == null) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map(csvText).filter(Boolean).join('; ')
  if (typeof value === 'object') return undefined
  return String(value)
}

function csvGetter(column, get) {
  if (column.csv === false) return null
  if (typeof column.csv === 'function') return column.csv
  if (!column.render && !get) return null
  return (row, index) => {
    if (column.render) {
      const out = column.render(column.dataIndex ? row[column.dataIndex] : undefined, row, index)
      if (typeof out === 'string' || typeof out === 'number') return out
    }
    return get?.(row)
  }
}

// "Clubs 2026-11-02.csv"; keeps letters, digits, spaces and dashes so every system accepts the name.
function csvFilename(name) {
  const safe = String(name || 'table').replace(/[^\p{L}\p{N} _-]+/gu, ' ').replace(/\s+/g, ' ').trim() || 'table'
  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `${safe} ${today}.csv`
}

// The "Download CSV" button used by every table and by lists that aren't tables (the bout card).
export function DownloadCsvButton({ filename, getRows, disabled, label = 'Download CSV', ...rest }) {
  return (
    <Button
      icon={<DownloadOutlined />}
      disabled={disabled}
      onClick={() => downloadCsv(csvFilename(filename), getRows())}
      {...rest}
    >
      {label}
    </Button>
  )
}

export default function DataTable({ columns, dataSource, rowKey, searchPlaceholder = 'Search…', className, csvName, ...rest }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState({ current: 1, pageSize: PAGE_SIZES[0] })
  const [sort, setSort] = useState({ key: null, order: null })
  // On phones the header row is hidden and rows show as cards, so sorting moves to a menu.
  const phone = !Grid.useBreakpoint().md

  const getters = useMemo(() => columns.map((c) => (c.sortable === false && c.searchable === false ? null : valueGetter(c))), [columns])

  const tableColumns = useMemo(() => columns.map((c, i) => {
    const get = getters[i]
    const { value: _value, sortable, searchable: _searchable, ...column } = c
    // The label shown beside each value when rows turn into cards on phones.
    const label = typeof column.title === 'string' ? column.title : ''
    const withLabel = { ...column, onCell: (row, index) => ({ ...column.onCell?.(row, index), 'data-label': label }) }
    // A column only sorts when it has a value to sort by (not action buttons or inline forms).
    const hasValues = c.value || c.dataIndex || dataSource.some((row) => !isBlank(get?.(row)))
    if (!get || sortable === false || !hasValues) return withLabel
    return {
      ...withLabel,
      sorter: column.sorter ?? ((a, b) => compare(get(a), get(b))),
      sortOrder: sort.key === column.key ? sort.order : null,
      showSorterTooltip: false,
    }
  }), [columns, getters, sort, dataSource])

  const sortOptions = tableColumns.filter((c) => c.sorter && typeof c.title === 'string').flatMap((c) => [
    { value: `${c.key}|ascend`, label: `${c.title}, A to Z / low to high` },
    { value: `${c.key}|descend`, label: `${c.title}, Z to A / high to low` },
  ])

  const rows = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length === 0) return dataSource
    return dataSource.filter((row) => {
      const text = columns
        .map((c, i) => (c.searchable === false || !getters[i] ? '' : getters[i](row)))
        .filter((v) => !isBlank(v))
        .join(' ')
        .toLowerCase()
      return words.every((w) => text.includes(w))
    })
  }, [dataSource, columns, getters, query])

  // Every matching row in the order shown (the current sort), with plain-text column titles as headers.
  function csvRows() {
    const sorted = tableColumns.find((c) => c.key === sort.key && c.sorter && sort.order)
    const ordered = sorted
      ? [...rows].sort((a, b) => (sort.order === 'descend' ? -1 : 1) * sorted.sorter(a, b))
      : rows
    const exported = columns
      .map((c, i) => ({ title: typeof c.title === 'string' ? c.title : (c.csvTitle ?? ''), get: csvGetter(c, getters[i]) }))
      .filter((c) => c.get && c.title)
    return [
      exported.map((c) => c.title),
      ...ordered.map((row, index) => exported.map((c) => csvText(c.get(row, index)) ?? '')),
    ]
  }

  return (
    <div className={`data-table${phone ? ' as-cards' : ''}${className ? ` ${className}` : ''}`}>
      <div className="data-table-toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder={searchPlaceholder}
          aria-label="Search this table"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage((p) => ({ ...p, current: 1 })) }}
          className="data-table-search"
        />
        <DownloadCsvButton
          className="data-table-csv"
          filename={csvName}
          disabled={rows.length === 0}
          getRows={csvRows}
          title={query ? 'Download the rows that match your search' : 'Download every row'}
        />
      </div>
      {phone && sortOptions.length > 0 && (
        <Select
          allowClear
          className="data-table-sort"
          placeholder="Sort by…"
          aria-label="Sort this table"
          value={sort.key ? `${sort.key}|${sort.order}` : undefined}
          onChange={(v) => { const [key, order] = v ? v.split('|') : [null, null]; setSort({ key, order }) }}
          options={sortOptions}
        />
      )}
      <Table
        size="small"
        scroll={{ x: true }}
        rowKey={rowKey}
        columns={tableColumns}
        dataSource={rows}
        onChange={(_, __, sorter, { action }) => {
          if (action === 'sort') setSort({ key: sorter.order ? sorter.columnKey : null, order: sorter.order ?? null })
        }}
        locale={{ emptyText: query ? 'Nothing matches your search.' : 'Nothing here yet.' }}
        pagination={{
          current: page.current,
          pageSize: page.pageSize,
          pageSizeOptions: PAGE_SIZES,
          showSizeChanger: !phone,
          showTotal: (total, [from, to]) => `${from}–${to} of ${total}`,
          size: 'small',
          onChange: (current, pageSize) => setPage({ current: pageSize === page.pageSize ? current : 1, pageSize }),
        }}
        {...rest}
      />
    </div>
  )
}
