/**
 * The one legitimate bridge between React's commit and the merge/split
 * morph. A CLASS component on purpose: `getSnapshotBeforeUpdate` is the
 * only React hook that runs after render but BEFORE the DOM mutates —
 * the vanishing room cards are still mounted and measurable there.
 *
 * The commit it usually rides is the GESTURE's own: since the click-time
 * view overlay (kindred#2537), `LodgingBoard`'s `overrideDrawLevel`
 * swaps the drawn level synchronously at the click, and that setState is
 * what moves `slotCodes` — so the capture's synchronous-commit dependency
 * attaches THERE (wrapping it in startTransition would split the snapshot
 * from the commit it measures). The roster refetch is the FALLBACK
 * animating commit — a hinted swap arriving with no overlay — and the
 * reconciler of the overlay afterwards. `componentDidUpdate` plays the
 * morph after mutation, before paint. No optimistic cache layer anywhere:
 * `useUnitMerge`'s documented refusal stands untouched.
 *
 * Renders its children untouched — no wrapper element, no layout effect.
 */
import { Component, type ReactNode } from 'react'

import type { LodgingUnitRow } from '../../types/lodging'
import { clearBoardMorphHint, peekBoardMorphHint, planBoardMorph } from './boardMorph'
import {
  type BoardMorphRunner,
  type BoardMorphSnapshot,
  defaultBoardMorphRunner,
} from './boardMorphRunner'

interface BoardMorphBoundaryProps {
  /** The drawn cards' codes, in render order — the board's identity. */
  slotCodes: readonly string[]
  unitsByCode: ReadonlyMap<string, LodgingUnitRow>
  /** Injectable for tests; the GSAP runner otherwise. */
  runner?: BoardMorphRunner
  /**
   * Optional on purpose: the boundary reads the DOM globally (cards carry
   * `data-unit-code`), so it works as a childless OBSERVER sibling of the
   * grid — React runs every `getSnapshotBeforeUpdate` before ANY mutation
   * in the commit and every `componentDidUpdate` after all of them, so
   * siblinghood changes nothing while sparing the grid a reindent.
   */
  children?: ReactNode
}

export class BoardMorphBoundary extends Component<BoardMorphBoundaryProps> {
  override getSnapshotBeforeUpdate(prev: BoardMorphBoundaryProps): BoardMorphSnapshot | null {
    if (prev.slotCodes === this.props.slotCodes) return null
    const op = planBoardMorph(
      prev.slotCodes,
      this.props.slotCodes,
      this.props.unitsByCode,
      peekBoardMorphHint()
    )
    if (op === null) return null
    // Consumed on the swap it announced, whether or not capture succeeds —
    // a declined capture (collapsed area, no layout) must not leave the
    // hint armed for a later unrelated swap.
    clearBoardMorphHint()
    return (this.props.runner ?? defaultBoardMorphRunner).capture(op)
  }

  override componentDidUpdate(
    _prev: BoardMorphBoundaryProps,
    _state: never,
    snapshot: BoardMorphSnapshot | null
  ): void {
    if (snapshot !== null) (this.props.runner ?? defaultBoardMorphRunner).play(snapshot)
  }

  override render(): ReactNode {
    return this.props.children ?? null
  }
}
