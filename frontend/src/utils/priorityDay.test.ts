import { describe, expect, it } from 'vitest'
import { isPriorityDayOffset, readsThroughNextDay } from './priorityDay'

describe('readsThroughNextDay (decision 45, ruling 11)', () => {
  it('is true when the server read the prior one day later than this year', () => {
    expect(readsThroughNextDay(0, 1)).toBe(true) // priority date
    expect(readsThroughNextDay(7, 8)).toBe(true) // an early or open date
  })

  it('is false on a day the prior is read at its own day', () => {
    expect(readsThroughNextDay(3, 3)).toBe(false)
    expect(readsThroughNextDay(-5, -5)).toBe(false)
  })

  it('is false when either side is unknown', () => {
    expect(readsThroughNextDay(null, 1)).toBe(false)
    expect(readsThroughNextDay(0, null)).toBe(false)
    expect(readsThroughNextDay(undefined, undefined)).toBe(false)
  })
})

describe('isPriorityDayOffset (ruling 9: only the priority date waits a day)', () => {
  it('stays day 0 only', () => {
    expect(isPriorityDayOffset(0)).toBe(true)
    expect(isPriorityDayOffset(7)).toBe(false)
  })
})
