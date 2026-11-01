// Shared Ant Design pieces in the scoreboard style. See .claude/skills/frontend-style/SKILL.md.
// Light only: black on white, never a dark algorithm.
import { App as AntApp, Alert, Button, Card, ConfigProvider, DatePicker, Form, Input, InputNumber, Select, Space, Tag, TimePicker, Typography } from 'antd'
import dayjs from 'dayjs'
import { connectDialogs } from './dialogs'
import { antdTheme } from './theme'

export function ThemeRoot({ children }) {
  return (
    <ConfigProvider theme={antdTheme}>
      <AntApp>
        <DialogBridge />
        {children}
      </AntApp>
    </ConfigProvider>
  )
}

function DialogBridge() {
  const { modal, message } = AntApp.useApp()
  connectDialogs(modal, message)
  return null
}

export const Title = (props) => <Typography.Title {...props} />
export const Text = (props) => <Typography.Text {...props} />
export const Paragraph = (props) => <Typography.Paragraph {...props} />

export function Muted({ children, block = true }) {
  return block ? <Paragraph type="secondary">{children}</Paragraph> : <Text type="secondary">{children}</Text>
}

export function ErrorAlert({ children }) {
  if (!children) return null
  return <Alert type="error" showIcon title={children} className="gap" />
}

export function SuccessAlert({ children }) {
  if (!children) return null
  return <Alert type="success" showIcon title={children} className="gap" />
}

// { error, text } message from a form.
export function FormMessage({ message }) {
  if (!message) return null
  return message.error ? <ErrorAlert>{message.text}</ErrorAlert> : <SuccessAlert>{message.text}</SuccessAlert>
}

// A form in a card. Fields sit side by side and wrap; actions go along the bottom.
// Without onSubmit it renders no <form>, so it can sit inside a bigger form.
export function FormCard({ title, onSubmit, children, actions, compact, className }) {
  const body = (
    <Form layout="vertical" component={false}>
      <div className="form-grid">{children}</div>
      {actions && <Space wrap className="form-actions">{actions}</Space>}
    </Form>
  )
  return (
    <Card size="small" title={title} className={`form-card${compact ? ' compact' : ''}${className ? ` ${className}` : ''}`}>
      {onSubmit ? <form onSubmit={onSubmit}>{body}</form> : body}
    </Card>
  )
}

export function Field({ label, hint, full, children }) {
  return (
    <Form.Item
      className={full ? 'field full' : 'field'}
      label={label && <span>{label}{hint && <Text type="secondary"> ({hint})</Text>}</span>}
    >
      {children}
    </Form.Item>
  )
}

// A text note inside a FormCard that takes the whole row.
export function FullRow({ children }) {
  return <div className="full">{children}</div>
}

// Select whose "nothing chosen" value is '' (like the old <select>), with search.
export function Pick({ value, onChange, options, placeholder, allowEmpty, ...rest }) {
  return (
    <Select
      value={value === '' || value == null ? (allowEmpty ? '' : undefined) : value}
      onChange={(v) => onChange(v ?? '')}
      options={options}
      placeholder={placeholder}
      showSearch={options.length > 8 ? { optionFilterProp: 'label' } : false}
      style={{ width: '100%' }}
      popupMatchSelectWidth={false}
      {...rest}
    />
  )
}

// Date as 'YYYY-MM-DD' strings in and out.
export function DateInput({ value, onChange, min, ...rest }) {
  return (
    <DatePicker
      value={value ? dayjs(value) : null}
      onChange={(d) => onChange(d ? d.format('YYYY-MM-DD') : '')}
      format="YYYY-MM-DD"
      disabledDate={min ? (d) => d.format('YYYY-MM-DD') < min : undefined}
      style={{ width: '100%' }}
      {...rest}
    />
  )
}

// Time as 'HH:mm' strings in and out.
export function TimeInput({ value, onChange, ...rest }) {
  return (
    <TimePicker
      value={value ? dayjs(`2000-01-01T${value.slice(0, 5)}`) : null}
      onChange={(d) => onChange(d ? d.format('HH:mm') : '')}
      format="HH:mm"
      minuteStep={5}
      needConfirm={false}
      style={{ width: '100%' }}
      {...rest}
    />
  )
}

// Local date and time as 'YYYY-MM-DDTHH:mm' strings (what <input type="datetime-local"> used).
export function DateTimeInput({ value, onChange, ...rest }) {
  return (
    <DatePicker
      showTime={{ format: 'HH:mm', minuteStep: 5 }}
      value={value ? dayjs(value) : null}
      onChange={(d) => onChange(d ? d.format('YYYY-MM-DDTHH:mm') : '')}
      format="YYYY-MM-DD HH:mm"
      needConfirm={false}
      style={{ width: '100%' }}
      {...rest}
    />
  )
}

// Number with '' for empty, like an <input type="number">.
export function NumberInput({ value, onChange, ...rest }) {
  return (
    <InputNumber
      value={value === '' || value == null ? null : Number(value)}
      onChange={(v) => onChange(v ?? '')}
      style={{ width: '100%' }}
      {...rest}
    />
  )
}

export function Badge({ children, strong, muted, title }) {
  return (
    <Tag title={title} className={`badge${strong ? ' strong' : ''}${muted ? ' muted' : ''}`} variant="outlined">
      {children}
    </Tag>
  )
}

// A titled block of the page: a card with its title and buttons in the header (scoreboard's TableLayout).
// Forms inside it sit in a flat inner card.
export function Section({ title, extra, children }) {
  return (
    <Card className="section-card" title={title} extra={extra}>
      {children}
    </Card>
  )
}

// Page title row with an optional subtitle and actions on the right (scoreboard's PageLayout header).
export function PageHeading({ title, subtitle, children }) {
  return (
    <div className="page-heading">
      <div>
        <Title level={1}>{title}</Title>
        {subtitle && <Text type="secondary">{subtitle}</Text>}
      </div>
      {children && <Space wrap>{children}</Space>}
    </div>
  )
}

// "← Back" link above a detail page.
export function BackLink({ onClick, children }) {
  return <Button type="link" className="back" onClick={onClick}>← {children}</Button>
}
