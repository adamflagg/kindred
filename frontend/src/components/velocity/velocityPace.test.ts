import { describe, expect, it } from 'vitest'
import type { PriorYearSessionSummary, VelocityCurve } from '../../types/velocity'
import { PACE_LEVEL_CAMPERS, buildPaceModel, paceColumns } from './velocityPace'
import { sessionPriorOf } from './velocityCompare'

function curve(cmId: number, name: string, now: number): VelocityCurve {
  return {
    year: 2026,
    session_cm_id: cmId,
    session_name: name,
    gender: null,
    daily: [],
    weekly: [
      {
        week_number: 1,
        week_label: 'Wk 1',
        week_start: '2026-01-01',
        week_end: '2026-01-07',
        is_partial: false,
        days_in_week: 7,
        enrolled: now,
        gross_enrolled: now,
        weekly_new: 0,
        weekly_cancelled: 0,
        delta: 0,
        enrolled_boys: null,
        enrolled_girls: null,
        gross_enrolled_boys: null,
        gross_enrolled_girls: null,
        weekly_new_boys: null,
        weekly_new_girls: null,
        weekly_cancelled_boys: null,
        weekly_cancelled_girls: null,
        data_source: 'snapshot',
      },
    ],
  }
}

function prior(
  cmId: number,
  name: string,
  samePoint: number | null,
  final: number,
  more: Partial<PriorYearSessionSummary> = {}
): PriorYearSessionSummary {
  return {
    year: 2025,
    session_name: name,
    session_cm_id: cmId,
    current_session_cm_id: cmId,
    enrolled_at_current_week: samePoint,
    final_enrolled: final,
    ...more,
  }
}

/** The page's map: matched by the current session's id, unmatched by name (useVelocityChartData). */
function mapOf(summaries: PriorYearSessionSummary[]) {
  const map = new Map<number | string, PriorYearSessionSummary>()
  for (const s of summaries) {
    if (s.current_session_cm_id != null) map.set(s.current_session_cm_id, s)
    else if (s.session_name) map.set(s.session_name, s)
  }
  return map
}

const sessions = [
  curve(1, 'Session 1', 200), // 200 vs 230: ▼ 30
  curve(2, 'Session 2', 251), // 251 vs 250: level (+1)
  curve(3, 'Session 2a', 108), // 108 vs 78: ▲ 30, embedded
  curve(4, 'Session 3', 90), // 90 vs 92: level (−2), the edge of level
  curve(5, 'Quest', 12), // 12 vs 9: ▲ 3, just outside level
  curve(6, 'Junior Session', 38), // no match last year: new
]
const summaries = [
  prior(1, 'Session 1', 230, 260),
  prior(2, 'Session 2', 250, 280),
  prior(3, 'Session 2a', 78, 80),
  prior(4, 'Session 3', 92, 95),
  prior(5, 'Quest', 9, 14),
  // Retired: a main session, and an embedded one that folds into Session 1.
  prior(90, 'Session 5', 40, 44, { current_session_cm_id: null }),
  prior(91, 'Session 1b', 20, 29, { current_session_cm_id: null, folds_into_session_cm_id: 1 }),
]
const base = {
  sessions,
  priorSessionMap: mapOf(summaries),
  summaries,
  basis: 'same_point' as const,
  fold: false,
  embeddedIds: new Set([3]),
}

describe('buildPaceModel', () => {
  it('level is within 2 campers (decision 19), one constant', () => {
    expect(PACE_LEVEL_CAMPERS).toBe(2)
  })

  it('ranks the comparable sessions by change, most behind first, with now vs last', () => {
    const model = buildPaceModel(base)
    expect(model.rows.map((r) => [r.name, r.now, r.prior, r.change, r.level])).toEqual([
      ['Session 1', 200, 230, -30, false],
      ['Session 3', 90, 92, -2, true],
      ['Session 2', 251, 250, 1, true],
      ['Quest', 12, 9, 3, false],
      ['Session 2a', 108, 78, 30, false],
    ])
    expect(model.rows.find((r) => r.name === 'Session 2a')?.embedded).toBe(true)
  })

  it('counts behind, level, ahead and new; new sessions are counted, not drawn', () => {
    const model = buildPaceModel(base)
    expect(model.counts).toEqual({ behind: 1, level: 2, ahead: 2, new: 1 })
    expect(model.rows.some((r) => r.name === 'Junior Session')).toBe(false)
  })

  it('scales every bar to the largest change, at least 5', () => {
    expect(buildPaceModel(base).scale).toBe(30)
    const quiet = buildPaceModel({ ...base, sessions: [curve(2, 'Session 2', 252)] })
    expect(quiet.scale).toBe(5)
  })

  it('lists sessions not offered this year apart, outside the counts and the scale', () => {
    const model = buildPaceModel({
      ...base,
      summaries: [...summaries, prior(92, 'Session 9', 400, 410, { current_session_cm_id: null })],
    })
    expect(model.notOffered).toEqual([
      { name: 'Session 5', prior: 40 },
      { name: 'Session 1b', prior: 20 },
      { name: 'Session 9', prior: 400 },
    ])
    expect(model.scale).toBe(30)
    expect(model.counts.behind).toBe(1)
  })

  it('a past season compares each session with its final (ruling #98)', () => {
    const model = buildPaceModel({ ...base, basis: 'final' })
    const s1 = model.rows.find((r) => r.name === 'Session 1')
    expect([s1?.prior, s1?.change]).toEqual([260, -60])
    expect(model.notOffered).toContainEqual({ name: 'Session 5', prior: 44 })
  })

  it('folds a retired embedded session into its main session only when asked (ruling #97)', () => {
    expect(buildPaceModel(base).canFold).toBe(true)
    const model = buildPaceModel({ ...base, fold: true })
    const s1 = model.rows.find((r) => r.name === 'Session 1')
    expect([s1?.prior, s1?.change]).toEqual([250, -50])
    expect(s1?.folded).toEqual([{ name: 'Session 1b', prior: 20 }])
    expect(model.notOffered).toEqual([{ name: 'Session 5', prior: 40 }])
  })

  it('offers no fold when no retired session has a main session to fold into', () => {
    const plain = summaries.filter((s) => s.session_cm_id !== 91)
    expect(
      buildPaceModel({ ...base, summaries: plain, priorSessionMap: mapOf(plain) }).canFold
    ).toBe(false)
  })

  it('uses the By Session table own prior lookup, so the two always agree', () => {
    const map = mapOf(summaries)
    for (const row of buildPaceModel(base).rows) {
      const session = sessions.find((s) => s.session_cm_id === row.cmId)!
      expect(row.prior).toBe(sessionPriorOf(session, map)?.enrolled_at_current_week)
      expect(row.now).toBe(session.weekly.at(-1)?.enrolled)
    }
  })
})

describe('paceColumns', () => {
  it('cuts the ranked list in half, the first column taking the odd one', () => {
    expect(paceColumns([1, 2, 3, 4, 5])).toEqual([
      [1, 2, 3],
      [4, 5],
    ])
    expect(paceColumns([1, 2])).toEqual([[1], [2]])
  })
})
