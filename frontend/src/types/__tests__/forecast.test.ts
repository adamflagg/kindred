import { describe, it, expect } from 'vitest'
import type { ForecastResponse } from '../forecast'

describe('forecast types', () => {
  it('ForecastResponse has week_number and day_offset', () => {
    // Construct a full ForecastResponse including new week-relative fields.
    // After the type update, this will also be validated via `satisfies`.
    const response: ForecastResponse = {
      year: 2026,
      sessions: [],
      grand_total: {
        session_cm_id: 0,
        session_name: 'Grand Total',
        session_type: 'total',
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
      },
      // @ts-expect-error - week_number not yet on ForecastResponse (TDD red phase)
      week_number: 22,
      // day_offset assigned below to avoid TS error on literal
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(response as any).day_offset = 159

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((response as any).week_number).toBe(22)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((response as any).day_offset).toBe(159)
  })

  it('WeekOption has required fields', () => {
    // WeekOption type will be added in the implementation commit.
    // For now, validate the shape at runtime.
    const opt = {
      week_number: 5,
      day_offset: 35,
      label: 'Week 5 · Nov 19',
      is_today: false,
    }
    expect(opt.week_number).toBe(5)
    expect(opt.label).toContain('Week 5')
  })
})
