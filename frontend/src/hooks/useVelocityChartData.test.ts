/**
 * Tests for useVelocityChartData hook.
 *
 * Covers extraction of ~10 useMemo blocks from VelocityPage and
 * CancellationVelocityPage into a shared hook parameterized by metric type.
 */
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { VelocityResponse, VelocityCurve } from '../types/velocity'
import { useVelocityChartData } from './useVelocityChartData'

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeWeeklyPoint(overrides: Record<string, unknown> = {}) {
  return {
    week_start: '2025-01-06',
    week_end: '2025-01-12',
    week_label: 'Jan 6–12',
    week_number: 1,
    enrolled: 100,
    delta: 10,
    data_source: 'snapshot' as const,
    gross_enrolled: 110,
    weekly_new: 15,
    weekly_cancelled: 5,
    is_partial: false,
    days_in_week: 7,
    enrolled_boys: null as number | null,
    enrolled_girls: null as number | null,
    gross_enrolled_boys: null as number | null,
    gross_enrolled_girls: null as number | null,
    weekly_new_boys: null as number | null,
    weekly_new_girls: null as number | null,
    weekly_cancelled_boys: null as number | null,
    weekly_cancelled_girls: null as number | null,
    ...overrides,
  }
}

function makeDailyPoint(overrides: Record<string, unknown> = {}) {
  return {
    date: '2025-01-06',
    day_offset: 0,
    gross_enrolled: 110,
    enrolled: 100,
    cancelled: 5,
    daily_new: 3,
    daily_cancelled: 1,
    daily_new_boys: null as number | null,
    daily_new_girls: null as number | null,
    daily_cancelled_boys: null as number | null,
    daily_cancelled_girls: null as number | null,
    gross_enrolled_boys: null as number | null,
    gross_enrolled_girls: null as number | null,
    enrolled_boys: null as number | null,
    enrolled_girls: null as number | null,
    data_source: 'snapshot' as const,
    ...overrides,
  }
}

function makeVelocityCurve(overrides: Partial<VelocityCurve> = {}): VelocityCurve {
  return {
    year: 2025,
    session_cm_id: null,
    session_name: null,
    gender: null,
    daily: [],
    weekly: [],
    ...overrides,
  }
}

function makeResponse(overrides: Partial<VelocityResponse> = {}): VelocityResponse {
  return {
    year: 2025,
    season_start: '2024-09-01',
    combined: makeVelocityCurve({
      weekly: [
        makeWeeklyPoint({ week_number: 1 }),
        makeWeeklyPoint({
          week_number: 2,
          enrolled: 120,
          gross_enrolled: 130,
          weekly_new: 20,
          weekly_cancelled: 10,
          week_label: 'Jan 13–19',
          week_start: '2025-01-13',
        }),
      ],
    }),
    by_session: [],
    by_gender: [],
    prior_years: [],
    prior_year_by_gender: [],
    phase_markers: [],
    session_gender_breakdown: [],
    cancelled_to_date: null,
    prior_year_cancelled_to_date: [],
    prior_year_session_summaries: [],
    prior_year_season_starts: {},
    daily: [],
    weekly: [],
    warnings: [],
    ...overrides,
  }
}

const defaultSessions: Array<{
  cm_id: number
  name: string
  start_date: string
  session_type: string
}> = []

const enrollmentConfig = {
  metric: 'enrollment' as const,
  splitByGender: false,
  selectedPriorYears: [] as number[],
}
const cancellationConfig = {
  metric: 'cancellation' as const,
  splitByGender: false,
  selectedPriorYears: [] as number[],
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useVelocityChartData', () => {
  // 1. Returns empty arrays when data is undefined
  describe('when data is undefined', () => {
    it('returns empty arrays and null maps', () => {
      const { result } = renderHook(() =>
        useVelocityChartData(undefined, defaultSessions, enrollmentConfig)
      )

      expect(result.current.weeklyChartData).toEqual([])
      expect(result.current.dailyChartData).toEqual([])
      expect(result.current.sortedBySession).toEqual([])
      expect(result.current.weekLabelMap.size).toBe(0)
      expect(result.current.phaseLines).toEqual([])
      expect(result.current.phaseDayOffsets).toEqual([])
      expect(result.current.dailyZoomMilestones).toEqual([])
      expect(result.current.priorSessionMap.size).toBe(0)
      expect(result.current.priorWeekMap).toBeNull()
    })
  })

  // 2. Enrollment metric: builds enrolled, gross_enrolled, weekly_new, weekly_cancelled (negated) fields
  describe('enrollment metric weeklyChartData', () => {
    it('builds enrolled, gross_enrolled, weekly_new, weekly_cancelled fields', () => {
      const data = makeResponse()
      const { result } = renderHook(() =>
        useVelocityChartData(data, defaultSessions, enrollmentConfig)
      )

      expect(result.current.weeklyChartData).toHaveLength(2)
      const row1 = result.current.weeklyChartData[0]!
      expect(row1['week_number']).toBe(1)
      expect(row1['enrolled']).toBe(100)
      expect(row1['gross_enrolled']).toBe(110)
      expect(row1['weekly_new']).toBe(15)
      // weekly_cancelled is negated
      expect(row1['weekly_cancelled']).toBe(-5)
      expect(row1['label']).toBe('Jan 6–12')
    })

    it('does NOT build a "cancelled" field', () => {
      const data = makeResponse()
      const { result } = renderHook(() =>
        useVelocityChartData(data, defaultSessions, enrollmentConfig)
      )

      const row = result.current.weeklyChartData[0]!
      expect(row).not.toHaveProperty('cancelled')
    })
  })

  // 3. Cancellation metric: builds cancelled field from backend enrolled value
  describe('cancellation metric weeklyChartData', () => {
    it('builds cancelled field from enrolled value', () => {
      const data = makeResponse()
      const { result } = renderHook(() =>
        useVelocityChartData(data, defaultSessions, cancellationConfig)
      )

      expect(result.current.weeklyChartData).toHaveLength(2)
      const row1 = result.current.weeklyChartData[0]!
      expect(row1['cancelled']).toBe(100) // mapped from enrolled
      expect(row1['week_number']).toBe(1)
    })

    it('does NOT build enrolled, gross_enrolled, weekly_new, weekly_cancelled fields', () => {
      const data = makeResponse()
      const { result } = renderHook(() =>
        useVelocityChartData(data, defaultSessions, cancellationConfig)
      )

      const row = result.current.weeklyChartData[0]!
      expect(row).not.toHaveProperty('enrolled')
      expect(row).not.toHaveProperty('gross_enrolled')
      expect(row).not.toHaveProperty('weekly_new')
      expect(row).not.toHaveProperty('weekly_cancelled')
    })
  })

  // 4. Prior year overlay fields use {field}_{year} naming pattern
  describe('prior year overlay fields', () => {
    it('enrollment metric: prior year fields use enrolled_{year} pattern', () => {
      const priorWeekly = [
        makeWeeklyPoint({
          week_number: 1,
          enrolled: 90,
          gross_enrolled: 95,
          weekly_new: 12,
          weekly_cancelled: 3,
        }),
      ]
      const data = makeResponse({
        prior_years: [{ year: 2024, daily: [], weekly: priorWeekly }],
      })
      const config = { ...enrollmentConfig, selectedPriorYears: [2024] }

      const { result } = renderHook(() => useVelocityChartData(data, defaultSessions, config))

      const row = result.current.weeklyChartData[0]!
      expect(row['enrolled_2024']).toBe(90)
      expect(row['gross_enrolled_2024']).toBe(95)
      expect(row['weekly_new_2024']).toBe(12)
      expect(row['weekly_cancelled_2024']).toBe(-3) // negated
    })

    it('cancellation metric: prior year fields use cancelled_{year} pattern', () => {
      const priorWeekly = [makeWeeklyPoint({ week_number: 1, enrolled: 25 })]
      const data = makeResponse({
        prior_years: [{ year: 2024, daily: [], weekly: priorWeekly }],
      })
      const config = { ...cancellationConfig, selectedPriorYears: [2024] }

      const { result } = renderHook(() => useVelocityChartData(data, defaultSessions, config))

      const row = result.current.weeklyChartData[0]!
      expect(row['cancelled_2024']).toBe(25) // mapped from enrolled
    })
  })

  // 5. Gender split fields use {field}_{gender} naming pattern
  describe('gender split fields', () => {
    it('enrollment metric: gender fields use enrolled_boys/enrolled_girls pattern', () => {
      const mCurve = makeVelocityCurve({
        gender: 'M',
        weekly: [
          makeWeeklyPoint({
            week_number: 1,
            enrolled: 55,
            gross_enrolled: 60,
            weekly_new: 8,
            weekly_cancelled: 2,
          }),
        ],
      })
      const fCurve = makeVelocityCurve({
        gender: 'F',
        weekly: [
          makeWeeklyPoint({
            week_number: 1,
            enrolled: 45,
            gross_enrolled: 50,
            weekly_new: 7,
            weekly_cancelled: 3,
          }),
        ],
      })
      const data = makeResponse({ by_gender: [mCurve, fCurve] })
      const config = { ...enrollmentConfig, splitByGender: true }

      const { result } = renderHook(() => useVelocityChartData(data, defaultSessions, config))

      const row = result.current.weeklyChartData[0]!
      expect(row['enrolled_boys']).toBe(55)
      expect(row['enrolled_girls']).toBe(45)
      expect(row['gross_enrolled_boys']).toBe(60)
      expect(row['gross_enrolled_girls']).toBe(50)
      expect(row['weekly_new_boys']).toBe(8)
      expect(row['weekly_new_girls']).toBe(7)
      expect(row['weekly_cancelled_boys']).toBe(-2) // negated
      expect(row['weekly_cancelled_girls']).toBe(-3) // negated
    })

    it('does not include gender fields when splitByGender is false', () => {
      const mCurve = makeVelocityCurve({
        gender: 'M',
        weekly: [makeWeeklyPoint({ week_number: 1, enrolled: 55 })],
      })
      const data = makeResponse({ by_gender: [mCurve] })
      const config = { ...enrollmentConfig, splitByGender: false }

      const { result } = renderHook(() => useVelocityChartData(data, defaultSessions, config))

      const row = result.current.weeklyChartData[0]!
      expect(row).not.toHaveProperty('enrolled_boys')
      expect(row).not.toHaveProperty('enrolled_girls')
    })
  })

  // 6. Weekly cancellation gender maps from gender curve's enrolled value
  describe('weekly cancellation gender mapping', () => {
    it('cancellation metric weekly gender: maps cancelled_boys/girls from gender curve enrolled value', () => {
      const mCurve = makeVelocityCurve({
        gender: 'M',
        weekly: [makeWeeklyPoint({ week_number: 1, enrolled: 12 })],
      })
      const fCurve = makeVelocityCurve({
        gender: 'F',
        weekly: [makeWeeklyPoint({ week_number: 1, enrolled: 8 })],
      })
      const data = makeResponse({ by_gender: [mCurve, fCurve] })
      const config = { ...cancellationConfig, splitByGender: true }

      const { result } = renderHook(() => useVelocityChartData(data, defaultSessions, config))

      const row = result.current.weeklyChartData[0]!
      expect(row['cancelled_boys']).toBe(12) // from M curve enrolled
      expect(row['cancelled_girls']).toBe(8) // from F curve enrolled
    })
  })

  // 7. weekLabelMap maps week numbers to labels
  describe('weekLabelMap', () => {
    it('maps week numbers to label strings from weeklyChartData', () => {
      const data = makeResponse()
      const { result } = renderHook(() =>
        useVelocityChartData(data, defaultSessions, enrollmentConfig)
      )

      expect(result.current.weekLabelMap.get(1)).toBe('Jan 6–12')
      expect(result.current.weekLabelMap.get(2)).toBe('Jan 13–19')
    })
  })

  // 8. phaseLines filters markers with valid week_number
  describe('phaseLines', () => {
    it('filters markers with valid week_number', () => {
      const data = makeResponse({
        phase_markers: [
          { phase: 'priority', date: '2024-10-01', label: 'Priority Reg', week_number: 5 },
          { phase: 'open', date: '2024-11-01', label: 'Open Reg', week_number: 9 },
        ],
      })

      const { result } = renderHook(() =>
        useVelocityChartData(data, defaultSessions, enrollmentConfig)
      )

      expect(result.current.phaseLines).toHaveLength(2)
      expect(result.current.phaseLines[0]).toEqual(
        expect.objectContaining({ phase: 'priority', weekNumber: 5 })
      )
    })

    it('excludes markers with null week_number', () => {
      const data = makeResponse({
        phase_markers: [
          { phase: 'priority', date: '2024-10-01', label: 'Priority Reg', week_number: 5 },
          {
            phase: 'open',
            date: '2024-11-01',
            label: 'Open Reg',
            week_number: null as unknown as number,
          },
        ],
      })

      const { result } = renderHook(() =>
        useVelocityChartData(data, defaultSessions, enrollmentConfig)
      )

      expect(result.current.phaseLines).toHaveLength(1)
    })
  })

  // 9. Daily chart data builds from data.daily with day_offset alignment
  describe('dailyChartData', () => {
    it('enrollment metric: builds enrolled, gross_enrolled from daily data', () => {
      const data = makeResponse({
        daily: [
          makeDailyPoint({ day_offset: 0, enrolled: 80, gross_enrolled: 90 }),
          makeDailyPoint({ day_offset: 1, date: '2025-01-07', enrolled: 85, gross_enrolled: 96 }),
        ],
      })

      const { result } = renderHook(() =>
        useVelocityChartData(data, defaultSessions, enrollmentConfig)
      )

      expect(result.current.dailyChartData).toHaveLength(2)
      const row0 = result.current.dailyChartData[0]!
      expect(row0['day_offset']).toBe(0)
      expect(row0['enrolled']).toBe(80)
      expect(row0['gross_enrolled']).toBe(90)
    })

    it('cancellation metric: builds cancelled from daily enrolled value', () => {
      const data = makeResponse({
        daily: [makeDailyPoint({ day_offset: 0, enrolled: 30 })],
      })

      const { result } = renderHook(() =>
        useVelocityChartData(data, defaultSessions, cancellationConfig)
      )

      const row = result.current.dailyChartData[0]!
      expect(row['cancelled']).toBe(30) // mapped from enrolled
      expect(row).not.toHaveProperty('enrolled')
      expect(row).not.toHaveProperty('gross_enrolled')
    })

    it('cancellation daily gender: maps from enrolled_boys/enrolled_girls on daily point', () => {
      const mCurve = makeVelocityCurve({
        gender: 'M',
        daily: [makeDailyPoint({ day_offset: 0, enrolled_boys: 15, enrolled: 15 })],
      })
      const fCurve = makeVelocityCurve({
        gender: 'F',
        daily: [makeDailyPoint({ day_offset: 0, enrolled_girls: 10, enrolled: 10 })],
      })
      const data = makeResponse({
        daily: [makeDailyPoint({ day_offset: 0, enrolled: 25 })],
        by_gender: [mCurve, fCurve],
      })
      const config = { ...cancellationConfig, splitByGender: true }

      const { result } = renderHook(() => useVelocityChartData(data, defaultSessions, config))

      const row = result.current.dailyChartData[0]!
      expect(row['cancelled_boys']).toBe(15) // from enrolled_boys on daily point
      expect(row['cancelled_girls']).toBe(10) // from enrolled_girls on daily point
    })

    it('enrollment daily gender: maps from enrolled on gender curve daily point', () => {
      const mCurve = makeVelocityCurve({
        gender: 'M',
        daily: [makeDailyPoint({ day_offset: 0, enrolled: 55, gross_enrolled: 60 })],
      })
      const fCurve = makeVelocityCurve({
        gender: 'F',
        daily: [makeDailyPoint({ day_offset: 0, enrolled: 45, gross_enrolled: 50 })],
      })
      const data = makeResponse({
        daily: [makeDailyPoint({ day_offset: 0, enrolled: 100, gross_enrolled: 110 })],
        by_gender: [mCurve, fCurve],
      })
      const config = { ...enrollmentConfig, splitByGender: true }

      const { result } = renderHook(() => useVelocityChartData(data, defaultSessions, config))

      const row = result.current.dailyChartData[0]!
      expect(row['enrolled_boys']).toBe(55)
      expect(row['enrolled_girls']).toBe(45)
      expect(row['gross_enrolled_boys']).toBe(60)
      expect(row['gross_enrolled_girls']).toBe(50)
    })

    it('aligns prior year daily data by day_offset', () => {
      const data = makeResponse({
        daily: [makeDailyPoint({ day_offset: 0, enrolled: 80 })],
        prior_years: [
          {
            year: 2024,
            daily: [makeDailyPoint({ day_offset: 0, enrolled: 70, gross_enrolled: 75 })],
            weekly: [],
          },
        ],
      })
      const config = { ...enrollmentConfig, selectedPriorYears: [2024] }

      const { result } = renderHook(() => useVelocityChartData(data, defaultSessions, config))

      const row = result.current.dailyChartData[0]!
      expect(row['enrolled_2024']).toBe(70)
      expect(row['gross_enrolled_2024']).toBe(75)
    })
  })

  // 10. sortedBySession returns data.by_session when no sessions provided
  describe('sortedBySession', () => {
    it('returns data.by_session when no sessions provided', () => {
      const bySession = [
        makeVelocityCurve({ session_name: 'Session 2', session_cm_id: 2 }),
        makeVelocityCurve({ session_name: 'Session 1', session_cm_id: 1 }),
      ]
      const data = makeResponse({ by_session: bySession })

      const { result } = renderHook(() => useVelocityChartData(data, [], enrollmentConfig))

      expect(result.current.sortedBySession).toEqual(bySession)
    })

    it('sorts by camp-then-quest when sessions are provided', () => {
      const bySession = [
        makeVelocityCurve({ session_name: 'Quest 1', session_cm_id: 3 }),
        makeVelocityCurve({ session_name: 'Session 1', session_cm_id: 1 }),
      ]
      const sessions = [
        { cm_id: 1, name: 'Session 1', start_date: '2025-06-15', session_type: 'main' },
        { cm_id: 3, name: 'Quest 1', start_date: '2025-06-20', session_type: 'quest' },
      ]
      const data = makeResponse({ by_session: bySession })

      const { result } = renderHook(() => useVelocityChartData(data, sessions, enrollmentConfig))

      // Camp sessions first, then quest
      expect(result.current.sortedBySession[0]?.session_name).toBe('Session 1')
      expect(result.current.sortedBySession[1]?.session_name).toBe('Quest 1')
    })
  })

  // Additional: phaseDayOffsets
  describe('phaseDayOffsets', () => {
    it('converts phase marker dates to day offsets from season start', () => {
      const data = makeResponse({
        season_start: '2024-09-01',
        phase_markers: [
          { phase: 'priority', date: '2024-09-08', label: 'Priority', week_number: 2 },
        ],
      })

      const { result } = renderHook(() =>
        useVelocityChartData(data, defaultSessions, enrollmentConfig)
      )

      expect(result.current.phaseDayOffsets).toHaveLength(1)
      expect(result.current.phaseDayOffsets[0]).toEqual({
        phase: 'priority',
        label: 'Priority',
        dayOffset: 7,
      })
    })
  })

  // Additional: dailyTickFormatter
  describe('dailyTickFormatter', () => {
    it('formats day offset to date label using season_start', () => {
      const data = makeResponse({ season_start: '2024-09-01' })

      const { result } = renderHook(() =>
        useVelocityChartData(data, defaultSessions, enrollmentConfig)
      )

      // Day 0 = Sep 1
      const label = result.current.dailyTickFormatter(0)
      expect(label).toBe('Sep 1')
    })

    it('returns empty string when season_start is missing', () => {
      const data = makeResponse({ season_start: '' })

      const { result } = renderHook(() =>
        useVelocityChartData(data, defaultSessions, enrollmentConfig)
      )

      expect(result.current.dailyTickFormatter(0)).toBe('')
    })
  })

  // Additional: dailyZoomMilestones
  describe('dailyZoomMilestones', () => {
    it('builds milestone every 7 days', () => {
      const daily = [
        makeDailyPoint({ day_offset: 0, date: '2024-09-01' }),
        makeDailyPoint({ day_offset: 7, date: '2024-09-08' }),
        makeDailyPoint({ day_offset: 14, date: '2024-09-15' }),
      ]
      const data = makeResponse({ daily })

      const { result } = renderHook(() =>
        useVelocityChartData(data, defaultSessions, enrollmentConfig)
      )

      // 3 milestones at offsets 0, 7, 14 — last is at index 2 which IS the last point
      // so "Latest" is not added
      expect(result.current.dailyZoomMilestones.length).toBeGreaterThanOrEqual(3)
      expect(result.current.dailyZoomMilestones[0]?.label).toContain('Wk 1')
    })

    it('includes Latest milestone when last point is not at a 7-day boundary', () => {
      const daily = [
        makeDailyPoint({ day_offset: 0, date: '2024-09-01' }),
        makeDailyPoint({ day_offset: 3, date: '2024-09-04' }),
      ]
      const data = makeResponse({ daily })

      const { result } = renderHook(() =>
        useVelocityChartData(data, defaultSessions, enrollmentConfig)
      )

      const labels = result.current.dailyZoomMilestones.map((m) => m.label)
      expect(labels.some((l) => l.startsWith('Latest'))).toBe(true)
    })
  })

  // Additional: priorSessionMap
  describe('priorSessionMap', () => {
    it('maps canonical session names to prior year summaries', () => {
      const data = makeResponse({
        prior_year_session_summaries: [
          {
            year: 2024,
            session_name: 'Session 1',
            session_cm_id: 1,
            enrolled_at_current_week: 80,
            final_enrolled: 95,
          },
        ],
      })

      const { result } = renderHook(() =>
        useVelocityChartData(data, defaultSessions, enrollmentConfig)
      )

      const entry = result.current.priorSessionMap.get('Session 1')
      expect(entry).toEqual({
        enrolled_at_current_week: 80,
        final_enrolled: 95,
        year: 2024,
      })
    })

    it('resolves session aliases to canonical names', () => {
      // 'Taste of Camp' is aliased to 'Taste of Camp 1' in sessionAliases
      const data = makeResponse({
        prior_year_session_summaries: [
          {
            year: 2024,
            session_name: 'Taste of Camp',
            session_cm_id: 99,
            enrolled_at_current_week: 50,
            final_enrolled: 60,
          },
        ],
      })

      const { result } = renderHook(() =>
        useVelocityChartData(data, defaultSessions, enrollmentConfig)
      )

      // Should be under canonical name 'Taste of Camp 1'
      expect(result.current.priorSessionMap.has('Taste of Camp 1')).toBe(true)
      expect(result.current.priorSessionMap.has('Taste of Camp')).toBe(false)
    })
  })

  // Additional: priorWeekMap
  describe('priorWeekMap', () => {
    it('maps week_number to prior year weekly data for first prior year', () => {
      const priorWeekly = [
        makeWeeklyPoint({ week_number: 1, enrolled: 90 }),
        makeWeeklyPoint({ week_number: 2, enrolled: 100 }),
      ]
      const data = makeResponse({
        prior_years: [{ year: 2024, daily: [], weekly: priorWeekly }],
      })

      const { result } = renderHook(() =>
        useVelocityChartData(data, defaultSessions, enrollmentConfig)
      )

      expect(result.current.priorWeekMap).not.toBeNull()
      expect(result.current.priorWeekMap!.get(1)?.enrolled).toBe(90)
      expect(result.current.priorWeekMap!.get(2)?.enrolled).toBe(100)
    })

    it('returns null when no prior years', () => {
      const data = makeResponse({ prior_years: [] })

      const { result } = renderHook(() =>
        useVelocityChartData(data, defaultSessions, enrollmentConfig)
      )

      expect(result.current.priorWeekMap).toBeNull()
    })
  })

  // Week alignment: prior year week numbers not in current year are included
  describe('week alignment across years', () => {
    it('includes weeks from prior year even when current year lacks them', () => {
      const data = makeResponse({
        combined: makeVelocityCurve({
          weekly: [makeWeeklyPoint({ week_number: 1 })],
        }),
        prior_years: [
          {
            year: 2024,
            daily: [],
            weekly: [
              makeWeeklyPoint({ week_number: 1, enrolled: 90 }),
              makeWeeklyPoint({ week_number: 3, enrolled: 110, week_label: 'Jan 20–26' }),
            ],
          },
        ],
      })

      const { result } = renderHook(() =>
        useVelocityChartData(data, defaultSessions, enrollmentConfig)
      )

      // Should have 3 rows: weeks 1, 2, 3 (week 2 from current, week 3 from prior)
      const weekNumbers = result.current.weeklyChartData.map((r) => r['week_number'])
      expect(weekNumbers).toContain(1)
      expect(weekNumbers).toContain(3)
    })
  })

  // Prior year gender fields in cancellation metric (weekly)
  describe('prior year gender in cancellation weekly', () => {
    it('maps prior year gender cancelled_boys/girls from enrolled', () => {
      const priorMCurve = makeVelocityCurve({
        year: 2024,
        gender: 'M',
        weekly: [makeWeeklyPoint({ week_number: 1, enrolled: 7 })],
      })
      const priorFCurve = makeVelocityCurve({
        year: 2024,
        gender: 'F',
        weekly: [makeWeeklyPoint({ week_number: 1, enrolled: 5 })],
      })
      const data = makeResponse({
        prior_years: [
          { year: 2024, daily: [], weekly: [makeWeeklyPoint({ week_number: 1, enrolled: 12 })] },
        ],
        prior_year_by_gender: [priorMCurve, priorFCurve],
      })
      const config = { ...cancellationConfig, splitByGender: true }

      const { result } = renderHook(() => useVelocityChartData(data, defaultSessions, config))

      const row = result.current.weeklyChartData[0]!
      expect(row['cancelled_boys_2024']).toBe(7)
      expect(row['cancelled_girls_2024']).toBe(5)
    })
  })
})
