/**
 * The one legitimate bridge between React's commit and the merge/split
 * morph. A CLASS component on purpose: `getSnapshotBeforeUpdate` is the
 * only React hook that runs after render but BEFORE the DOM mutates —
 * the vanishing room cards are still mounted and measurable there, which
 * is what makes capture-at-refetch-arrival possible without an optimistic
 * cache layer (`useUnitMerge`'s documented refusal stands untouched).
 * `componentDidUpdate` then plays the morph after mutation, before paint.
 *
 * The snapshot capture depends on React Query v5 delivering roster updates
 * synchronously (useSyncExternalStore). Wrapping the roster query in
 * startTransition/useDeferredValue would split the snapshot from the
 * mutation it measures — see the sentinel note at `useWeekendRoster`.
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
