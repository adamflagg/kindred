/**
 * Merge/split morph PLANNING — pure over the board's drawn-card identity.
 *
 * When staff merge rooms into a building (or split one back), the refetch
 * lands as ONE commit that unmounts the room cards and mounts the container
 * (or the reverse). This module decides whether that commit is a morph worth
 * animating and, if so, which cards play which role. The imperative half —
 * GSAP Flip, clones, the overlay — lives in `boardMorphRunner.ts`; keeping
 * the decision pure is what makes it testable in jsdom, where rects are 0x0
 * and nothing can visibly move.
 *
 * ── THE HINT GATE, and why an unhinted swap NEVER animates ────────────────
 *
 * A weekend or scenario switch can legitimately replace a split board with a
 * merged one in a single commit. Animating that would smoothly depict a
 * merge nobody performed — the legible-lie class kindred#2518 removed from
 * this board. So the three merge/split write sites announce their gesture
 * here (`setBoardMorphHint`) with the code of the card staff acted on, and
 * `planBoardMorph` refuses any swap the hint does not vouch for. The hint
 * expires (a failed write must not arm an animation for a later unrelated
 * swap) and is consumed by the boundary on use.
 *
 * The anchor is the owner's ruling made mechanical (spec D26): the merged
 * building flows ONTO the card staff clicked; rooms fly OUT of the container
 * card they split. For a merge the hint names that card.
 */
import type { LodgingUnitRow } from '../../types/lodging'

export interface MergeMorphOp {
  type: 'merge'
  containerCode: string
  /** The vanished room cards, in the PREVIOUS render's order. */
  leaverCodes: string[]
  /** The card the building morphs FROM — the one staff acted on. */
  anchorCode: string
}

export interface SplitMorphOp {
  type: 'split'
  containerCode: string
  /** The appeared room cards, in the NEXT render's order. */
  enterCodes: string[]
}

export type BoardMorphOp = MergeMorphOp | SplitMorphOp

/** A write announced but never confirmed is stale after this long. */
const HINT_TTL_MS = 15_000

let hint: { code: string; at: number } | null = null

export function setBoardMorphHint(code: string, now: number = performance.now()): void {
  hint = { code, at: now }
}

export function peekBoardMorphHint(now: number = performance.now()): string | null {
  if (hint === null) return null
  if (now - hint.at > HINT_TTL_MS) {
    hint = null
    return null
  }
  return hint.code
}

export function clearBoardMorphHint(): void {
  hint = null
}

/**
 * Walk `code`'s parent chain and report whether it passes through
 * `ancestorCode`. Bounded: the registry is three levels deep today, and a
 * cycle in bad data must not hang the render.
 */
function isUnder(
  code: string,
  ancestorCode: string,
  unitsByCode: ReadonlyMap<string, LodgingUnitRow>
): boolean {
  let current = unitsByCode.get(code)
  for (let hops = 0; current !== undefined && hops < 10; hops++) {
    const parent = current.parent_code ?? ''
    if (parent === '') return false
    if (parent === ancestorCode) return true
    current = unitsByCode.get(parent)
  }
  return false
}

/**
 * Decide whether the commit that replaced `prevCodes` with `nextCodes` is
 * the hinted merge or split, and return its op — or null for everything
 * else: no hint, an unrelated hint, a same-identity rerender, or units that
 * appeared/vanished without a container relationship.
 */
export function planBoardMorph(
  prevCodes: readonly string[],
  nextCodes: readonly string[],
  unitsByCode: ReadonlyMap<string, LodgingUnitRow>,
  hintCode: string | null
): BoardMorphOp | null {
  if (hintCode === null) return null
  const prevSet = new Set(prevCodes)
  const nextSet = new Set(nextCodes)
  const vanished = prevCodes.filter((code) => !nextSet.has(code))
  const appeared = nextCodes.filter((code) => !prevSet.has(code))
  if (vanished.length === 0 || appeared.length === 0) return null

  // Merge: a container card appeared and the cards that vanished are the
  // rooms it covers (any depth — merging a house swallows grandchildren).
  for (const containerCode of appeared) {
    if (unitsByCode.get(containerCode)?.is_container !== true) continue
    const leaverCodes = vanished.filter((code) => isUnder(code, containerCode, unitsByCode))
    if (leaverCodes.length === 0) continue
    if (hintCode !== containerCode && !leaverCodes.includes(hintCode)) continue
    const anchorCode = leaverCodes.includes(hintCode) ? hintCode : leaverCodes[0]
    if (anchorCode === undefined) continue
    return { type: 'merge', containerCode, leaverCodes, anchorCode }
  }

  // Split: a container card vanished and the cards that appeared are its
  // rooms. The container itself is the anchor — rooms fly OUT of it.
  for (const containerCode of vanished) {
    if (unitsByCode.get(containerCode)?.is_container !== true) continue
    const enterCodes = appeared.filter((code) => isUnder(code, containerCode, unitsByCode))
    if (enterCodes.length === 0) continue
    if (hintCode !== containerCode && !enterCodes.includes(hintCode)) continue
    return { type: 'split', containerCode, enterCodes }
  }

  return null
}
