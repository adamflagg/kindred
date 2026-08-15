/**
 * How many the unit sleeps, and the beds behind that number.
 *
 * `sleeps` is three-state and blank means UNKNOWN: PocketBase stores an unset
 * number as 0 (columns are NUMERIC DEFAULT 0 NOT NULL, never NULL), so a
 * stored 0 renders as a BLANK field and a blank field submits no `sleeps` key.
 *
 * The bed inventory only ever SUGGESTS an occupancy — capacity depends on bed
 * size and on who can share a bed, which no table knows. Staff adopt the
 * suggestion in one click; nothing writes `sleeps` for them.
 *
 * WHICH of the two advisory states shows, and the far larger set of rows where
 * neither does, is `capacityFlag` — read its header before changing anything
 * here. This file only renders what that decides.
 *
 * A CONTAINER's Sleeps field carries a second, unrelated bit of help text:
 * the whole-house figure derived from its rooms (kindred#2079). It is not
 * part of the capacity flag above — that rule is silent on every container,
 * deliberately (its own beds are not the building's) — and it never writes
 * anything. See derivedCapacity.ts for the arithmetic and the owner ruling
 * it implements: offer the number, never populate the field with it.
 */
import { type BedInventory } from '../../../types/beds'
import type { LodgingUnitRecord } from '../../../types/lodging'
import { BedInventoryEditor } from './BedInventoryEditor'
import { capacityFlag } from './capacityFlag'
import { activeLeavesUnder, derivedWholeHouseSleeps } from './derivedCapacity'
import { FIELD, LABEL } from './lodgingStyles'
import { parseSleeps } from './sleepsValue'

export interface UnitCapacity {
  /** A string because blank is a real value: UNKNOWN. */
  sleeps: string
  beds: BedInventory
}

export interface UnitCapacityFieldsProps {
  value: UnitCapacity
  onChange: (next: UnitCapacity) => void
  /**
   * Live amenity-confirmation state, not the stored row. A staffer who ticks
   * "confirmed" has ruled, and the flag should stop arguing immediately rather
   * than at the next reload.
   */
  isConfirmed: boolean
  isContainer: boolean
  /**
   * The unit being edited, and every unit in the registry — together they
   * let this derive the whole-house figure from stored rooms. `unit` is
   * `undefined` on CREATE, where there is no id yet to look up children by,
   * so nothing derives.
   */
  unit: LodgingUnitRecord | undefined
  units: LodgingUnitRecord[]
}

export function UnitCapacityFields({
  value,
  onChange,
  isConfirmed,
  isContainer,
  unit,
  units,
}: UnitCapacityFieldsProps) {
  const flag = capacityFlag({ beds: value.beds, sleeps: value.sleeps, isConfirmed, isContainer })

  // Gated on having at least one room to sum, not just on `derivedSleeps`
  // being non-null: a childless container's total IS its own delta, and
  // printing that delta a second time under a "derived from rooms" label
  // would be noise — no room contributed anything to it.
  const derivedSleeps =
    isContainer && unit && activeLeavesUnder(unit.id, units).length > 0
      ? derivedWholeHouseSleeps(unit.id, parseSleeps(value.sleeps) ?? 0, units)
      : null

  return (
    <>
      <div className="text-sm">
        <label>
          <span className={LABEL}>Sleeps</span>
          <input
            className={FIELD}
            type="number"
            min={1}
            value={value.sleeps}
            placeholder="Unknown"
            onChange={(e) => {
              onChange({ ...value, sleeps: e.target.value })
            }}
          />
        </label>
        {/* A SIBLING of the label, not a child of it — nesting it inside
            would fold this text into the label's accessible name and break
            every `getByLabelText('Sleeps')` lookup, this file's own tests
            included.

            READ-ONLY. Plain helper text, same treatment as the suggestion
            copy below — no new colour, chip or control. Reacts live to the
            field above because it reads the value being TYPED
            (`value.sleeps`), not the last-saved one — the same choice
            `capacityFlag` already makes for its conflict/suggestion text. */}
        {derivedSleeps !== null && (
          <p className="text-muted-foreground mt-1.5 text-xs">
            Derived from rooms: sleeps {derivedSleeps}
          </p>
        )}
      </div>

      <div className="text-sm">
        <span className={LABEL}>Beds</span>
        <BedInventoryEditor
          beds={value.beds}
          onChange={(beds) => {
            onChange({ ...value, beds })
          }}
        />
        {/* No AT users here (frontend/CLAUDE.md "Accessibility —
            deliberately minimal"), so this stays plain text — no
            aria-live/role="status" (kindred#2379). */}
        <div>
          {flag.kind === 'suggestion' && (
            <div className="text-muted-foreground mt-1.5 flex items-center gap-2 text-xs">
              <span>Suggested: sleeps {flag.derived}</span>
              <button
                type="button"
                onClick={() => {
                  onChange({ ...value, sleeps: String(flag.derived) })
                }}
                className="text-primary font-medium hover:underline"
              >
                Use suggested
              </button>
            </div>
          )}

          {/* Deliberately no button. Settling this means knowing whether there
              is a mattress on the floor, which is a walk to the cabin, not a
              click — and half of these are +1, where the likeliest explanation
              is a family doubling up and the staff number being right. So it
              states both numbers and asks nothing. */}
          {flag.kind === 'conflict' && (
            <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
              Beds account for {flag.derived}, but sleeps says {flag.sleeps}.
            </p>
          )}
        </div>

        {/* The Master Housing sheet's `Capacity` column is deliberately NOT
            shown beside these. It reads as a corroborating third number and is
            not one: it agrees with the bed count on only 42 of the 88 units
            carrying both, and sits BELOW the physical bed count on 33 — thirty
            of those at exactly -1, with no cause derivable from the beds, since
            identical bed compositions land on different capacities. Half the
            conflicts this flag raises are themselves ±1, so a column with ±1
            systematic noise cannot adjudicate them. It would lend confidence
            it has not earned. */}
      </div>
    </>
  )
}
