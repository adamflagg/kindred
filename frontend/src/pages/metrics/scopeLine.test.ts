/**
 * scopeLine — the line under each Analytics title that says what the page counts (PR 4).
 *
 * Pick 1A (owner, 2026-10-14) replaces the old subtitle with it: the season (or seasons) the page
 * reads, the scope the session filter picked, what that scope leaves out, the page's unit (board
 * 8: the plan's wording plus the lead's per-page proposals), and the standing "Summer only" note.
 */
import { describe, it, expect } from 'vitest'
import { scopeLine, scopeWords, SUMMER_ONLY } from './scopeLine'

const atCamp = { label: 'At Camp', left: 'Quests and Teens not counted' }

describe('scopeWords — what the session filter picked, and what it leaves out', () => {
  const base = {
    viewMode: 'sessions' as const,
    selectedSession: undefined,
    selectedDuration: null,
    selectedTeenType: null,
  }

  it('At Camp leaves out Quests and Teens', () => {
    expect(scopeWords(base)).toEqual(atCamp)
  })

  it('All Summer leaves nothing out', () => {
    expect(scopeWords({ ...base, viewMode: 'all' })).toEqual({ label: 'All Summer', left: null })
  })

  it('Quests leaves out At Camp and Teens', () => {
    expect(scopeWords({ ...base, viewMode: 'quests' })).toEqual({
      label: 'Quests',
      left: 'At Camp and Teens not counted',
    })
  })

  it('Teens leaves out At Camp and Quests', () => {
    expect(scopeWords({ ...base, viewMode: 'teens' })).toEqual({
      label: 'Teens',
      left: 'At Camp and Quests not counted',
    })
  })

  it('one session leaves out the others', () => {
    expect(scopeWords({ ...base, selectedSession: { name: 'Session 2' } })).toEqual({
      label: 'Session 2',
      left: 'other sessions not counted',
    })
  })

  it('a length leaves out the other lengths', () => {
    expect(scopeWords({ ...base, selectedDuration: '2-week' })).toEqual({
      label: '2 Week',
      left: 'other session lengths not counted',
    })
  })

  it('one teen program leaves out the other sessions', () => {
    expect(scopeWords({ ...base, selectedTeenType: 'scit' })).toEqual({
      label: 'SCIT',
      left: 'other sessions not counted',
    })
  })
})

describe('scopeLine — per page', () => {
  it('Today names no unit: it mixes campers and camper-sessions, and each card names its own', () => {
    expect(scopeLine('/analytics/today', 2027, atCamp)).toEqual({
      head: '2027 · At Camp',
      left: 'Quests and Teens not counted',
      unit: null,
    })
  })

  it('Registration Overview: the season, the scope, campers', () => {
    expect(scopeLine('/analytics/registration/overview', 2026, atCamp)).toEqual({
      head: '2026 · At Camp',
      left: 'Quests and Teens not counted',
      unit: 'counted in campers',
    })
  })

  it('Retention reads last season into this one, over last year’s campers', () => {
    expect(scopeLine('/analytics/retention', 2026, atCamp)).toEqual({
      head: '2025 → 2026 · At Camp',
      left: 'Quests and Teens not counted',
      unit: "counted in last year's campers",
    })
  })

  it.each([
    ['/analytics/retention/bunks', 'Bunk Analysis'],
    ['/analytics/retention/staff', 'Staff Analysis'],
  ])('%s reads every cabin and says the filter does not apply', (path) => {
    expect(scopeLine(path, 2026, atCamp)).toEqual({
      head: '2025 → 2026 · every 2025 cabin',
      left: "the session filter doesn't apply here",
      unit: "counted in last year's campers",
    })
  })

  it('Trends Overview reads five seasons', () => {
    expect(scopeLine('/analytics/trends', 2026, atCamp).head).toBe('2022–2026 · At Camp')
  })

  it('Day 1 reads three seasons, in camper-sessions', () => {
    const l = scopeLine('/analytics/registration/day1', 2026, atCamp)
    expect(l.head).toBe('2024–2026 · At Camp')
    expect(l.unit).toBe('counted in camper-sessions')
  })

  it.each([
    ['/analytics/registration/geo', 'counted in campers'],
    ['/analytics/registration/waitlist', 'counted in campers'],
    ['/analytics/registration/cancellations', 'counted in campers'],
    ['/analytics/registration/availability', null],
    ['/analytics/registration/forecast', null],
    ['/analytics/retention/flow', null],
    ['/analytics/trends/velocity', 'counted in camper-sessions'],
    ['/analytics/trends/cancellations', 'counted in cancelled camper-sessions'],
  ])('%s is %s', (path, unit) => {
    expect(scopeLine(path, 2026, atCamp).unit).toBe(unit)
  })

  it('All Summer has nothing left out', () => {
    expect(
      scopeLine('/analytics/registration/overview', 2026, { label: 'All Summer', left: null }).left
    ).toBeNull()
  })

  it('names what Analytics never counts', () => {
    expect(SUMMER_ONLY).toBe(
      "Summer only: Family Camp, B*Mitzvah and winter programs aren't in Analytics"
    )
  })
})
