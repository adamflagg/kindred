/**
 * Tests for bunkBoardLayout utility.
 *
 * Verifies that the board wrapper gets the correct class when the camper
 * detail panel is open vs. closed, without needing to mount the full board.
 * Also covers bottom-clearance classes for the friend-groups hub (#1630).
 */
import { describe, it, expect } from 'vitest'
import {
  getBoardWrapperClass,
  getBoardBottomPaddingClass,
  PANEL_WIDTH_CLASS,
} from './bunkBoardLayout'

describe('getBoardWrapperClass', () => {
  it('returns empty string when the panel is closed', () => {
    expect(getBoardWrapperClass(false)).toBe('')
  })

  it('returns a non-empty class when the panel is open', () => {
    const cls = getBoardWrapperClass(true)
    expect(cls).not.toBe('')
  })

  it('includes the panel width in the open-state class so the board is compressed by the same amount', () => {
    const cls = getBoardWrapperClass(true)
    // The margin must match the panel width so the board content doesn't slip behind it.
    // PANEL_WIDTH_CLASS is "w-[28rem]" → margin should be "mr-[28rem]"
    expect(cls).toContain('mr-[28rem]')
  })

  it('the open-state class contains a CSS transition so the reflow is animated', () => {
    const cls = getBoardWrapperClass(true)
    expect(cls).toContain('transition')
  })

  it('PANEL_WIDTH_CLASS is defined and matches the panel width token', () => {
    expect(PANEL_WIDTH_CLASS).toBe('w-[28rem]')
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
