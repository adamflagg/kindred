import { describe, expect, it } from 'vitest'

import {
  CSV_COLUMN_HEADERS,
  groupWords,
  TO_PLACE_COLUMN_WIDTHS,
  toPlaceCsvExtra,
} from './toPlaceColumns'
import {
  CHEN_EXACT,
  GARCIA_WITHHELD,
  JOHNSON_SPLIT,
  SAM_NO_REQUEST,
  TO_PLACE,
} from './toPlaceFixtures'

describe('To place camp-aid table widths', () => {
  it('fit a 1440 screen (content ~1216px) with no sideways scroll', () => {
    const SELECT = 32
    const FLEX_MIN = 250 // AidTable's floor for the one flexible column (Suggestion)
    const total =
      SELECT +
      Object.entries(TO_PLACE_COLUMN_WIDTHS).reduce(
        (sum, [key, width]) => sum + (key === 'suggestion' ? FLEX_MIN : width),
        0
      )
    expect(total).toBeLessThanOrEqual(1216)
  })
})

describe('the six short columns (final UX ★14)', () => {
  it('runs Family · The line in CampMinder · Could belong to · Suggestion · What Confirm does · Amount', () => {
    expect(CSV_COLUMN_HEADERS).toEqual([
      'Family',
      'The line in CampMinder',
      'Could belong to',
      'Suggestion',
      'What Confirm does',
      'Amount',
    ])
  })

  it('keeps the ids and the part still not placed in the CSV, then the group, as before', () => {
    const extra = toPlaceCsvExtra(TO_PLACE.groups)
    expect(extra.map((e) => e.header)).toEqual([
      'Household CM id',
      'Line',
      'Still not placed',
      'Group',
    ])
    expect(extra[3]?.value(JOHNSON_SPLIT)).toBe('Camp aid: Several requests could take this line')
  })
})

describe('what a group holds, on screen (counts, never money)', () => {
  it('counts the lines, then the distinct households, in the heading’s muted words', () => {
    expect(groupWords([JOHNSON_SPLIT, GARCIA_WITHHELD, CHEN_EXACT])).toBe('3 lines · 3 households')
    expect(groupWords([SAM_NO_REQUEST])).toBe('1 line · 1 household')
    // A split family counts twice: households are household ids, not D26 families (plan review m11).
    expect(groupWords([JOHNSON_SPLIT, { ...JOHNSON_SPLIT, transaction_cm_id: 9 }])).toBe(
      '2 lines · 1 household'
    )
  })
})
