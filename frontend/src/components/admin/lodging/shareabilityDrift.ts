/**
 * Does the stored shareability still agree with the unit in front of you?
 *
 * `lodging_units.shareability` is DERIVED ONCE — by 1500000145's backfill on
 * production, by `classifyShareability` (registry.go) on a fresh database — and
 * is then owned by a human. Nothing re-derives it. That is deliberate: the
 * registry is canonical, and a rule that silently overwrote a staffer's ruling
 * every time a neighbouring field moved would be worse than no rule.
 *
 * THE LEAF COMPARISON IS RETIRED (kindred#2331, owner ruling D17, 2026-08-14).
 * A family_pool LEAF's shareability used to be re-derivable from `sleeps >= 12`
 * here, matching `classifyShareability`. That threshold never matched anything
 * real — no leaf in the inventory ever reaches 12 — and the owner's actual
 * rule is now a CURATED fact per unit in the registry file, not a formula over
 * `sleeps`. There is nothing left in a form's live values for a leaf to
 * compare `stored` against, so `derive` below declines to answer for a leaf
 * the same way it already declined for an unrecorded role: no live rule, no
 * drift to report. Reporting one here off the retired threshold would warn on
 * every leaf a staffer correctly curates shareable below 12 — the "every staff
 * correction warns forever" failure the retirement exists to close.
 *
 * The CONTAINER and staff_default legs are UNCHANGED: both are still real,
 * live-computable rules (container-ness, and the housing role) rather than
 * curated facts, so the cost that motivated this file in the first place still
 * applies to them. `inventory_class` and `is_container` are controls in this
 * same form. A staffer who reclassifies a cabin to `staff_default` leaves it
 * marked `shareable`, and the board goes on rendering an affirmative
 * "Shared OK" chip on a room that is no longer family-camp inventory at all.
 *
 * So this states the disagreement and asks nothing. NO "apply" BUTTON, for the
 * same reason `capacityFlag`'s conflict branch has none: settling it is a
 * ruling about who may sleep where, and a one-click overwrite of a human's
 * classification by a derived guess is precisely the automation the select was
 * chosen over a bool to avoid.
 *
 * BOTH DIRECTIONS are reported, not just the permissive one, for what remains.
 *
 * SILENT on the states where there is nothing honest to say: an unclassified
 * unit (no answer has drifted — the board already badges that), any LEAF
 * (retired, above), and an unrecorded role.
 *
 * `sleeps` IS NO LONGER AN INPUT AT ALL, and that is structural rather than
 * conventional. The leaf leg was its only reader; the container leg never
 * consulted it (a container's `sleeps` is a DELTA over its rooms,
 * kindred#2041, so a small number on one is not evidence) and staff_default
 * answers from the role. Taking it off `ShareabilityDriftInput` is what stops
 * the retired threshold being reintroduced here by someone who reads the
 * field as an invitation.
 *
 * THE RULE ITSELF IS NOT RESTATED HERE AS A NEW SOURCE OF TRUTH for the two
 * legs that remain — it is the second live expression of the one in
 * `registry.go`'s `classifyShareability` (1500000145's header is the historical
 * record of what already-applied production rows were classified from, and is
 * frozen). If you change the container or staff_default rule, change both.
 */
import type { InventoryClassValue, ShareabilityStoredValue } from '../../../types/lodging'

export interface ShareabilityDriftInput {
  inventoryClass: InventoryClassValue | ''
  isContainer: boolean
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
  // A LEAF's shareability is a CURATED registry fact (kindred#2331), not
  // derived from `sleeps` — there is no live rule left to compare `stored`
  // against, so this declines to answer for the same reason an unrecorded
  // role does.
  return ''
}

export function shareabilityDrift(input: ShareabilityDriftInput): ShareabilityDrift | null {
  if (input.stored === '') return null
  const derived = derive(input)
  if (derived === '' || derived === input.stored) return null
  return { stored: input.stored, derived }
}
