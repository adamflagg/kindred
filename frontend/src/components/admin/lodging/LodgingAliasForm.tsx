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
import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'

import { createLodgingAlias, updateLodgingAlias } from '../../../services/lodgingCrud'
import type { LodgingAliasRecord, LodgingUnitRecord } from '../../../types/lodging'
import { eligibleAliasMembers } from './aliasMembers'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD, LABEL } from './lodgingStyles'

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
  // Collapsed unless the alias already has a window: an unset window is the
  // 94-in-100 case and shouldn't be a field staff meet on every edit, but a
  // SET window must stay visible in its own editor — hiding it is precisely
  // how a wrong window (which does not error) goes unnoticed.
  const [showWindow, setShowWindow] = useState(
    Boolean(alias?.valid_from_year) || Boolean(alias?.valid_to_year)
  )
  const [isSaving, setIsSaving] = useState(false)

  // `units` is THIS season's list only (LodgingAliasesPanel feeds it the
  // year-scoped picker). An alias already naming a unit from another season
  // has that id nowhere in `units` -- unlike a retired or containerized unit,
  // which is still in the list and just gets filtered by eligibleAliasMembers,
  // a rolled-forward member's record does not exist in `units` at all, so no
  // amount of filtering can re-admit it. Without this, the checkbox for that
  // member simply never renders: the fieldset looks blank, memberUnits still
  // holds the stale id, and Save writes it back in a merge nobody chose.
  // `alias.expand.member_units` (populated by listLodgingAliases's `expand`)
  // is what lets an out-of-season member be shown and toggled at all.
  const outOfSeasonMembers = useMemo(() => {
    const known = new Set(units.map((unit) => unit.id))
    return (alias?.expand?.member_units ?? []).filter((unit) => !known.has(unit.id))
  }, [units, alias])
  const availableUnits = outOfSeasonMembers.length === 0 ? units : [...units, ...outOfSeasonMembers]
  const outOfSeasonIds = new Set(outOfSeasonMembers.map((unit) => unit.id))

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
    // An inverted window matches no year, so the alias stops resolving and the
    // string returns to the unresolved queue with nothing recording why. The
    // check is here rather than on the inputs because either bound alone is
    // legal — only the pair is wrong.
    if (!Number.isNaN(from) && !Number.isNaN(to) && from > to) {
      toast.error('The first year of the window cannot be after the last.')
      setIsSaving(false)
      return
    }
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
        {eligibleAliasMembers(availableUnits, memberUnits).map((unit) => (
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
            {outOfSeasonIds.has(unit.id) && (
              <span className="text-muted-foreground text-xs">(different season)</span>
            )}
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
          className="text-muted-foreground hover:text-foreground w-fit text-xs font-medium hover:underline"
        >
          Set a year window (only needed when a name was reused for a different building)
        </button>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isSaving || memberUnits.length === 0}
          className={BUTTON_PRIMARY}
        >
          {alias ? 'Save alias' : 'Create alias'}
        </button>
        <button type="button" onClick={onCancel} className={BUTTON_SECONDARY}>
          Cancel
        </button>
      </div>
    </form>
  )
}
