import { describe, expect, it } from 'vitest'

import { isClosedSeason } from './closedSeason'

// CLOSED-SEASONS-DONE (owner ruling CSD-7 = a): a season is closed when it is older than the prior season N-1 of the
// configured season N. The server's aid_season_state.is_season_done and the sync's isClosedSeasonFor are the same rule.
describe('isClosedSeason', () => {
  it('closes 2025 and older while 2027 is the season, and keeps 2026 and 2027 open', () => {
    expect(isClosedSeason(2025, 2027)).toBe(true)
    expect(isClosedSeason(2017, 2027)).toBe(true)
    expect(isClosedSeason(2026, 2027)).toBe(false)
    expect(isClosedSeason(2027, 2027)).toBe(false)
  })

  it('rolls by itself: 2026 closes once 2028 is the season', () => {
    expect(isClosedSeason(2026, 2028)).toBe(true)
  })

  it('marks nothing while the configured season is unknown', () => {
    expect(isClosedSeason(2017, 0)).toBe(false)
    expect(isClosedSeason(2017, undefined)).toBe(false)
  })
})
