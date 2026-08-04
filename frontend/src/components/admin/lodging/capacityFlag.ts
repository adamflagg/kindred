/**
 * Does the bed inventory disagree with the number staff maintain?
 *
 * ADVISORY ONLY. Nothing here writes `sleeps` — it is STAFF_OWNED in
 * apply_lodging_inventory.py and stays the number every consumer reads. The
 * suggestion populates a form field the human then saves like any other edit.
 *
 * THE RULE IS DIRECTION, NOT MAGNITUDE, and that is the whole design.
 *
 * "Flag wherever they differ" fires on 49 of the 92 derivable rows. Most of
 * that is not disagreement, because the two numbers answer different
 * questions: `sleeps` is seeded from OBSERVED peak occupancy across 2024-25
 * assignments, while derived capacity counts furniture. A 15-bed camper cabin
 * let to one family is observed at 5. So `sleeps` BELOW derived carries no
 * information — derived is an upper bound and being under it is the normal
 * case. Only the two states below are worth a human's attention, and they come
 * to 27 flags across 114 units.
 *
 * There is no threshold here on purpose. A tunable percentage would be a knob
 * nobody can set correctly, and the two real states are categorical.
 */
import { suggestedSleeps, type BedInventory } from '../../../types/beds'

export type CapacityFlag =
  /** Render nothing at all. Not a quiet badge — nothing. */
  | { kind: 'silent' }
  /** Nobody has said yet. Offer the number; one click fills the field. */
  | { kind: 'suggestion'; derived: number }
  /** Staff claim more people than the beds account for. No one-click fix. */
  | { kind: 'conflict'; derived: number; sleeps: number }

export interface CapacityFlagInput {
  /** Live form state, already normalised by the caller. */
  beds: BedInventory
  /** The raw input string, because blank is a real value: UNKNOWN. */
  sleeps: string
  /** Live checkbox state, not the stored row — it is what the save will store. */
  isConfirmed: boolean
  isContainer: boolean
}

export function capacityFlag({
  beds,
  sleeps,
  isConfirmed,
  isContainer,
}: CapacityFlagInput): CapacityFlag {
  // Staff have already ruled on this row. apply_lodging_inventory.py withholds
  // every non-notes change from a confirmed unit for the same reason: someone
  // stood in the cabin, and that beats a sum over a spreadsheet column.
  if (isConfirmed) return { kind: 'silent' }

  // A container's beds are not the building's. The only one carrying any holds
  // just the shared living-room futon while its four child rooms carry their
  // own, so comparing it against a whole-house `sleeps` compares two different
  // things and produces a conflict that means nothing.
  if (isContainer) return { kind: 'silent' }

  const derived = suggestedSleeps(beds)
  // 0 means UNKNOWN, exactly as it does for `sleeps` — never "sleeps nobody".
  // Covers a null column (21 units nobody has surveyed), an empty list, and an
  // inventory whose every type is outside BED_TYPES, which suggestedSleeps
  // drops SILENTLY. All three are "nothing to derive from", and a badge on any
  // of them would assert a fact the data does not carry.
  if (derived === 0) return { kind: 'silent' }

  const staff = Number.parseInt(sleeps, 10)
  if (!Number.isFinite(staff) || staff <= 0) return { kind: 'suggestion', derived }

  if (staff > derived) return { kind: 'conflict', derived, sleeps: staff }

  // Under, or exactly equal. The 65-row silence the rule exists to produce.
  return { kind: 'silent' }
}
