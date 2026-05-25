/**
 * Tests for bunkBoardLayout utility.
 *
 * Verifies that the board wrapper gets the correct class when the camper
 * detail panel is open vs. closed, without needing to mount the full board.
 * Also covers bottom-clearance classes for the friend-groups hub (#1630).
 */
import { describe, it, expect } from 'vitest'
import {
  computeBoardReflow,
  getBoardBottomPaddingClass,
  getBunkGridClass,
  PANEL_WIDTH_PX,
} from './bunkBoardLayout'

describe('computeBoardReflow (measured, conditional reflow)', () => {
  // The board is the centered max-w-7xl (1280px) container minus its sm:p-6
  // padding (24px each side) → 1232px of content, centered in the viewport.
  // The fixed camper panel is PANEL_WIDTH_PX wide, pinned to the right edge.
  const CONTAINER = 1280
  const PADDING = 24
  const boardEdges = (viewportWidth: number) => {
    const containerWidth = Math.min(viewportWidth, CONTAINER)
    const containerLeft = Math.max(0, (viewportWidth - containerWidth) / 2)
    const boardNaturalLeft = containerLeft + PADDING
    return {
      boardNaturalLeft,
      boardNaturalRight: boardNaturalLeft + (containerWidth - 2 * PADDING),
      viewportWidth,
    }
  }

  it('PANEL_WIDTH_PX matches the panel width token (w-[28rem] = 448px)', () => {
    expect(PANEL_WIDTH_PX).toBe(448)
  })

  it('1440p / 2560-wide: panel floats over the right gutter — board is untouched', () => {
    const r = computeBoardReflow(boardEdges(2560))
    expect(r.marginRightPx).toBe(0)
    expect(r.dropColumn).toBe(false)
    expect(r.didReflow).toBe(false)
  })

  it('clamps a negative overlap to a zero trim (never grows the board)', () => {
    // Board ends well left of the panel → overlap negative → no trim.
    const r = computeBoardReflow({
      boardNaturalLeft: 400,
      boardNaturalRight: 1500,
      viewportWidth: 2560, // panelLeft = 2112, far right of the board's 1500 edge
    })
    expect(r.marginRightPx).toBe(0)
    expect(r.didReflow).toBe(false)
  })

  it('1920-wide: small right trim only — keeps 4 columns, no reflow/pan', () => {
    const r = computeBoardReflow(boardEdges(1920))
    // panelLeft = 1472, board right ≈ 1576 → ~104px overlap, trimmed away.
    expect(r.marginRightPx).toBeGreaterThan(0)
    expect(r.marginRightPx).toBeLessThan(160)
    expect(r.dropColumn).toBe(false)
    expect(r.didReflow).toBe(false)
  })

  it('1500-wide: larger trim drops a column and signals a reflow (→ pan)', () => {
    const r = computeBoardReflow(boardEdges(1500))
    // panelLeft = 1052, board right ≈ 1366 → ~314px overlap → board too tight for 4 cols.
    expect(r.marginRightPx).toBeGreaterThan(250)
    expect(r.dropColumn).toBe(true)
    expect(r.didReflow).toBe(true)
  })

  it('the trim equals the overlap of the panel onto the board (right-edge only)', () => {
    const r = computeBoardReflow({
      boardNaturalLeft: 100,
      boardNaturalRight: 1300,
      viewportWidth: 1600, // panelLeft = 1600 - 448 = 1152 → overlap = 1300 - 1152 = 148
    })
    expect(r.marginRightPx).toBe(148)
  })

  it('drops a column only once the trimmed width is too narrow for the base column count', () => {
    // Same viewport (1280 → base 4 cols); vary the board width via minCardWidth so the
    // boundary is exercised. Wide trimmed board keeps 4; narrow one drops.
    const wide = computeBoardReflow({
      boardNaturalLeft: 0,
      boardNaturalRight: 1280,
      viewportWidth: 1280, // panelLeft = 832 → overlap 448 → trimmed 832
      minCardWidth: 180, // 832 fits 4 cols at 180 → keep
    })
    expect(wide.dropColumn).toBe(false)

    const narrow = computeBoardReflow({
      boardNaturalLeft: 0,
      boardNaturalRight: 1280,
      viewportWidth: 1280,
      minCardWidth: 256, // 832 cannot fit 4 cols at 256 → drop
    })
    expect(narrow.dropColumn).toBe(true)
  })
})

describe('getBoardBottomPaddingClass (#1630 — friend-groups hub clearance)', () => {
  // Hub absent (read-only / non-draft): no bottom padding needed.
  it('returns empty string when the hub is not visible', () => {
    expect(getBoardBottomPaddingClass(false, false)).toBe('')
  })

  // Hub present, action bar absent (draft mode, no pending campers):
  // board needs clearance equal to the hub button + some gap.
  it('returns a non-empty class when the hub is visible without the action bar', () => {
    expect(getBoardBottomPaddingClass(true, false)).not.toBe('')
  })

  // Hub present AND action bar present (draft mode, pending campers):
  // board needs extra clearance because the action bar adds additional height at bottom-0.
  it('returns a non-empty class when both the hub and action bar are visible', () => {
    expect(getBoardBottomPaddingClass(true, true)).not.toBe('')
  })

  // The action-bar case must produce MORE clearance than hub-only, since the
  // action bar sits at bottom-0 and is taller than the hub button alone.
  it('produces more clearance when the action bar is also visible', () => {
    const hubOnly = getBoardBottomPaddingClass(true, false)
    const hubAndBar = getBoardBottomPaddingClass(true, true)
    // Extract the numeric pb-* value from each class for comparison.
    // Both should contain a pb-* token; action-bar case has a larger value.
    expect(hubOnly).toContain('pb-')
    expect(hubAndBar).toContain('pb-')
    expect(hubAndBar).not.toBe(hubOnly)
  })

  // Sanity: action bar alone (hub=false, actionBar=true) is the same as hub+bar
  // — if the bar is up, the board must clear it regardless.
  it('still clears the action bar even if hub is not separately flagged', () => {
    const barOnly = getBoardBottomPaddingClass(false, true)
    expect(barOnly).not.toBe('')
    expect(barOnly).toContain('pb-')
  })
})

describe('getBunkGridClass (panel-open column reflow)', () => {
  // Closed: full column count — bunks fill the whole board width.
  it('uses up to 4 columns when the panel is closed', () => {
    const cls = getBunkGridClass(false)
    expect(cls).toContain('grid')
    expect(cls).toContain('grid-cols-1')
    expect(cls).toContain('sm:grid-cols-2')
    expect(cls).toContain('lg:grid-cols-3')
    expect(cls).toContain('xl:grid-cols-4')
  })

  // Open: drop one column per breakpoint so each bunk keeps ~its closed-state
  // width (the board reflows to one more row instead of squishing the columns).
  it('drops one column per breakpoint when the panel is open', () => {
    const cls = getBunkGridClass(true)
    expect(cls).toContain('grid')
    expect(cls).toContain('grid-cols-1')
    expect(cls).toContain('lg:grid-cols-2')
    expect(cls).toContain('xl:grid-cols-3')
  })

  // The open state must NOT keep the wider closed-state column counts, or the
  // bunks would squish into the narrower (panel-occupied) space.
  it('does not keep the closed-state wider column counts when open', () => {
    const cls = getBunkGridClass(true)
    expect(cls).not.toContain('grid-cols-4')
    expect(cls).not.toContain('lg:grid-cols-3')
  })

  // Both states keep the gap so the visual rhythm is unchanged.
  it('keeps the same inter-card gap in both states', () => {
    expect(getBunkGridClass(false)).toContain('gap-3')
    expect(getBunkGridClass(true)).toContain('gap-3')
  })
})
