/**
 * The boundary is the ONLY place allowed to bridge React's commit with the
 * imperative morph: capture must run before the DOM mutates (rooms still
 * mounted), play after (container mounted). jsdom cannot verify pixels —
 * these tests pin the wiring and the guard instead:
 *
 *  - a hinted slot-identity change captures then plays, in that order;
 *  - an unhinted change, or a same-identity rerender, touches nothing;
 *  - the DEFAULT runner is inert in jsdom (0-width rects) rather than
 *    crashing the ~30 existing board tests that rerender changed payloads.
 *
 * Fictional data throughout.
 */
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow } from '../../types/lodging'
import { clearBoardMorphHint, setBoardMorphHint } from './boardMorph'
import { BoardMorphBoundary } from './BoardMorphBoundary'
import type { BoardMorphSnapshot } from './boardMorphRunner'

/** The wiring tests never touch pixels — an opaque token stands in. */
const fakeSnapshot = (token: string): BoardMorphSnapshot =>
  ({ token }) as unknown as BoardMorphSnapshot

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

const REGISTRY = new Map(
  [
    unit({ unit_id: 'u-up', code: 'cedar-upstairs', name: 'Cedar Upstairs', is_container: true }),
    unit({ unit_id: 'u1', code: 'cedar-1', parent_code: 'cedar-upstairs' }),
    unit({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2', parent_code: 'cedar-upstairs' }),
    unit({ unit_id: 'u3', code: 'cedar-3', name: 'Cedar 3' }),
  ].map((u) => [u.code, u])
)
const SPLIT = ['cedar-1', 'cedar-2', 'cedar-3']
const MERGED = ['cedar-3', 'cedar-upstairs']

afterEach(() => {
  clearBoardMorphHint()
})

describe('BoardMorphBoundary', () => {
  it('captures the planned op on a hinted swap, then plays the captured snapshot', () => {
    const snapshot = fakeSnapshot('captured')
    const runner = { capture: vi.fn(() => snapshot), play: vi.fn() }
    const { rerender } = render(
      <BoardMorphBoundary slotCodes={SPLIT} unitsByCode={REGISTRY} runner={runner}>
        <div />
      </BoardMorphBoundary>
    )
    setBoardMorphHint('cedar-2')
    rerender(
      <BoardMorphBoundary slotCodes={MERGED} unitsByCode={REGISTRY} runner={runner}>
        <div />
      </BoardMorphBoundary>
    )
    expect(runner.capture).toHaveBeenCalledExactlyOnceWith({
      type: 'merge',
      containerCode: 'cedar-upstairs',
      leaverCodes: ['cedar-1', 'cedar-2'],
      anchorCode: 'cedar-2',
    })
    expect(runner.play).toHaveBeenCalledExactlyOnceWith(snapshot)
  })

  it('consumes the hint — the same swap reversed does not replay it', () => {
    const runner = { capture: vi.fn(() => fakeSnapshot('again')), play: vi.fn() }
    const { rerender } = render(
      <BoardMorphBoundary slotCodes={SPLIT} unitsByCode={REGISTRY} runner={runner}>
        <div />
      </BoardMorphBoundary>
    )
    setBoardMorphHint('cedar-2')
    rerender(
      <BoardMorphBoundary slotCodes={MERGED} unitsByCode={REGISTRY} runner={runner}>
        <div />
      </BoardMorphBoundary>
    )
    rerender(
      <BoardMorphBoundary slotCodes={SPLIT} unitsByCode={REGISTRY} runner={runner}>
        <div />
      </BoardMorphBoundary>
    )
    expect(runner.capture).toHaveBeenCalledTimes(1)
  })

  it('does nothing on an unhinted swap — a weekend switch animates nothing', () => {
    const runner = { capture: vi.fn(() => fakeSnapshot('unused')), play: vi.fn() }
    const { rerender } = render(
      <BoardMorphBoundary slotCodes={SPLIT} unitsByCode={REGISTRY} runner={runner}>
        <div />
      </BoardMorphBoundary>
    )
    rerender(
      <BoardMorphBoundary slotCodes={MERGED} unitsByCode={REGISTRY} runner={runner}>
        <div />
      </BoardMorphBoundary>
    )
    expect(runner.capture).not.toHaveBeenCalled()
    expect(runner.play).not.toHaveBeenCalled()
  })

  it('skips play when capture declines — jsdom rects measure 0x0', () => {
    const runner = { capture: vi.fn(() => null), play: vi.fn() }
    const { rerender } = render(
      <BoardMorphBoundary slotCodes={SPLIT} unitsByCode={REGISTRY} runner={runner}>
        <div />
      </BoardMorphBoundary>
    )
    setBoardMorphHint('cedar-2')
    rerender(
      <BoardMorphBoundary slotCodes={MERGED} unitsByCode={REGISTRY} runner={runner}>
        <div />
      </BoardMorphBoundary>
    )
    expect(runner.capture).toHaveBeenCalledTimes(1)
    expect(runner.play).not.toHaveBeenCalled()
  })

  it('survives a hinted swap with the REAL runner in jsdom — the 0-width guard declines', () => {
    // BOTH leaver cards are in the DOM, so capture gets past its
    // missing-element bail and reaches the width guard — which is the branch
    // this test exists to pin (review finding: with only one card rendered,
    // the guard could be deleted and this still passed). The hinted board
    // tests that click through real write sites ride the same guard.
    const { rerender } = render(
      <BoardMorphBoundary slotCodes={SPLIT} unitsByCode={REGISTRY}>
        <div>
          <div data-unit-code="cedar-1" />
          <div data-unit-code="cedar-2" />
        </div>
      </BoardMorphBoundary>
    )
    setBoardMorphHint('cedar-2')
    expect(() =>
      rerender(
        <BoardMorphBoundary slotCodes={MERGED} unitsByCode={REGISTRY}>
          <div>
            <div data-unit-code="cedar-upstairs" />
          </div>
        </BoardMorphBoundary>
      )
    ).not.toThrow()
    expect(document.getElementById('board-morph-overlay')).toBeNull()
  })
})
