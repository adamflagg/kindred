/**
 * Pure helpers for the bunk-swap action (#1546).
 *
 * `isEligibleSwapTarget` gates which bunks can appear in the swap picker;
 * `swapBunks` orchestrates the moves through an injected `moveCamper`
 * callback so the React component layer stays thin and the logic is
 * unit-testable without booting the query client.
 */
import type { BunkWithCampers } from '../types/app-types'
import { getBunkType } from './bunkNaming'

/**
 * True when `candidate` is a valid target to swap with `source`. Filters:
 *   - candidate is not the source itself,
 *   - candidate is not the "Removed cabin" placeholder (a bunk dropped from
 *     this session's plan but still referenced by stranded assignments),
 *   - neither side is an AG bunk (AG sessions use sub-bunking),
 *   - same gender on both sides (cross-gender swap is a hard block, not a
 *     warning).
 */
export function isEligibleSwapTarget(source: BunkWithCampers, candidate: BunkWithCampers): boolean {
  if (candidate.id === source.id) return false
  if (candidate.name === 'Removed cabin') return false
  if (getBunkType(source.name) === 'AG') return false
  if (getBunkType(candidate.name) === 'AG') return false
  return candidate.gender === source.gender
}

/**
 * Swap the entire camper rosters between two bunks. Calls `moveCamper`
 * once per camper in both bunks — N + M total moves for bunks with N and M
 * occupants. Promises are awaited in parallel via Promise.all; rejection
 * of any single move bubbles out as the rejection of swapBunks.
 *
 * Not atomic: a mid-loop failure leaves the bunks in a partial-swap state.
 * Acceptable for v1 — moveCamper already toasts per-call errors and staff
 * can re-swap to recover.
 *
 * Lock-group invariant: lock groups are guaranteed to live entirely within
 * a single bunk (the solver and DnD path both enforce this). Swapping
 * bunkA ↔ bunkB therefore relocates whole lock groups together — group
 * members in bunkA all move to bunkB and vice versa — without any
 * group-aware logic here. This relies on the upstream invariant; if a
 * group ever ends up split across two unrelated bunks, that's a separate
 * bug to fix at the source, not here.
 */
export async function swapBunks(
  bunkA: BunkWithCampers,
  bunkB: BunkWithCampers,
  moveCamper: (camperId: string, bunkId: string) => Promise<void>
): Promise<void> {
  const aToB = bunkA.campers.map((c) => moveCamper(c.id, bunkB.id))
  const bToA = bunkB.campers.map((c) => moveCamper(c.id, bunkA.id))
  await Promise.all([...aToB, ...bToA])
}
