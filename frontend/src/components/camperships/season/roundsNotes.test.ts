import { describe, expect, it } from 'vitest'

import { ROUNDS_NOTE_KEY, roundsNote } from './roundsNotes'

const NUMBERS = new Map(
  [
    'rounds_allocated',
    'rounds_committed',
    'rounds_posted',
    'rounds_needs_offer',
    'rounds_remaining',
    'rounds_below_the_line',
  ].map((key, i) => [key, i + 1] as const)
)
const numberOf = (key: string) => NUMBERS.get(key) ?? null

describe("Rounds & budget's six notes", () => {
  it("numbers the mock's marks: 1+11 → 1, 12+3 → 2, 2+10 → 3, 4+5 → 4, 6 → 5, 7+8+9 → 6", () => {
    expect((['allocated', 'share'] as const).map((figure) => roundsNote(numberOf, figure))).toEqual(
      [1, 1]
    )
    expect((['committed', 'accepted'] as const).map((f) => roundsNote(numberOf, f))).toEqual([2, 2])
    expect((['posted', 'unconfirmed'] as const).map((f) => roundsNote(numberOf, f))).toEqual([3, 3])
    expect(
      (['needs_offer', 'pending_approval'] as const).map((f) => roundsNote(numberOf, f))
    ).toEqual([4, 4])
    expect(roundsNote(numberOf, 'remaining')).toBe(5)
    expect((['below_the_line', 'demand'] as const).map((f) => roundsNote(numberOf, f))).toEqual([
      6, 6,
    ])
  })

  it('is null until the registry has loaded', () => {
    expect(roundsNote(() => null, 'allocated')).toBeNull()
  })

  it('maps only to keys the surface owns', () => {
    for (const key of Object.values(ROUNDS_NOTE_KEY)) expect(NUMBERS.has(key)).toBe(true)
  })
})
