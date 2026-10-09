import { describe, expect, it } from 'vitest'

import { TO_PLACE_TEXT_COLUMNS, TO_PLACE_FAMILY_WIDTH, TO_PLACE_LINE_WIDTH } from './toPlaceColumns'

describe('To place camp-aid table widths', () => {
  it('fit a 1440 screen (content ~1216px) with no sideways scroll', () => {
    const SELECT = 32
    const FLEX_MIN = 250 // AidTable's floor for the one flexible column
    const total =
      SELECT +
      TO_PLACE_FAMILY_WIDTH +
      TO_PLACE_LINE_WIDTH +
      TO_PLACE_TEXT_COLUMNS.reduce((sum, c) => sum + (c.flex ? FLEX_MIN : (c.width ?? 0)), 0)
    expect(total).toBeLessThanOrEqual(1216)
  })
})
