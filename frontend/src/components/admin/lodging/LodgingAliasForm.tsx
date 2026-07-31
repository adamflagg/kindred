/**
 * Create or edit a cabin-name alias.
 *
 * An alias maps a verbatim CampMinder cabin string onto one or more units.
 * One member is an atomic room; two or more denote a merge.
 *
 * The YEAR WINDOW is behind a disclosure on purpose. Measured on real data,
 * zero alias strings appear more than once and only 6 of 100 carry a window —
 * so it never picks between two candidates, it only PREVENTS a resolution and
 * sends the row to the work queue. That makes it a correctness backstop for
 * renames (two different buildings once shared a name in different eras), not
 * a field staff should meet on every edit.
 */
import { useState } from 'react'
import toast from 'react-hot-toast'

import { createLodgingAlias, updateLodgingAlias } from '../../../services/lodgingCrud'
import type { LodgingAliasRecord, LodgingUnitRecord } from '../../../types/lodging'

const FIELD = 'border-border bg-background w-full rounded-md border px-2 py-1 text-sm'
const LABEL = 'text-muted-foreground mb-1 block text-xs font-medium'

export interface LodgingAliasFormProps {
  units: LodgingUnitRecord[]
  alias?: LodgingAliasRecord | undefined
  onSaved: () => void
  onCancel: () => void
}

export function LodgingAliasForm({ units, alias, onSaved, onCancel }: LodgingAliasFormProps) {
  const [aliasString, setAliasString] = useState(alias?.alias_string ?? '')
  const [memberUnits, setMemberUnits] = useState<string[]>(alias?.member_units ?? [])
  const [fromYear, setFromYear] = useState(
    alias?.valid_from_year ? String(alias.valid_from_year) : ''
  )
  const [toYear, setToYear] = useState(alias?.valid_to_year ? String(alias.valid_to_year) : '')
  // Always collapsed on open, even when the alias already carries a window:
  // the point of the disclosure is that staff should not meet this field on
  // every edit. The pre-populated from/to state above still round-trips the
  // existing value on submit if the disclosure is never opened.
  const [showWindow, setShowWindow] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const toggleUnit = (id: string) => {
    setMemberUnits((current) =>
      current.includes(id) ? current.filter((u) => u !== id) : [...current, id]
    )
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setIsSaving(true)
    const from = Number.parseInt(fromYear, 10)
    const to = Number.parseInt(toYear, 10)
    const payload = {
      alias_string: aliasString,
      member_units: memberUnits,
      // 0 is how PocketBase stores "unbounded" for a number column.
      valid_from_year: Number.isNaN(from) ? 0 : from,
      valid_to_year: Number.isNaN(to) ? 0 : to,
    }
    try {
      if (alias) await updateLodgingAlias(alias.id, payload)
      else await createLodgingAlias(payload)
      toast.success(alias ? 'Alias saved' : 'Alias created')
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save the alias')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
      <label className="text-sm">
        <span className={LABEL}>Cabin string</span>
        <input
          className={`${FIELD} font-mono`}
          value={aliasString}
          placeholder="Exactly as CampMinder sends it"
          onChange={(e) => {
            setAliasString(e.target.value)
          }}
          required
        />
      </label>

      <fieldset className="flex flex-wrap gap-3">
        <legend className={LABEL}>Resolves to (pick two or more for a merge)</legend>
        {units.map((unit) => (
          <label key={unit.id} className="inline-flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              aria-label={unit.name}
              checked={memberUnits.includes(unit.id)}
              onChange={() => {
                toggleUnit(unit.id)
              }}
            />
            {unit.name}
          </label>
        ))}
      </fieldset>

      {showWindow ? (
        <div className="flex gap-3">
          <label className="text-sm">
            <span className={LABEL}>Valid from year</span>
            <input
              className={FIELD}
              type="number"
              value={fromYear}
              placeholder="Any"
              onChange={(e) => {
                setFromYear(e.target.value)
              }}
            />
          </label>
          <label className="text-sm">
            <span className={LABEL}>Valid to year</span>
            <input
              className={FIELD}
              type="number"
              value={toYear}
              placeholder="Any"
              onChange={(e) => {
                setToYear(e.target.value)
              }}
            />
          </label>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setShowWindow(true)
          }}
          className="text-muted-foreground w-fit text-xs font-medium hover:underline"
        >
          Set a year window (only needed when a name was reused for a different building)
        </button>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isSaving || memberUnits.length === 0}
          className="bg-primary rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {alias ? 'Save alias' : 'Create alias'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border-border rounded-md border px-3 py-1.5 text-sm font-medium"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
