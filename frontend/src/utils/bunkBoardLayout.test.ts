/**
 * Tests for bunkBoardLayout utility.
 *
 * Verifies that the board wrapper gets the correct class when the camper
 * detail panel is open vs. closed, without needing to mount the full board.
 */
import { describe, it, expect } from 'vitest'
import { getBoardWrapperClass, PANEL_WIDTH_CLASS } from './bunkBoardLayout'

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
