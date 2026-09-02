/**
 * The board's collision policy — which cabin a drag is "over".
 *
 * The two dnd-kit algorithms are injected, so these assert the POLICY without
 * building a droppable registry and measured rects. Ids are the PRODUCTION
 * shapes from `dragPlacement` — `weekend-unit:*`, `merge:*`, and the floating
 * queue's `weekend-unplaced` — because the first version of this file used
 * `unit:a`-style ids and could not distinguish a namespace-blind
 * implementation from a correct one. Fictional data throughout.
 */
import type { pointerWithin } from '@dnd-kit/core'
import { describe, expect, it } from 'vitest'

import { createBoardCollisionDetection } from './boardCollision'
import { UNPLACED_DROPPABLE_ID, mergeDragId, unitDroppableId } from './dragPlacement'

type CollisionArgs = Parameters<typeof pointerWithin>[0]
type Collisions = ReturnType<typeof pointerWithin>

const CEDAR = unitDroppableId('cedar-1')
const WILLOW = unitDroppableId('willow-2')
const ASPEN = unitDroppableId('aspen-3')
const MERGE_CEDAR = mergeDragId('cedar-1')
const MERGE_WILLOW = mergeDragId('willow-2')

const hit = (id: string) => ({ id, data: { droppableContainer: undefined, value: 0 } })

/** The two lists a given pointer position would produce, carried on the args. */
interface Staged {
  pointer: string[]
  rect: string[]
}

function stage(pointer: string[], rect: string[]): CollisionArgs {
  return { pointer, rect } as unknown as CollisionArgs
}

function detector() {
  return createBoardCollisionDetection({
    pointerWithin: (args: CollisionArgs): Collisions =>
      (args as unknown as Staged).pointer.map(hit),
    rectIntersection: (args: CollisionArgs): Collisions =>
      (args as unknown as Staged).rect.map(hit),
  })
}

const ids = (collisions: Collisions) => collisions.map((collision) => String(collision.id))

describe('createBoardCollisionDetection', () => {
  it('returns the pointer hit when the pointer is inside a cabin', () => {
    const detect = detector()
    expect(ids(detect(stage([CEDAR], [WILLOW])))).toEqual([CEDAR])
  })

  it('HOLDS the last cabin the pointer was inside while crossing a gutter', () => {
    const detect = detector()
    detect(stage([CEDAR], [CEDAR, WILLOW]))
    // In the gutter the overlay overlaps Willow most — but Cedar is still
    // intersecting, and Cedar is where the pointer actually was.
    expect(ids(detect(stage([], [WILLOW, CEDAR])))).toEqual([CEDAR])
  })

  it('holds a merge sibling the same way during a merge drag', () => {
    const detect = detector()
    detect(stage([MERGE_CEDAR], [MERGE_CEDAR, MERGE_WILLOW]))
    expect(ids(detect(stage([], [MERGE_WILLOW, MERGE_CEDAR])))).toEqual([MERGE_CEDAR])
  })

  it('NEVER holds the floating unplaced queue', () => {
    const detect = detector()
    // The pointer crosses the queue — a fixed overlay that floats above the
    // grid — then moves on into a gutter where the queue's big rect still
    // intersects the overlay. The hold must not let the queue suppress the
    // cabins beneath: a release here would UNPLACE the family.
    detect(stage([UNPLACED_DROPPABLE_ID], [UNPLACED_DROPPABLE_ID, CEDAR]))
    expect(ids(detect(stage([], [UNPLACED_DROPPABLE_ID, CEDAR])))).toEqual([
      UNPLACED_DROPPABLE_ID,
      CEDAR,
    ])
  })

  it('crossing the queue also RELEASES a cabin held before it', () => {
    const detect = detector()
    detect(stage([CEDAR], [CEDAR]))
    detect(stage([UNPLACED_DROPPABLE_ID], [UNPLACED_DROPPABLE_ID, CEDAR]))
    // Cedar's hold must not survive the trip through the queue: the pointer
    // has demonstrably left it.
    expect(ids(detect(stage([], [UNPLACED_DROPPABLE_ID, CEDAR])))).toEqual([
      UNPLACED_DROPPABLE_ID,
      CEDAR,
    ])
  })

  it('a cabin-first gutter frame TARGETS the cabin after crossing the queue', () => {
    // The drop target is `collisions[0]`. The queue-first frames above cannot
    // tell a correct implementation from one that returns the queue alone —
    // `over` is the queue either way. This frame stages the cabin sorting
    // FIRST, where a lingering queue hold would flip the target from cabin to
    // queue: the difference between placing the family and UNPLACING it.
    const detect = detector()
    detect(stage([UNPLACED_DROPPABLE_ID], [UNPLACED_DROPPABLE_ID, CEDAR]))
    const result = ids(detect(stage([], [CEDAR, UNPLACED_DROPPABLE_ID])))
    expect(result[0]).toBe(CEDAR)
  })

  it('the queue releases the hold even when a cabin sorts ahead of it', () => {
    // `pointerWithin` ranks by corner distance, so a card under the queue's
    // large expanded panel can sort ahead of `weekend-unplaced`. The pointer
    // is inside the queue either way, and the release must key on the
    // queue's PRESENCE among the pointer hits, not on it winning first place.
    const detect = detector()
    detect(stage([CEDAR], [CEDAR]))
    detect(stage([WILLOW, UNPLACED_DROPPABLE_ID], [WILLOW, UNPLACED_DROPPABLE_ID, CEDAR]))
    expect(ids(detect(stage([], [UNPLACED_DROPPABLE_ID, CEDAR, WILLOW])))).toEqual([
      UNPLACED_DROPPABLE_ID,
      CEDAR,
      WILLOW,
    ])
  })

  it('an EMPTY frame does not end the hold', () => {
    // A frame with no usable rects at all — the drag rect over whitespace
    // past the last section, or a transient re-measure — proves nothing
    // about the held cabin. Only a frame that produced rects WITHOUT the
    // held cabin shows the drag has genuinely left it; clearing on emptiness
    // re-admits the flapping for the rest of the gesture.
    const detect = detector()
    detect(stage([CEDAR], [CEDAR]))
    detect(stage([], []))
    expect(ids(detect(stage([], [WILLOW, CEDAR])))).toEqual([CEDAR])
  })

  it('falls back to rect intersection once the held cabin no longer intersects', () => {
    const detect = detector()
    detect(stage([CEDAR], [CEDAR]))
    expect(ids(detect(stage([], [ASPEN])))).toEqual([ASPEN])
  })

  it('a hold does NOT resurrect after the held cabin has dropped out once', () => {
    const detect = detector()
    detect(stage([CEDAR], [CEDAR]))
    // The drag travels far away: Cedar stops intersecting, the fallback
    // speaks. That moment ENDS the hold —
    detect(stage([], [ASPEN]))
    // — so when the ~200px overlay later slides back across Cedar while the
    // pointer sits in a gutter beside Willow, Cedar must not steal the drop.
    expect(ids(detect(stage([], [WILLOW, CEDAR])))).toEqual([WILLOW, CEDAR])
  })

  it('forgets the held cabin when the gesture resets', () => {
    const detect = detector()
    detect(stage([CEDAR], [CEDAR]))
    detect.reset()
    expect(ids(detect(stage([], [WILLOW, CEDAR])))).toEqual([WILLOW, CEDAR])
  })

  it('re-holds on the new cabin once the pointer enters one', () => {
    const detect = detector()
    detect(stage([CEDAR], [CEDAR]))
    detect(stage([WILLOW], [WILLOW, CEDAR]))
    expect(ids(detect(stage([], [CEDAR, WILLOW])))).toEqual([WILLOW])
  })
})
