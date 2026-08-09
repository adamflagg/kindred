/**
 * Does the stored shareability still agree with the unit in front of you?
 *
 * `lodging_units.shareability` is DERIVED ONCE — by 1500000145's backfill on
 * production, by `classifyShareability` (registry.go) on a fresh database — and
 * is then owned by a human. Nothing re-derives it. That is deliberate: the
 * registry is canonical, and a rule that silently overwrote a staffer's ruling
 * every time a neighbouring field moved would be worse than no rule.
 *
 * The cost of that choice is that the INPUTS can move out from under the
 * answer. `sleeps` is staff-owned and editable in this same form;
 * `inventory_class` and `is_container` are two controls above it. A staffer who
 * corrects a cabin from `sleeps: 15` to `sleeps: 8` leaves it marked
 * `shareable`, and the board goes on rendering an affirmative "Shared OK" chip
 * inviting a second household into a room the rule now says holds one — the
 * exact double-booking kindred#2026 exists to prevent, now endorsed.
 *
 * So this states the disagreement and asks nothing. NO "apply" BUTTON, for the
 * same reason `capacityFlag`'s conflict branch has none: settling it is a
 * ruling about who may sleep where, and a one-click overwrite of a human's
 * classification by a derived guess is precisely the automation the select was
 * chosen over a bool to avoid.
 *
 * BOTH DIRECTIONS are reported, not just the permissive one. `shareable` gone
 * stale is the hazard; `single_party` gone stale silently costs the camp a
 * cabin's worth of capacity every weekend, which staff also want to know.
 *
 * SILENT on the states where there is nothing honest to say: an unclassified
 * unit (no answer has drifted — the board already badges that), an unmeasured
 * leaf (the rule declines to classify it, so there is nothing to disagree
 * with), an unrecorded role, and a container's capacity (a container's `sleeps`
 * is a DELTA over its rooms, kindred#2041, so a small number on one is not
 * evidence).
 *
 * THE RULE ITSELF IS NOT RESTATED HERE AS A NEW SOURCE OF TRUTH — it is the
 * third and last expression of the one in 1500000145's header and
 * registry.go's `classifyShareability`, and it exists only to say when the
 * stored value and the rule disagree. If you change the rule, change all three.
 */
import type { InventoryClassValue, ShareabilityStoredValue } from '../../../types/lodging'

export interface ShareabilityDriftInput {
  inventoryClass: InventoryClassValue | ''
  isContainer: boolean
  /** The raw form string. Blank is a real value: UNKNOWN. */
  sleeps: string
  stored: ShareabilityStoredValue
}

export interface ShareabilityDrift {
  stored: 'shareable' | 'single_party'
  derived: 'shareable' | 'single_party'
}

/** The classification the rule would give, or '' when it declines to answer. */
function derive(input: ShareabilityDriftInput): ShareabilityStoredValue {
  if (input.inventoryClass === 'staff_default') return 'single_party'
  if (input.inventoryClass !== 'family_pool') return ''
  if (input.isContainer) return 'shareable'
  // Blank and 0 are both UNMEASURED — PocketBase stores an unset number as 0,
  // and this codebase reads 0 as unknown, never as "zero capacity".
  const sleeps = Number.parseInt(input.sleeps, 10)
  if (!Number.isFinite(sleeps) || sleeps < 1) return ''
  return sleeps >= 12 ? 'shareable' : 'single_party'
}

export function shareabilityDrift(input: ShareabilityDriftInput): ShareabilityDrift | null {
  if (input.stored === '') return null
  const derived = derive(input)
  if (derived === '' || derived === input.stored) return null
  return { stored: input.stored, derived }
}
