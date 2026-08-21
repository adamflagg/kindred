/**
 * The board's collision policy — which cabin a drag is "over".
 *
 * The two dnd-kit algorithms are injected, so these assert the POLICY without
 * building a droppable registry and measured rects. Fictional data throughout.
 */
import type { pointerWithin } from '@dnd-kit/core'
import { describe, expect, it } from 'vitest'

import { createBoardCollisionDetection } from './boardCollision'

type CollisionArgs = Parameters<typeof pointerWithin>[0]
type Collisions = ReturnType<typeof pointerWithin>

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
      (args as unknown as Staged).pointer.map(hit) as Collisions,
    rectIntersection: (args: CollisionArgs): Collisions =>
      (args as unknown as Staged).rect.map(hit) as Collisions,
  })
}

const ids = (collisions: Collisions) => collisions.map((collision) => String(collision.id))

describe('createBoardCollisionDetection', () => {
  it('returns the pointer hit when the pointer is inside a cabin', () => {
    const detect = detector()
    expect(ids(detect(stage(['unit:a'], ['unit:b'])))).toEqual(['unit:a'])
  })

  it('HOLDS the last cabin the pointer was inside while crossing a gutter', () => {
    const detect = detector()
    detect(stage(['unit:a'], ['unit:a', 'unit:b']))
    // In the gutter the overlay overlaps B most — but A is still intersecting,
    // and A is where the pointer actually was.
    expect(ids(detect(stage([], ['unit:b', 'unit:a'])))).toEqual(['unit:a'])
  })

  it('falls back to rect intersection once the held cabin no longer intersects', () => {
    const detect = detector()
    detect(stage(['unit:a'], ['unit:a']))
    expect(ids(detect(stage([], ['unit:c'])))).toEqual(['unit:c'])
  })

  it('forgets the held cabin when the gesture resets', () => {
    const detect = detector()
    detect(stage(['unit:a'], ['unit:a']))
    detect.reset()
    expect(ids(detect(stage([], ['unit:b', 'unit:a'])))).toEqual(['unit:b', 'unit:a'])
  })

  it('re-holds on the new cabin once the pointer enters one', () => {
    const detect = detector()
    detect(stage(['unit:a'], ['unit:a']))
    detect(stage(['unit:b'], ['unit:b', 'unit:a']))
    expect(ids(detect(stage([], ['unit:a', 'unit:b'])))).toEqual(['unit:b'])
  })
})
