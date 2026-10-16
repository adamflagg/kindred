/**
 * Analytics › Today (#3207 PR 8): the page's pure model. Owner rulings: session order, always "vs same
 * point last year", no started pills, the Fill switch, "goal not set yet", Cancelled red when it rises
 * (2026-10-14); #14 unoffered sessions are not drawn, #15 the fill total counts only matched sessions
 * (2026-10-15).
 */
import { describe, expect, it } from 'vitest'
import type { ApiTodaySessionRow } from '../../../types/api-types'
import {
  basisWords,
  fillGroups,
  fillTotal,
  openPlaces,
  registrationDayWords,
  scopeRows,
  todayNotes,
} from './todayModel'

function row(over: Partial<ApiTodaySessionRow>): ApiTodaySessionRow {
  return {
    session_cm_id: 1000200,
    session_name: 'Session 2',
    session_type: 'main',
    enrolled: 277,
    waitlisted: 28,
    beds: 288,
    goal: 285,
    prior: 268,
    parts: [
      { label: 'Girls', enrolled: 134, waitlisted: 10, beds: 138, prior: 130 },
      { label: 'Boys', enrolled: 131, waitlisted: 16, beds: 138, prior: 126 },
      { label: 'AG', enrolled: 12, waitlisted: 2, beds: 12, prior: 12 },
    ],
    ...over,
  }
}

const TOC = row({
  session_cm_id: 1000901,
  session_name: 'Taste of Camp',
  session_type: 'embedded',
  enrolled: 109,
  waitlisted: 6,
  beds: 120,
  goal: 115,
  prior: 104,
  parts: [
    { label: 'Girls', enrolled: 51, waitlisted: 2, beds: 54, prior: 50 },
    { label: 'Boys', enrolled: 47, waitlisted: 4, beds: 54, prior: 54 },
    { label: 'AG', enrolled: 11, waitlisted: 0, beds: 12, prior: 0 },
  ],
})
const S2 = row({})
const QUEST = row({
  session_cm_id: 1000401,
  session_name: 'Quest 6',
  session_type: 'quest',
  enrolled: 14,
  waitlisted: 0,
  beds: null,
  goal: null,
  prior: 18,
  parts: [{ label: '', enrolled: 14, waitlisted: 0, beds: null, prior: 18 }],
})
const SCIT = row({
  session_cm_id: 0,
  session_name: 'SCIT',
  session_type: 'scit',
  enrolled: 38,
  waitlisted: 4,
  beds: 40,
  goal: 38,
  prior: 36,
  parts: [{ label: '', enrolled: 38, waitlisted: 4, beds: 40, prior: 36 }],
})
const NEW_SESSION = row({
  session_cm_id: 1000950,
  session_name: 'Session 5',
  enrolled: 20,
  waitlisted: 0,
  beds: 40,
  goal: null,
  prior: null,
})

describe('basisWords', () => {
  it('reads "vs same point" while the season is live', () => {
    expect(basisWords('same_point', 2026)).toBe('vs same point 2026')
  })
  it("reads last year's final once the season is over", () => {
    expect(basisWords('final', 2026)).toBe('vs 2026 final')
  })
})

describe('registrationDayWords', () => {
  it('counts registration days from the priority date as day 1', () => {
    expect(registrationDayWords(0, 'Nov 11')).toBe('Priority registration, day 1')
    expect(registrationDayWords(90, 'Nov 11')).toBe('Registration day 91')
  })
  it('says when priority registration opens before it does', () => {
    expect(registrationDayWords(-9, 'Nov 11')).toBe(
      'Before priority registration, which opens Nov 11'
    )
  })
  it('says nothing about the day when the season has no anchor', () => {
    expect(registrationDayWords(null, null)).toBeNull()
  })
})

describe('fillGroups', () => {
  it('names a group only when the scope spans more than one (At Camp, Quests, Teens)', () => {
    expect(fillGroups([TOC, S2]).map((g) => g.label)).toEqual([null])
    expect(fillGroups([TOC, S2, QUEST, SCIT]).map((g) => [g.label, g.rows.length])).toEqual([
      ['At Camp', 2],
      ['Quests', 1],
      ['Teens', 1],
    ])
  })
})

describe('scopeRows', () => {
  it('lists the sessions as they come', () => {
    expect(scopeRows([TOC, S2], false).map((r) => r.name)).toEqual(['Taste of Camp', 'Session 2'])
  })

  it('one session splits into its cabin groups, each goal set per session', () => {
    const rows = scopeRows([S2], true)
    expect(rows.map((r) => [r.name, r.enrolled, r.beds, r.prior, r.goalPerSession])).toEqual([
      ['Girls', 134, 138, 130, true],
      ['Boys', 131, 138, 126, true],
      ['AG cabins', 12, 12, 12, true],
    ])
  })
})

describe('fillTotal (ruling #15: only matched sessions)', () => {
  it('sums enrolled, beds, goals and waitlist', () => {
    const total = fillTotal(scopeRows([TOC, S2, QUEST], false))
    expect(total.enrolled).toBe(109 + 277 + 14)
    expect(total.waitlisted).toBe(6 + 28)
    expect(total.beds).toBe(120 + 288)
    expect(total.bedsEnrolled).toBe(109 + 277) // fill reads only sessions that have beds
    expect(total.goal).toBe(115 + 285)
    expect(total.goalEnrolled).toBe(109 + 277)
  })

  it('compares only sessions that have a match last year', () => {
    const total = fillTotal(scopeRows([TOC, S2, NEW_SESSION], false))
    expect(total.prior).toBe(104 + 268)
    expect(total.matchedEnrolled).toBe(109 + 277)
    expect(total.enrolled).toBe(109 + 277 + 20)
  })

  it('has no beds or goal when none is set', () => {
    const total = fillTotal(scopeRows([QUEST], false))
    expect(total.beds).toBeNull()
    expect(total.goal).toBeNull()
  })

  it('has no comparison when nothing matches', () => {
    expect(fillTotal(scopeRows([NEW_SESSION], false)).prior).toBeNull()
  })
})

describe('openPlaces', () => {
  it('a full group reads "full"; a group past the limited line reads "n left"', () => {
    expect(openPlaces(scopeRows([S2], false)[0]!, 95)).toEqual([
      { words: 'Girls 4 left', full: false },
      { words: 'AG full', full: true },
    ])
  })

  it('a one-part row names no group', () => {
    const quest = row({
      session_type: 'quest',
      parts: [{ label: '', enrolled: 24, waitlisted: 6, beds: 24, prior: 23 }],
    })
    expect(openPlaces(scopeRows([quest], false)[0]!, 95)).toEqual([{ words: 'full', full: true }])
  })

  it('a group with no beds says nothing', () => {
    expect(openPlaces(scopeRows([QUEST], false)[0]!, 95)).toEqual([])
  })
})

describe('todayNotes', () => {
  it('numbers the notes in page order, only those that show', () => {
    const notes = todayNotes({
      basis: 'same_point',
      dayOffset: 90,
      priorYear: 2026,
      throughNextDay: false,
      dash: true,
      fill: 'plan',
      recent: true,
    })
    expect(notes.map((n) => [n.key, n.n])).toEqual([
      ['enrolled', 1],
      ['same', 2],
      ['dash', 3],
      ['sessions', 4],
      ['fill', 5],
      ['recent', 6],
    ])
  })

  it('drops the dash note when nothing reads a dash, and the recent note when the card has folded', () => {
    const notes = todayNotes({
      basis: 'final',
      dayOffset: null,
      priorYear: 2026,
      throughNextDay: false,
      dash: false,
      fill: 'goal',
      recent: false,
    })
    expect(notes.map((n) => n.key)).toEqual(['enrolled', 'same', 'sessions', 'fill'])
  })

  it('adds the opening-day note when last year is read through the next day', () => {
    const notes = todayNotes({
      basis: 'same_point',
      dayOffset: 0,
      priorYear: 2026,
      throughNextDay: true,
      dash: true,
      fill: 'plan',
      recent: true,
    })
    expect(notes.at(-1)?.key).toBe('nextDay')
  })

  it('says the fill total counts only sessions matched last year (ruling #15)', () => {
    const same = todayNotes({
      basis: 'same_point',
      dayOffset: 90,
      priorYear: 2026,
      throughNextDay: false,
      dash: false,
      fill: 'plan',
      recent: false,
    }).find((n) => n.key === 'same')
    expect(same?.text).toMatch(/today is day 91/)
    expect(same?.text).toMatch(/not offered this year is not counted/)
  })
})
