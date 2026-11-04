// Role checkboxes for officials (migration 42), with "All" first (Bhavek: "make All the first
// option"). All ticks every role; it shows as part-ticked when only some are on.
import { Checkbox } from 'antd'

// roles: [{ key, label }] to choose from. value: the ticked keys. onChange(keys).
export default function RoleChoices({ roles, value, onChange }) {
  const keys = roles.map((r) => r.key)
  const ticked = keys.filter((k) => value.includes(k))
  const all = ticked.length === keys.length && keys.length > 0
  return (
    <div className="role-choices">
      {keys.length > 1 && (
        <Checkbox
          checked={all}
          indeterminate={ticked.length > 0 && !all}
          onChange={(e) => onChange(e.target.checked ? keys : [])}
        >
          All
        </Checkbox>
      )}
      <Checkbox.Group
        value={ticked}
        onChange={onChange}
        options={roles.map((r) => ({ value: r.key, label: r.label }))}
      />
    </div>
  )
}
