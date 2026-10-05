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
    // Verbatim: the grid's own casing, so a name inside it ("Family Camp cost") is never mangled.
    expect(garcia).toMatchObject({ householdCmId: 1000003, reason: 'Placeholder income' })
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
      new URLSearchParams('from=all&program=quest&round=2&ids=1&year=2027')
    )
    expect(filters).toEqual({ program: 'quest', pool: null, round: 2, ids: null })
    expect(keep).toEqual({ program: 'quest', round: '2', ids: '1' })
  })

  it('keeps a Today line on the household link, so Back and the walk stay on it', () => {
    const { keep } = gridFiltersFrom(new URLSearchParams('from=all&today=would_change&year=2027'))
    expect(keep).toEqual({ today: 'would_change' })
  })

  it('ignores a Today key that is not a listed line (m1)', () => {
    const { keep, todayKey } = gridFiltersFrom(new URLSearchParams('from=all&today=holds'))
    expect(keep).toEqual({})
    expect(todayKey).toBeNull()
  })

  it("walks only a Today line's requests when its ids come along", () => {
    const stops = walkStops(GRID_ROWS, requestView('all'), TODAY, {
      ...NO_FILTERS,
      ids: new Set(['reqolivia000003']),
    })
    expect(stops.map((s) => s.householdCmId)).toEqual([1000005])
  })

  it("follows a grouped view's groups: Needs an offer's Round 1 before its Round 2", () => {
    const stops = walkStops(GRID_ROWS, requestView('needs-offer'), TODAY)
    expect(stops.map((s) => s.familyName)).toEqual(['The Johnson Family', 'The Chen Family'])
  })
})

describe("the grid's sort and grouping (I1)", () => {
  const ids = (key: string, order: { sort: string | null; group: string | null }) =>
    walkStops(GRID_ROWS, requestView(key), TODAY, NO_FILTERS, { ...order, showIds: false }).map(
      (s) => s.householdCmId
    )

  it('reads sort and group back from the household link, and keeps them for the links', () => {
    const { keep, order } = gridFiltersFrom(
      new URLSearchParams('from=all&lens=appeals&sort=total:desc&group=reason&ids=1')
    )
    expect(keep).toEqual({ lens: 'appeals', ids: '1', sort: 'total:desc', group: 'reason' })
    expect(order).toEqual({ sort: 'total:desc', group: 'reason', showIds: true })
  })

  it('steps in the sorted order, as the grid listed it', () => {
    // Total decided, largest first: Chen 2,200, Johnson 1,800, Sam 1,500, Garcia (nothing) last.
    expect(ids('all', { sort: 'total:desc', group: null })).toEqual([
      1000005, 1000001, 1000007, 1000003,
    ])
  })

  it('ignores a sort on a column the view does not have', () => {
    expect(ids('all', { sort: 'newTotal:desc', group: null })).toEqual([
      1000001, 1000003, 1000005, 1000007,
    ])
  })

  // By family is gone from the grid (owner ruling A2): an unknown group reads as the view's own, as the
  // grid's table does (useAidTableUrl).
  it("follows the grid's grouping choice: by reason pulls a reason together, flat does not, an unknown one is the view's own", () => {
    // All opens flat; By reason groups Johnson and Chen (nothing waiting) ahead of Garcia.
    expect(ids('all', { sort: null, group: null })).toEqual([1000001, 1000003, 1000005, 1000007])
    expect(ids('all', { sort: null, group: 'reason' })).toEqual([
      1000001, 1000005, 1000003, 1000007,
    ])
    expect(ids('all', { sort: null, group: 'family' })).toEqual([
      1000001, 1000003, 1000005, 1000007,
    ])
    // Needs an offer opens by reason (its rounds): an unknown group keeps that, as `null` does.
    expect(ids('needs-offer', { sort: 'decided:asc', group: 'family' })).toEqual(
      ids('needs-offer', { sort: 'decided:asc', group: null })
    )
  })

  it("follows a queue view's groups in the order the sorted rows first reach them, and group=flat drops them", () => {
    // Needs an offer by decided amount: Chen's R2 (780) sorts ahead of Johnson's R1 (1,420), so
    // the grid shows R2's group first, exactly as groupRows does.
    expect(ids('needs-offer', { sort: 'decided:asc', group: null })).toEqual([1000005, 1000001])
    expect(ids('needs-offer', { sort: 'decided:asc', group: 'flat' })).toEqual([1000005, 1000001])
    expect(ids('needs-offer', { sort: null, group: 'flat' })).toEqual([1000001, 1000005])
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
