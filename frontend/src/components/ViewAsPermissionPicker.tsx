/**
 * The View as "Custom…" permission picker: one column, grouped by family.
 *
 * A family (the codename before the dot) with several permissions gets a
 * parent checkbox that ticks or clears the whole family and shows a partial
 * state when only some are ticked; its children are labelled by their suffix.
 * A single-permission family is one row under its full codename. One column
 * with its own scroll cap, so it can neither overflow the menu sideways nor
 * push Apply off the bottom.
 */
import { useEffect, useRef } from 'react'
import { groupPermissions, type PermissionFamily } from '../utils/permissionFamilies'

const byName = (a: string, b: string) => a.localeCompare(b)
const rowClass = 'flex cursor-pointer items-center gap-1.5 py-0.5'

function FamilyCheckbox({
  family,
  permissions,
  selected,
  onChange,
}: PermissionFamily & { selected: string[]; onChange: (next: string[]) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const picked = permissions.filter((p) => selected.includes(p))
  const all = picked.length === permissions.length
  const some = picked.length > 0 && !all

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some
  }, [some])

  const toggleFamily = () => {
    const rest = selected.filter((p) => !permissions.includes(p))
    onChange(all ? rest : [...rest, ...permissions].sort(byName))
  }

  return (
    <label className={`${rowClass} font-semibold`}>
      <input
        ref={ref}
        type="checkbox"
        className="accent-primary"
        checked={all}
        onChange={toggleFamily}
      />
      {family}
    </label>
  )
}

export function ViewAsPermissionPicker({
  all,
  selected,
  onChange,
}: {
  all: readonly string[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const toggle = (perm: string) =>
    onChange(
      selected.includes(perm)
        ? selected.filter((p) => p !== perm)
        : [...selected, perm].sort(byName)
    )

  const permRow = (perm: string, label: string) => (
    <label key={perm} className={rowClass}>
      <input
        type="checkbox"
        className="accent-primary"
        checked={selected.includes(perm)}
        onChange={() => toggle(perm)}
      />
      {label}
    </label>
  )

  return (
    <div data-testid="view-as-permission-picker" className="max-h-56 overflow-y-auto text-xs">
      {groupPermissions(all).map(({ family, permissions }) =>
        permissions.length === 1 && permissions[0] !== undefined ? (
          permRow(permissions[0], permissions[0])
        ) : (
          <div key={family}>
            <FamilyCheckbox
              family={family}
              permissions={permissions}
              selected={selected}
              onChange={onChange}
            />
            <div className="pl-5">
              {permissions.map((perm) => permRow(perm, perm.slice(family.length + 1)))}
            </div>
          </div>
        )
      )}
    </div>
  )
}
