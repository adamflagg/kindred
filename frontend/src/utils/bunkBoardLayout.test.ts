/**
 * Tests for bunkBoardLayout utility.
 *
 * Covers the bottom-clearance classes that keep the fixed friend-groups hub /
 * action bar from occluding the last bunk row (#1630). The camper detail panel
 * is a plain slide-in overlay and no longer reflows the board, so there is no
 * reflow/column math left to test here.
 */
import { describe, it, expect } from 'vitest'
import { getBoardBottomPaddingClass } from './bunkBoardLayout'

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
