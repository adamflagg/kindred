/**
 * Analytics › Today (#3207 PR 8): the page's pure model. Owner rulings: session order, always "vs same
 * point last year", no started pills, the Fill switch, "goal not set yet", Cancelled red when it rises
 * (2026-10-14); #14 unoffered sessions are not drawn, #15 the fill total counts only matched sessions
 * (2026-10-15). PR 8b: #15's embedded add, #50's tooltip breakdown (wording A) and #51's fold by people.
 */
import { describe, expect, it } from 'vitest'
import type { ApiTodaySessionRow, ApiTodaySessions } from '../../../types/api-types'
import {
  basisWords,
  fillGroups,
  fillTotal,
  foldName,
  foldedLine,
  openPlaces,
  pacePrior,
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
  // Owner call 2026-10-26 (item 6): with no same day it says so, never "vs <year>" over nothing.
  it('never reads "final" (PM-8 A): with no same day it reads "no comparison"', () => {
    expect(basisWords('none', 2026)).toBe('no comparison')
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
      basis: 'same_point',
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

  it('says the same day holds all year, never a final (PM-8 A)', () => {
    const same = todayNotes({
      basis: 'same_point',
      dayOffset: 347,
      priorYear: 2026,
      throughNextDay: false,
      dash: false,
      fill: 'plan',
      recent: false,
    }).find((n) => n.key === 'same')
    expect(same?.text).toMatch(/all year/)
    expect(same?.text).not.toMatch(/final/)
  })

  it('with no same day, the same note says there is no comparison and why', () => {
    const same = todayNotes({
      basis: 'none',
      dayOffset: null,
      priorYear: 2026,
      throughNextDay: false,
      dash: false,
      fill: 'plan',
      recent: false,
    }).find((n) => n.key === 'same')
    expect(same?.text).toMatch(/^No comparison: /)
    expect(same?.text).toMatch(/registration dates/)
    expect(same?.text).not.toMatch(/final/)
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

// PR 8b: 2026's Taste of Camp 2 (58) and Session 2b (66) fold into 2026 Session 2 (268), as the signed-off mock
const S2_FOLDED = row({
  prior: 392,
  prior_parts: [
    { name: 'Session 2', prior: 268 },
    { name: 'Taste of Camp 2', prior: 58 },
    { name: 'Session 2b', prior: 66 },
  ],
  parts: [
    {
      label: 'Girls',
      enrolled: 134,
      waitlisted: 10,
      beds: 138,
      prior: 193,
      prior_parts: [
        { name: 'Session 2', prior: 130 },
        { name: 'Taste of Camp 2', prior: 30 },
        { name: 'Session 2b', prior: 33 },
      ],
    },
    {
      label: 'Boys',
      enrolled: 131,
      waitlisted: 16,
      beds: 138,
      prior: 187,
      prior_parts: [
        { name: 'Session 2', prior: 126 },
        { name: 'Taste of Camp 2', prior: 28 },
        { name: 'Session 2b', prior: 33 },
      ],
    },
    { label: 'AG', enrolled: 12, waitlisted: 2, beds: 12, prior: 12 },
  ],
})

describe('the embedded add (#15, #50)', () => {
  it('a row and its cabin groups carry their breakdowns', () => {
    expect(scopeRows([S2_FOLDED], false)[0]?.priorParts?.map((p) => p.prior)).toEqual([268, 58, 66])
    expect(scopeRows([S2_FOLDED], true).map((r) => r.priorParts?.length ?? 0)).toEqual([3, 3, 0])
    expect(scopeRows([TOC], false)[0]?.priorParts).toBeNull()
  })

  it('the total breaks down into the matched sessions, then each folded one', () => {
    const total = fillTotal(scopeRows([TOC, S2_FOLDED, NEW_SESSION], false))
    expect(total.prior).toBe(104 + 392)
    expect(total.priorParts).toEqual([
      { name: '2 matched sessions', prior: 104 + 268 },
      { name: 'Taste of Camp 2', prior: 58 },
      { name: 'Session 2b', prior: 66 },
    ])
  })

  it("one session's total names the session and adds up its cabin groups' folds", () => {
    const total = fillTotal(scopeRows([S2_FOLDED], true))
    expect(total.prior).toBe(193 + 187 + 12)
    expect(total.priorParts).toEqual([
      { name: 'Session 2', prior: 130 + 126 + 12 },
      { name: 'Taste of Camp 2', prior: 58 },
      { name: 'Session 2b', prior: 66 },
    ])
  })

  it('a total with nothing folded has no breakdown', () => {
    expect(fillTotal(scopeRows([TOC, S2], false)).priorParts).toBeNull()
  })

  it('one matched session reads in the singular', () => {
    expect(fillTotal(scopeRows([S2_FOLDED], false)).priorParts?.[0]?.name).toBe('1 matched session')
  })

  it('a folded session drops a leading "Session " (wording A: "2b"); the main session keeps its name', () => {
    expect(foldName('Session 2b')).toBe('2b')
    expect(foldName('Taste of Camp 2')).toBe('Taste of Camp 2')
    expect(foldedLine(S2_FOLDED.prior_parts ?? [])).toEqual([
      ['Session 2', 268],
      ['Taste of Camp 2', 58],
      ['2b', 66],
    ])
  })
})

describe('pacePrior (Pace compares what the fill total compares)', () => {
  const data: ApiTodaySessions = {
    year: 2027,
    prior_year: 2026,
    limited_threshold: 95,
    prior_basis: 'same_point',
    rows: [TOC, S2_FOLDED],
    pace_prior: [
      { day_offset: 0, enrolled: 300 },
      { day_offset: 90, enrolled: 495 },
      { day_offset: 286, enrolled: 540 },
    ],
  }

  it("reads last year's curve from the fill's sessions and its point from the fill total", () => {
    const pace = pacePrior(data, false)
    expect(pace?.curve.map((p) => p.enrolled)).toEqual([300, 495, 540])
    expect(pace?.now).toBe(104 + 392)
    expect(pace?.parts?.[0]).toEqual({ name: '2 matched sessions', prior: 104 + 268 })
  })

  it("is null without a curve, so Pace keeps Velocity's own prior", () => {
    expect(pacePrior({ ...data, pace_prior: null }, false)).toBeNull()
  })
})

describe('todayNotes (PR 8b)', () => {
  it('the same-point note says embedded sessions with no match are added to the session containing them', () => {
    const same = todayNotes({
      basis: 'same_point',
      dayOffset: 90,
      priorYear: 2026,
      throughNextDay: false,
      dash: false,
      fill: 'plan',
      recent: false,
    }).find((n) => n.key === 'same')
    expect(same?.text).toMatch(
      /A 2026 embedded session with no 2027 match is added to the 2026 figure of the session whose dates contain it/
    )
  })
})
