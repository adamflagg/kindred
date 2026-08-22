/**
 * The merge/split morph is planned as a pure function over the board's
 * drawn-card identity, so the decision that matters — is this commit a
 * merge, a split, or an unrelated reshuffle — is testable without a DOM.
 *
 * The HINT is the false-positive guard, and its rule is strict: a swap
 * that no write site announced NEVER animates. A weekend or scenario
 * switch can legitimately replace a split board with a merged one in a
 * single commit; without the hint gate that would fire the convergence
 * on a navigation, smoothly animating a change nobody made (the same
 * legible-lie class kindred#2518 existed to remove).
 *
 * Fictional data throughout.
 */
import { afterEach, describe, expect, it } from 'vitest'

import type { LodgingUnitRow } from '../../types/lodging'
import {
  clearBoardMorphHint,
  peekBoardMorphHint,
  planBoardMorph,
  setBoardMorphHint,
} from './boardMorph'

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'cedar-1',
    name: 'Cedar 1',
    area_code: 'CG',
    area_name: 'Cedar Grove',
    area_sort_order: 0,
    sleeps: 5,
    bathroom: 'shared',
    bathroom_group: '',
    near_bathhouse: false,
    has_power: false,
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    is_confirmed: false,
    is_active: true,
    is_container: false,
    parent_code: '',
    is_combined: false,
    inventory_class: 'family_pool',
    family_available_override: null,
    reason: '',
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

/** Cedar Upstairs covers cedar-1 + cedar-2; cedar-3 and cedar-4 are siblings. */
function registry(): ReadonlyMap<string, LodgingUnitRow> {
  const units = [
    unit({
      unit_id: 'u-up',
      code: 'cedar-upstairs',
      name: 'Cedar Upstairs',
      is_container: true,
    }),
    unit({ unit_id: 'u1', code: 'cedar-1', parent_code: 'cedar-upstairs' }),
    unit({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2', parent_code: 'cedar-upstairs' }),
    unit({ unit_id: 'u3', code: 'cedar-3', name: 'Cedar 3' }),
    unit({ unit_id: 'u4', code: 'cedar-4', name: 'Cedar 4' }),
  ]
  return new Map(units.map((u) => [u.code, u]))
}

const SPLIT = ['cedar-1', 'cedar-2', 'cedar-3', 'cedar-4'] as const
const MERGED = ['cedar-3', 'cedar-4', 'cedar-upstairs'] as const

afterEach(() => {
  clearBoardMorphHint()
})

describe('planBoardMorph — merge detection', () => {
  it('detects a hinted merge: container appeared, its rooms vanished', () => {
    const op = planBoardMorph(SPLIT, MERGED, registry(), 'cedar-2')
    expect(op).toEqual({
      type: 'merge',
      containerCode: 'cedar-upstairs',
      leaverCodes: ['cedar-1', 'cedar-2'],
      anchorCode: 'cedar-2',
    })
  })

  it('keeps leaver order from the PREVIOUS render, not the registry', () => {
    const op = planBoardMorph(
      ['cedar-2', 'cedar-1', 'cedar-3', 'cedar-4'],
      MERGED,
      registry(),
      'cedar-1'
    )
    expect(op?.type).toBe('merge')
    expect(op && 'leaverCodes' in op ? op.leaverCodes : []).toEqual(['cedar-2', 'cedar-1'])
  })

  it('anchors on the first leaver when the hint names the container, not a room', () => {
    // The drag and chip sites always hint a room, but a defensive fallback
    // beats an empty anchor if a future write site hints the container.
    const op = planBoardMorph(SPLIT, MERGED, registry(), 'cedar-upstairs')
    expect(op && 'anchorCode' in op ? op.anchorCode : null).toBe('cedar-1')
  })

  it('groups a GRANDCHILD room under a container-of-containers', () => {
    // Registry three deep: house > wing (container) > wing-r1. Merging the
    // HOUSE swallows wing-r1 even though its direct parent is the wing.
    const units = [
      unit({ unit_id: 'uh', code: 'house', name: 'Aspen House', is_container: true }),
      unit({
        unit_id: 'uw',
        code: 'wing',
        name: 'Aspen Wing',
        is_container: true,
        parent_code: 'house',
      }),
      unit({ unit_id: 'ur', code: 'wing-r1', name: 'Wing 1', parent_code: 'wing' }),
      unit({ unit_id: 'u3', code: 'cedar-3', name: 'Cedar 3' }),
    ]
    const byCode = new Map(units.map((u) => [u.code, u]))
    const op = planBoardMorph(['cedar-3', 'wing-r1'], ['cedar-3', 'house'], byCode, 'wing-r1')
    expect(op).toEqual({
      type: 'merge',
      containerCode: 'house',
      leaverCodes: ['wing-r1'],
      anchorCode: 'wing-r1',
    })
  })
})

describe('planBoardMorph — split detection', () => {
  it('detects a hinted split: container vanished, its rooms appeared', () => {
    const op = planBoardMorph(MERGED, SPLIT, registry(), 'cedar-upstairs')
    expect(op).toEqual({
      type: 'split',
      containerCode: 'cedar-upstairs',
      enterCodes: ['cedar-1', 'cedar-2'],
    })
  })

  it('keeps enter order from the NEXT render', () => {
    const op = planBoardMorph(
      MERGED,
      ['cedar-2', 'cedar-3', 'cedar-1', 'cedar-4'],
      registry(),
      'cedar-upstairs'
    )
    expect(op && 'enterCodes' in op ? op.enterCodes : []).toEqual(['cedar-2', 'cedar-1'])
  })
})

describe('planBoardMorph — the hint gate', () => {
  it('returns null for the SAME swap with no hint — a weekend switch must not animate', () => {
    expect(planBoardMorph(SPLIT, MERGED, registry(), null)).toBeNull()
  })

  it('returns null when the hint names an unrelated unit', () => {
    expect(planBoardMorph(SPLIT, MERGED, registry(), 'cedar-3')).toBeNull()
  })

  it('returns null when nothing changed — an availability or party rerender', () => {
    expect(planBoardMorph(SPLIT, [...SPLIT], registry(), 'cedar-1')).toBeNull()
  })

  it('returns null when units appear and vanish WITHOUT a container relationship', () => {
    // An admin creating one unit while deleting another is a reshuffle, not
    // a merge, however coincidental the timing.
    expect(
      planBoardMorph(['cedar-3', 'cedar-4'], ['cedar-3', 'willow'], registry(), 'cedar-4')
    ).toBeNull()
  })
})

describe('the hint store', () => {
  it('peek returns what was set, and clear empties it', () => {
    setBoardMorphHint('cedar-2')
    expect(peekBoardMorphHint()).toBe('cedar-2')
    clearBoardMorphHint()
    expect(peekBoardMorphHint()).toBeNull()
  })

  it('a hint EXPIRES after 15s — a failed write must not animate a later unrelated swap', () => {
    setBoardMorphHint('cedar-2', 1_000)
    expect(peekBoardMorphHint(15_500)).toBe('cedar-2')
    expect(peekBoardMorphHint(16_500)).toBeNull()
  })
})
