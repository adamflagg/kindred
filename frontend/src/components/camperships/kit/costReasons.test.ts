import { describe, expect, it } from 'vitest'

import { costReasonLower, costReasonOptions, costReasonWords } from './costReasons'

describe('cost override reasons', () => {
  it('words the five codes as staff say them', () => {
    expect(
      ['headcount', 'partial_session', 'discount', 'missing_catalog', 'typed_household_total'].map(
        costReasonWords
      )
    ).toEqual([
      'Number of people',
      'Part of the session',
      'Discount',
      'No catalog price',
      "Family's total from the form",
    ])
    expect(costReasonLower('typed_household_total')).toBe("family's total from the form")
  })
  it('words an unknown code from its key, and offers every code in the page’s order, worded', () => {
    expect(costReasonWords('late_fee_waived')).toBe('Late fee waived')
    expect(costReasonOptions(['headcount', 'discount'])).toEqual([
      { value: 'headcount', label: 'Number of people' },
      { value: 'discount', label: 'Discount' },
    ])
  })
})
