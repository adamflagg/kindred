/**
 * Pure helpers for the bunk-swap action (#1546).
 *
 * `isEligibleSwapTarget` gates which bunks can appear in the swap picker;
 * `swapBunks` orchestrates the moves through an injected `moveCamper`
 * callback so the React component layer stays thin and the logic is
 * unit-testable without booting the query client.
 */
import type { BunkWithCampers } from '../types/app-types'
import { getBunkType } from '../components/BunkSocialGraphModal'

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
