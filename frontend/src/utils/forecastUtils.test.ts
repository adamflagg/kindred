import { describe, it, expect } from 'vitest'
import type { SessionForecast } from '../types/forecast'
import { computeSectionTotal, buildForecastSections } from './forecastUtils'

// ---------- helpers ----------

/** Create a minimal SessionForecast with overrides */
function session(overrides: Partial<SessionForecast> = {}): SessionForecast {
  return {
    session_cm_id: 1001,
    session_name: 'Session 1',
    session_type: 'main',
    participant_goal: null,
    session_fee: null,
    enrolled: 0,
    waitlisted: 0,
    pct_of_goal: null,
    prior_year_count: null,
    two_year_prior_count: null,
    participants_vs_budget: null,
    participants_vs_prior_year: null,
    budget_revenue: null,
    actual_revenue: null,
    revenue_delta: null,
    revenue_pct: null,
    enrolled_boys: null,
    enrolled_girls: null,
    ...overrides,
  }
}

// ==========================================================================
// computeSectionTotal
// ==========================================================================

describe('computeSectionTotal', () => {
  it('sums enrolled and waitlisted across sessions', () => {
    const total = computeSectionTotal(
      [session({ enrolled: 50, waitlisted: 3 }), session({ enrolled: 40, waitlisted: 2 })],
      'Camp Total'
    )

    expect(total.enrolled).toBe(90)
    expect(total.waitlisted).toBe(5)
  })

  it('sets session_name to the provided label', () => {
    const total = computeSectionTotal([session()], 'Quest Total')
    expect(total.session_name).toBe('Quest Total')
  })

  it('sets session_type to "total" and session_cm_id to 0', () => {
    const total = computeSectionTotal([session()], 'Total')
    expect(total.session_type).toBe('total')
    expect(total.session_cm_id).toBe(0)
  })

  it('sets session_fee to null (not meaningful for totals)', () => {
    const total = computeSectionTotal(
      [session({ session_fee: 1000 }), session({ session_fee: 2000 })],
      'Total'
    )
    expect(total.session_fee).toBeNull()
  })

  // --- null-aware aggregation ---

  it('returns null for participant_goal when all sessions have null goal', () => {
    const total = computeSectionTotal(
      [session({ participant_goal: null }), session({ participant_goal: null })],
      'Total'
    )
    expect(total.participant_goal).toBeNull()
  })

  it('sums participant_goal treating null as 0 when at least one has a value', () => {
    const total = computeSectionTotal(
      [session({ participant_goal: 80 }), session({ participant_goal: 60 })],
      'Total'
    )
    expect(total.participant_goal).toBe(140)
  })

  it('returns null for prior_year_count when all null', () => {
    const total = computeSectionTotal([session(), session()], 'Total')
    expect(total.prior_year_count).toBeNull()
  })

  it('sums prior_year_count when at least one has a value', () => {
    const total = computeSectionTotal(
      [session({ prior_year_count: 45 }), session({ prior_year_count: 30 })],
      'Total'
    )
    expect(total.prior_year_count).toBe(75)
  })

  it('returns null for two_year_prior_count when all null', () => {
    const total = computeSectionTotal([session(), session()], 'Total')
    expect(total.two_year_prior_count).toBeNull()
  })

  it('sums two_year_prior_count when at least one has a value', () => {
    const total = computeSectionTotal(
      [session({ two_year_prior_count: 40 }), session({ two_year_prior_count: null })],
      'Total'
    )
    expect(total.two_year_prior_count).toBe(40)
  })

  it('returns null for budget_revenue/actual_revenue when all null', () => {
    const total = computeSectionTotal([session(), session()], 'Total')
    expect(total.budget_revenue).toBeNull()
    expect(total.actual_revenue).toBeNull()
  })

  it('sums budget_revenue and actual_revenue when at least one has a value', () => {
    const total = computeSectionTotal(
      [
        session({ budget_revenue: 50000, actual_revenue: 45000 }),
        session({ budget_revenue: 30000, actual_revenue: 32000 }),
      ],
      'Total'
    )
    expect(total.budget_revenue).toBe(80000)
    expect(total.actual_revenue).toBe(77000)
  })

  // --- derived percentage fields ---

  it('computes pct_of_goal when goal is available and > 0', () => {
    const total = computeSectionTotal(
      [
        session({ enrolled: 80, participant_goal: 100 }),
        session({ enrolled: 60, participant_goal: 100 }),
      ],
      'Total'
    )
    // 140 / 200 * 100 = 70.0
    expect(total.pct_of_goal).toBe(70.0)
  })

  it('returns null for pct_of_goal when total goal is 0', () => {
    const total = computeSectionTotal([session({ enrolled: 50, participant_goal: 0 })], 'Total')
    expect(total.pct_of_goal).toBeNull()
  })

  it('returns null for pct_of_goal when all goals are null', () => {
    const total = computeSectionTotal([session({ enrolled: 50 })], 'Total')
    expect(total.pct_of_goal).toBeNull()
  })

  it('computes participants_vs_budget when goal is available', () => {
    const total = computeSectionTotal(
      [
        session({ enrolled: 80, participant_goal: 100 }),
        session({ enrolled: 70, participant_goal: 100 }),
      ],
      'Total'
    )
    // 150 - 200 = -50
    expect(total.participants_vs_budget).toBe(-50)
  })

  it('returns null for participants_vs_budget when all goals are null', () => {
    const total = computeSectionTotal([session({ enrolled: 50 })], 'Total')
    expect(total.participants_vs_budget).toBeNull()
  })

  it('computes participants_vs_prior_year when prior data is available', () => {
    const total = computeSectionTotal(
      [
        session({ enrolled: 50, prior_year_count: 45 }),
        session({ enrolled: 40, prior_year_count: 35 }),
      ],
      'Total'
    )
    // 90 - 80 = 10
    expect(total.participants_vs_prior_year).toBe(10)
  })

  it('returns null for participants_vs_prior_year when all priors are null', () => {
    const total = computeSectionTotal([session({ enrolled: 50 })], 'Total')
    expect(total.participants_vs_prior_year).toBeNull()
  })

  it('computes revenue_delta when revenue data is available', () => {
    const total = computeSectionTotal(
      [
        session({ budget_revenue: 50000, actual_revenue: 55000 }),
        session({ budget_revenue: 30000, actual_revenue: 28000 }),
      ],
      'Total'
    )
    // 83000 - 80000 = 3000
    expect(total.revenue_delta).toBe(3000)
  })

  it('returns null for revenue_delta when all revenue is null', () => {
    const total = computeSectionTotal([session()], 'Total')
    expect(total.revenue_delta).toBeNull()
  })

  it('computes revenue_pct when budget revenue > 0', () => {
    const total = computeSectionTotal(
      [
        session({ budget_revenue: 100000, actual_revenue: 90000 }),
        session({ budget_revenue: 100000, actual_revenue: 110000 }),
      ],
      'Total'
    )
    // 200000 / 200000 * 100 = 100.0
    expect(total.revenue_pct).toBe(100.0)
  })

  it('returns null for revenue_pct when total budget_revenue is 0', () => {
    const total = computeSectionTotal(
      [session({ budget_revenue: 0, actual_revenue: 100 })],
      'Total'
    )
    expect(total.revenue_pct).toBeNull()
  })

  it('returns null for revenue_pct when all budget_revenue is null', () => {
    const total = computeSectionTotal([session()], 'Total')
    expect(total.revenue_pct).toBeNull()
  })

  // --- edge cases ---

  it('handles empty array', () => {
    const total = computeSectionTotal([], 'Empty Total')
    expect(total.enrolled).toBe(0)
    expect(total.waitlisted).toBe(0)
    expect(total.participant_goal).toBeNull()
    expect(total.pct_of_goal).toBeNull()
    expect(total.session_name).toBe('Empty Total')
  })

  it('handles single session input', () => {
    const total = computeSectionTotal(
      [session({ enrolled: 50, waitlisted: 3, participant_goal: 55 })],
      'Single'
    )
    expect(total.enrolled).toBe(50)
    expect(total.waitlisted).toBe(3)
    expect(total.participant_goal).toBe(55)
  })

  it('rounds percentages to one decimal place', () => {
    const total = computeSectionTotal([session({ enrolled: 33, participant_goal: 100 })], 'Total')
    expect(total.pct_of_goal).toBe(33.0)
  })
})

// ==========================================================================
// buildForecastSections
// ==========================================================================

describe('buildForecastSections', () => {
  const campSession1 = session({
    session_cm_id: 1001,
    session_name: 'Taste of Camp',
    session_type: 'main',
    enrolled: 50,
  })
  const campSession2 = session({
    session_cm_id: 1002,
    session_name: 'Session 2',
    session_type: 'main',
    enrolled: 80,
  })
  const questSession1 = session({
    session_cm_id: 2001,
    session_name: 'Teen Quests',
    session_type: 'quest',
    enrolled: 20,
  })
  const questSession2 = session({
    session_cm_id: 2002,
    session_name: 'Adventure Quests',
    session_type: 'quest',
    enrolled: 15,
  })

  it('returns both sections when both non-empty', () => {
    const sections = buildForecastSections([campSession1, campSession2], [questSession1])
    expect(sections).toHaveLength(2)
    expect(sections[0]!.key).toBe('camp')
    expect(sections[0]!.label).toBe('At Camp')
    expect(sections[1]!.key).toBe('quest')
    expect(sections[1]!.label).toBe('Quests')
  })

  it('returns only camp section when quests is empty', () => {
    const sections = buildForecastSections([campSession1], [])
    expect(sections).toHaveLength(1)
    expect(sections[0]!.key).toBe('camp')
  })

  it('returns only quest section when camp is empty', () => {
    const sections = buildForecastSections([], [questSession1, questSession2])
    expect(sections).toHaveLength(1)
    expect(sections[0]!.key).toBe('quest')
  })

  it('returns empty array when both are empty', () => {
    const sections = buildForecastSections([], [])
    expect(sections).toHaveLength(0)
  })

  it('camp section comes before quest section', () => {
    const sections = buildForecastSections([campSession1], [questSession1])
    expect(sections[0]!.key).toBe('camp')
    expect(sections[1]!.key).toBe('quest')
  })

  it('includes sessions in each section', () => {
    const sections = buildForecastSections(
      [campSession1, campSession2],
      [questSession1, questSession2]
    )
    expect(sections[0]!.sessions).toHaveLength(2)
    expect(sections[1]!.sessions).toHaveLength(2)
  })

  it('computes a total for each section', () => {
    const sections = buildForecastSections([campSession1, campSession2], [questSession1])
    // Camp total: 50 + 80 = 130
    expect(sections[0]!.total.enrolled).toBe(130)
    expect(sections[0]!.total.session_name).toBe('At Camp')
    // Quest total: 20
    expect(sections[1]!.total.enrolled).toBe(20)
    expect(sections[1]!.total.session_name).toBe('Quests')
  })

  const scitRow = session({
    session_cm_id: 0,
    session_name: 'SCIT',
    session_type: 'scit',
    enrolled: 30,
  })
  const tliRow = session({
    session_cm_id: 0,
    session_name: 'TLI',
    session_type: 'tli',
    enrolled: 40,
  })

  it('appends a Teen Programs section after camp and quest', () => {
    const sections = buildForecastSections([campSession1], [questSession1], [scitRow, tliRow])
    expect(sections).toHaveLength(3)
    expect(sections[2]!.key).toBe('teen')
    expect(sections[2]!.label).toBe('Teen Programs')
    expect(sections[2]!.sessions.map((s) => s.session_name)).toEqual(['SCIT', 'TLI'])
    expect(sections[2]!.total.enrolled).toBe(70)
    expect(sections[2]!.total.session_name).toBe('Teen Programs')
  })

  it('omits the teen section when there are no teen sessions', () => {
    const sections = buildForecastSections([campSession1], [questSession1], [])
    expect(sections.find((s) => s.key === 'teen')).toBeUndefined()
  })

  it('defaults teenSessions to empty (back-compat with 2-arg callers)', () => {
    const sections = buildForecastSections([campSession1], [questSession1])
    expect(sections).toHaveLength(2)
  })

  it('returns only the teen section when camp and quest are empty', () => {
    const sections = buildForecastSections([], [], [scitRow, tliRow])
    expect(sections).toHaveLength(1)
    expect(sections[0]!.key).toBe('teen')
  })
})

// ==========================================================================
// computeSectionTotal gender fields
// ==========================================================================

describe('computeSectionTotal gender fields', () => {
  it('sums gender counts when present', () => {
    const sessions = [
      session({ enrolled: 80, enrolled_boys: 42, enrolled_girls: 38 }),
      session({ session_cm_id: 1002, enrolled: 60, enrolled_boys: 30, enrolled_girls: 30 }),
    ]
    const total = computeSectionTotal(sessions, 'Total')
    expect(total.enrolled_boys).toBe(72)
    expect(total.enrolled_girls).toBe(68)
  })

  it('returns null gender when all sessions have null', () => {
    const sessions = [
      session({ enrolled: 80, enrolled_boys: null, enrolled_girls: null }),
      session({ session_cm_id: 1002, enrolled: 60, enrolled_boys: null, enrolled_girls: null }),
    ]
    const total = computeSectionTotal(sessions, 'Total')
    expect(total.enrolled_boys).toBeNull()
    expect(total.enrolled_girls).toBeNull()
  })

  it('treats null as 0 when some sessions have gender data', () => {
    const sessions = [
      session({ enrolled: 80, enrolled_boys: 42, enrolled_girls: 38 }),
      session({ session_cm_id: 1002, enrolled: 60, enrolled_boys: null, enrolled_girls: null }),
    ]
    const total = computeSectionTotal(sessions, 'Total')
    expect(total.enrolled_boys).toBe(42)
    expect(total.enrolled_girls).toBe(38)
  })
})
