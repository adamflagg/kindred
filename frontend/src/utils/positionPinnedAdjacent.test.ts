import { describe, it, expect } from 'vitest'
import { positionPinnedAdjacent } from './positionPinnedAdjacent'

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]

describe('positionPinnedAdjacent', () => {
  it('returns the list unchanged when no pin is set', () => {
    expect(positionPinnedAdjacent(items, null, null)).toEqual(items)
  })

  it('returns the list unchanged when originator is not known', () => {
    expect(positionPinnedAdjacent(items, 'd', null)).toEqual(items)
  })

  it('returns the list unchanged when pinned === originator', () => {
    expect(positionPinnedAdjacent(items, 'c', 'c')).toEqual(items)
  })

  it('returns the list unchanged when originator is not in the list', () => {
    expect(positionPinnedAdjacent(items, 'd', 'missing')).toEqual(items)
  })

  it('returns the list unchanged when pinned is not in the list', () => {
    expect(positionPinnedAdjacent(items, 'missing', 'b')).toEqual(items)
  })

  it('moves a pinned item from a later slot to directly after its originator', () => {
    // originator: b (index 1), pinned: e (index 4) -> expect b, e, c, d
    expect(positionPinnedAdjacent(items, 'e', 'b').map((r) => r.id)).toEqual([
      'a',
      'b',
      'e',
      'c',
      'd',
    ])
  })

  it('moves a pinned item from an earlier slot to directly after its originator', () => {
    // originator: d (index 3), pinned: a (index 0) -> expect b, c, d, a, e
    expect(positionPinnedAdjacent(items, 'a', 'd').map((r) => r.id)).toEqual([
      'b',
      'c',
      'd',
      'a',
      'e',
    ])
  })

  it('is a no-op when pinned is already directly after originator', () => {
    expect(positionPinnedAdjacent(items, 'c', 'b')).toEqual(items)
  })

  it('does not mutate the input array', () => {
    const input = [...items]
    positionPinnedAdjacent(input, 'e', 'a')
    expect(input).toEqual(items)
  })
})
