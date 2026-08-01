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
import { FIELD, LABEL, SECTION } from './lodgingStyles'
import { slugify } from './unitCode'
import { parentCandidates } from './unitTree'

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
}

export function UnitIdentityFields({
  value,
  onChange,
  areas,
  units,
  unitId,
}: UnitIdentityFieldsProps) {
  const [showCode, setShowCode] = useState(false)
  const derived = slugify(value.name)

  return (
    <>
      <p className={SECTION}>Identity</p>

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

      {showCode || unitId !== undefined ? (
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
      )}

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
            group. */}
        <select
          className={FIELD}
          value={value.parent_unit}
          onChange={(e) => {
            onChange({ ...value, parent_unit: e.target.value })
          }}
        >
          <option value="">No parent</option>
          {parentCandidates(unitId, units).map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      </label>
    </>
  )
}
