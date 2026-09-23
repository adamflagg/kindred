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
import { AlertCircle, AlertTriangle } from 'lucide-react'
import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'

import { createLodgingAlias, updateLodgingAlias } from '../../../services/lodgingCrud'
import type { LodgingAliasRecord, LodgingUnitRecord } from '../../../types/lodging'
import { AliasUnitPicker } from './AliasUnitPicker'
import { findAliasConflicts, formatAliasYears } from './aliasRules'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD, LABEL } from './lodgingStyles'

export interface LodgingAliasFormProps {
  units: LodgingUnitRecord[]
  /** Every alias, for the duplicate check. Required: a missing list would pass every name. */
  aliases: LodgingAliasRecord[]
  alias?: LodgingAliasRecord | undefined
  onSaved: () => void
  onCancel: () => void
  /** Opens an alias this one clashes with, so staff can fix that one instead. */
  onEditAlias?: ((alias: LodgingAliasRecord) => void) | undefined
}

export function LodgingAliasForm({
  units,
  aliases,
  alias,
  onSaved,
  onCancel,
  onEditAlias,
}: LodgingAliasFormProps) {
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

  // Checked live, with the resolver's own matching rule, against every other
  // alias. The server refuses the same pair (guardAliasOverlap); this is where
  // staff find out before pressing Save, and which alias it clashes with.
  const conflicts = findAliasConflicts(
    aliases,
    {
      alias_string: aliasString,
      valid_from_year: Number.parseInt(fromYear, 10) || 0,
      valid_to_year: Number.parseInt(toYear, 10) || 0,
    },
    alias?.id
  )
  const blocked = conflicts.blocking.length > 0

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
          className={`${FIELD} font-mono ${
            blocked ? 'border-red-600 bg-red-50 dark:border-red-400 dark:bg-red-950/40' : ''
          }`}
          aria-invalid={blocked}
          value={aliasString}
          placeholder="Exactly as CampMinder sends it"
          onChange={(e) => {
            setAliasString(e.target.value)
          }}
          required
        />
      </label>
      <AliasClashNotice
        blocking={conflicts.blocking}
        separateYears={conflicts.separateYears}
        onEditAlias={onEditAlias}
      />

      <div className="text-sm">
        <span className={LABEL}>Resolves to (pick two or more for a merge)</span>
        <AliasUnitPicker
          units={availableUnits}
          selected={memberUnits}
          onChange={setMemberUnits}
          outOfSeasonIds={outOfSeasonIds}
        />
      </div>

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
          disabled={isSaving || memberUnits.length === 0 || blocked}
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

function clashLine(other: LodgingAliasRecord, onEditAlias: LodgingAliasFormProps['onEditAlias']) {
  const members = (other.expand?.member_units ?? []).map((unit) => unit.name).join(', ')
  return (
    <p key={other.id} className="text-foreground mt-1">
      “<span className="font-mono">{other.alias_string}</span>” → <b>{members || '—'}</b> ·{' '}
      {formatAliasYears(other.valid_from_year, other.valid_to_year)}
      {onEditAlias && (
        <>
          {' · '}
          <button
            type="button"
            onClick={() => {
              onEditAlias(other)
            }}
            className="text-primary font-semibold hover:underline"
          >
            Edit that alias
          </button>
        </>
      )}
    </p>
  )
}

/** The red (blocks Save) or amber (a legitimate rename) note under the cabin string. */
function AliasClashNotice({
  blocking,
  separateYears,
  onEditAlias,
}: {
  blocking: LodgingAliasRecord[]
  separateYears: LodgingAliasRecord[]
  onEditAlias: LodgingAliasFormProps['onEditAlias']
}) {
  if (blocking.length > 0) {
    return (
      <div className="-mt-1 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div>
          <b>This name already has an alias for these years.</b> Matching ignores case and leading
          or trailing spaces, and two aliases for one name in overlapping years resolve to neither.
          {blocking.map((other) => clashLine(other, onEditAlias))}
        </div>
      </div>
    )
  }
  if (separateYears.length > 0) {
    return (
      <div className="-mt-1 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div>
          <b>Same name, different years.</b> Fine for a renamed building: the years don&apos;t
          overlap, so each year still resolves to exactly one.
          {separateYears.map((other) => clashLine(other, onEditAlias))}
        </div>
      </div>
    )
  }
  return null
}
