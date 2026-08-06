/**
 * Who a unit is: its name, its derived code, its area and its parent.
 *
 * The code disclosure lives here because the code IS identity — it is the join
 * key `bathroom_group` membership and the roster's `unit_code` both match on.
 * So it is derived from the name on create and only revealed when asked for;
 * `showCode` is this section's own business and never reaches the form.
 */
import { useState } from 'react'

import type { LodgingAreaRecord, LodgingUnitRecord } from '../../../types/lodging'
import { FIELD, LABEL } from './lodgingStyles'
import { slugify } from './unitCode'
import { combinedAncestor, parentCandidates } from './unitTree'

export interface UnitIdentity {
  name: string
  code: string
  area: string
  parent_unit: string
}

export interface UnitIdentityFieldsProps {
  value: UnitIdentity
  onChange: (next: UnitIdentity) => void
  areas: LodgingAreaRecord[]
  /**
   * Every unit, for the parent picker. The picker offers only containers,
   * never the unit itself, and never one of its own descendants — see
   * ./unitTree for why (a non-container parent fails the seed verifier; a
   * descendant parent is a cycle nothing downstream guards against).
   */
  units: LodgingUnitRecord[]
  /** Absent on create, where the code stays hidden until staff ask for it. */
  unitId?: string | undefined
  /**
   * Live from the Allocation select, not off the record: a staffer who has
   * just switched a room to staff housing should see staff buildings offered
   * straight away, not after a save and a reopen.
   */
  inventoryClass: string
  /**
   * Live from the "is a building" checkbox, not off the record: the combined
   * control gates on this the moment a staffer ticks or unticks it, without
   * waiting for a save and reopen.
   */
  isContainer: boolean
  /** The registry-default combined value — see `default_combined` on `LodgingUnitRecord`. */
  combined: boolean
  onCombinedChange: (next: boolean) => void
}

export function UnitIdentityFields({
  value,
  onChange,
  areas,
  units,
  unitId,
  inventoryClass,
  isContainer,
  combined,
  onCombinedChange,
}: UnitIdentityFieldsProps) {
  const [showCode, setShowCode] = useState(false)
  const derived = slugify(value.name)
  // Live off the SELECTED parent, not the stored one, so re-parenting a unit
  // in this same form updates the disable state immediately rather than
  // waiting for a reload.
  const blockingAncestor =
    value.parent_unit === '' ? undefined : combinedAncestor(value.parent_unit, units)

  return (
    <>
      <label className="text-sm">
        <span className={LABEL}>Name</span>
        <input
          className={FIELD}
          value={value.name}
          onChange={(e) => {
            onChange({ ...value, name: e.target.value })
          }}
          required
        />
      </label>

      {/* CREATE ONLY, in both directions.

          It is offered on create because slugify keeps only [a-z0-9]: a name
          with no ASCII alphanumerics derives to '' and the form refuses that
          save outright, so the manual escape is the only way past it.

          It is absent on EDIT because the code is a join key, not a name.
          apply_lodging_inventory.py matches units by it, so retyping one
          orphans the unit from the registry and the next --apply creates a
          second copy — silently. Nothing in the admin UI displays a code
          either (it is not among UNIT_SORT_COLUMNS), so there is no context in
          which a staffer needs to read one. Existing codes still ride through
          a save untouched: the value stays in form state, it simply has no
          input. */}
      {unitId === undefined &&
        (showCode ? (
          <label className="text-sm">
            <span className={LABEL}>Code</span>
            <input
              className={FIELD}
              value={value.code}
              placeholder={derived}
              onChange={(e) => {
                onChange({ ...value, code: e.target.value })
              }}
            />
          </label>
        ) : (
          <div className="flex items-end pb-1.5 text-sm">
            <button
              type="button"
              onClick={() => {
                setShowCode(true)
              }}
              className="text-muted-foreground hover:text-foreground text-xs font-medium hover:underline"
            >
              Code will be “{derived || '…'}” — set it manually
            </button>
          </div>
        ))}

      <label className="text-sm">
        <span className={LABEL}>Area</span>
        <select
          className={FIELD}
          value={value.area}
          onChange={(e) => {
            onChange({ ...value, area: e.target.value })
          }}
        >
          {areas.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        <span className={LABEL}>Parent unit</span>
        {/* The subdivide/combine hierarchy (spec §3.2). Nothing validates a
            merge against this tree — see docs/architecture/lodging-occupancy.md
            for why that was tried and removed. It models physical structure,
            and drives the bathroom_group upgrade when a merge covers a whole
            group.

            Scoped to the Area chosen above, so switching area re-scopes the
            buildings on offer. See ./unitTree for why the unit's existing
            parent survives that narrowing regardless. */}
        <select
          className={FIELD}
          value={value.parent_unit}
          onChange={(e) => {
            onChange({ ...value, parent_unit: e.target.value })
          }}
        >
          <option value="">No parent</option>
          {parentCandidates(unitId, units, value.area, inventoryClass).map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      </label>

      {/* Registry default for the whole-let container merge (spec task 8).
          Rendered on containers only — a leaf has nothing to stop descending
          past. Disabled once an ancestor already carries the flag: at most
          one node per root-to-leaf path may hold it meaningfully, since
          combined means "draw the card here and stop descending" and an
          ancestor already owns the card.

          This is a UX guard, not a correctness requirement — `drawnUnits`
          (frontend/src/components/weekend/unitLevel.ts) resolves top-down and
          takes the highest combined node on a path, so the board cannot be
          made ambiguous even by a direct database write that skipped this
          picker. See `combinedAncestor` in ./unitTree for the ancestor walk. */}
      {isContainer && (
        <div className="text-sm sm:col-span-2">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={combined}
              disabled={blockingAncestor !== undefined}
              onChange={(e) => {
                onCombinedChange(e.target.checked)
              }}
            />
            Let as one — draw this building as a single card
          </label>
          {blockingAncestor && (
            <p className="text-muted-foreground pl-6 text-xs">
              Already combined by “{blockingAncestor.name}” — only one card per branch.
            </p>
          )}
        </div>
      )}
    </>
  )
}
