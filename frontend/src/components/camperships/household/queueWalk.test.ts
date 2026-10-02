import { describe, expect, it } from 'vitest'

import { GRID_ROWS } from '../requests/gridFixtures'
import { NO_FILTERS, requestView } from '../requests/views'
import { gridFiltersFrom, walkPosition, walkStops } from './queueWalk'

const TODAY = '2027-04-01'

describe('walkStops (§3.5; D14; Decision 29)', () => {
  it('makes one stop per household, in the order the view first lists it', () => {
    const stops = walkStops(GRID_ROWS, requestView('all'), TODAY)
    expect(stops.map((s) => s.householdCmId)).toEqual([1000001, 1000003, 1000005, 1000007])
    expect(stops[0]).toMatchObject({
      familyName: 'The Johnson Family',
      firstRequestId: 'reqemma00000001',
    })
  })

  it("names each stop's reason as the view words it", () => {
    const [garcia] = walkStops(GRID_ROWS, requestView('holds'), TODAY)
    expect(garcia).toMatchObject({ householdCmId: 1000003, reason: 'placeholder income' })
  })

  it('walks only the rows the grid showed: its filters come along (M5)', () => {
    const stops = walkStops(GRID_ROWS, requestView('all'), TODAY, {
      ...NO_FILTERS,
      program: 'quest',
    })
    expect(stops.map((s) => s.householdCmId)).toEqual([1000005])
  })

  it("reads the grid's filters and Show IDs back from the household link", () => {
    const { filters, keep } = gridFiltersFrom(
      new URLSearchParams('from=all&program=quest&round=2&tick=posted&ids=1&year=2027')
    )
    expect(filters).toEqual({ program: 'quest', pool: null, round: 2, tick: 'posted', ids: null })
    expect(keep).toEqual({ program: 'quest', round: '2', tick: 'posted', ids: '1' })
  })

  it("follows a grouped view's groups: Needs an offer's Round 1 before its Round 2", () => {
    const stops = walkStops(GRID_ROWS, requestView('needs-offer'), TODAY)
    expect(stops.map((s) => s.familyName)).toEqual(['The Johnson Family', 'The Chen Family'])
  })
})

describe('walkPosition', () => {
  it('knows where a household sits, and its neighbours', () => {
    const stops = walkStops(GRID_ROWS, requestView('all'), TODAY)
    expect(walkPosition(stops, 1000005)).toMatchObject({
      index: 2,
      total: 4,
      previous: { householdCmId: 1000003 },
      next: { householdCmId: 1000007 },
    })
    expect(walkPosition(stops, 1000001)?.previous).toBeNull()
    expect(walkPosition(stops, 1000099)).toBeNull()
  })
})
