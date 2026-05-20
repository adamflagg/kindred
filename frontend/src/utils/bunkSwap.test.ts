import { describe, expect, it, vi } from 'vitest'
import { isEligibleSwapTarget, swapBunks } from './bunkSwap'
import type { BunkWithCampers } from '../types/app-types'

function makeBunk(overrides: Partial<BunkWithCampers>): BunkWithCampers {
  return {
    id: 'bunk-1',
    cm_id: 1001,
    name: 'G-3',
    gender: 'F',
    is_active: true,
    sort_order: 0,
    year: 2026,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    collectionId: 'bunks',
    collectionName: 'bunks',
    campers: [],
    occupancy: 0,
    utilization: 0,
    ...overrides,
  } as BunkWithCampers
}

describe('isEligibleSwapTarget', () => {
  it('returns false when candidate is the source bunk itself', () => {
    const source = makeBunk({ id: 'bunk-a', gender: 'F' })
    expect(isEligibleSwapTarget(source, source)).toBe(false)
  })

  it('returns false for the "Removed cabin" sentinel name', () => {
    const source = makeBunk({ id: 'a', gender: 'F', name: 'G-3' })
    const candidate = makeBunk({ id: 'b', gender: 'F', name: 'Removed cabin' })
    expect(isEligibleSwapTarget(source, candidate)).toBe(false)
  })

  it('returns false when candidate is an AG bunk', () => {
    const source = makeBunk({ id: 'a', gender: 'F', name: 'G-3' })
    const ag = makeBunk({ id: 'b', gender: 'F', name: 'AG-8' })
    expect(isEligibleSwapTarget(source, ag)).toBe(false)
  })

  it('returns false when source is an AG bunk', () => {
    const source = makeBunk({ id: 'a', gender: 'F', name: 'AG-7' })
    const candidate = makeBunk({ id: 'b', gender: 'F', name: 'G-9' })
    expect(isEligibleSwapTarget(source, candidate)).toBe(false)
  })

  it('returns false when genders differ', () => {
    const source = makeBunk({ id: 'a', gender: 'F', name: 'G-3' })
    const candidate = makeBunk({ id: 'b', gender: 'M', name: 'B-3' })
    expect(isEligibleSwapTarget(source, candidate)).toBe(false)
  })

  it('returns true for same-gender non-AG candidate with different id', () => {
    const source = makeBunk({ id: 'a', gender: 'F', name: 'G-3' })
    const candidate = makeBunk({ id: 'b', gender: 'F', name: 'G-10b' })
    expect(isEligibleSwapTarget(source, candidate)).toBe(true)
  })
})

describe('swapBunks', () => {
  it('moves every camper in A into B and every camper in B into A', async () => {
    const bunkA = makeBunk({
      id: 'bunk-a',
      campers: [
        { id: 'c1', name: 'Emma Johnson' } as never,
        { id: 'c2', name: 'Liam Garcia' } as never,
      ],
    })
    const bunkB = makeBunk({
      id: 'bunk-b',
      campers: [{ id: 'c3', name: 'Olivia Chen' } as never],
    })
    const moveCamper = vi.fn().mockResolvedValue(undefined)

    await swapBunks(bunkA, bunkB, moveCamper)

    expect(moveCamper).toHaveBeenCalledWith('c1', 'bunk-b')
    expect(moveCamper).toHaveBeenCalledWith('c2', 'bunk-b')
    expect(moveCamper).toHaveBeenCalledWith('c3', 'bunk-a')
    expect(moveCamper).toHaveBeenCalledTimes(3)
  })

  it('is a no-op when both bunks are empty', async () => {
    const bunkA = makeBunk({ id: 'a', campers: [] })
    const bunkB = makeBunk({ id: 'b', campers: [] })
    const moveCamper = vi.fn().mockResolvedValue(undefined)

    await swapBunks(bunkA, bunkB, moveCamper)

    expect(moveCamper).not.toHaveBeenCalled()
  })

  it('handles one-sided empty (A populated, B empty)', async () => {
    const bunkA = makeBunk({
      id: 'a',
      campers: [{ id: 'c1' } as never, { id: 'c2' } as never],
    })
    const bunkB = makeBunk({ id: 'b', campers: [] })
    const moveCamper = vi.fn().mockResolvedValue(undefined)

    await swapBunks(bunkA, bunkB, moveCamper)

    expect(moveCamper).toHaveBeenCalledWith('c1', 'b')
    expect(moveCamper).toHaveBeenCalledWith('c2', 'b')
    expect(moveCamper).toHaveBeenCalledTimes(2)
  })

  it('rejects when any single moveCamper call rejects', async () => {
    const bunkA = makeBunk({
      id: 'a',
      campers: [{ id: 'c1' } as never, { id: 'c2' } as never],
    })
    const bunkB = makeBunk({ id: 'b', campers: [{ id: 'c3' } as never] })
    const moveCamper = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined)

    await expect(swapBunks(bunkA, bunkB, moveCamper)).rejects.toThrow('boom')
  })
})
