import { describe, it, expect } from 'vitest'
import {
  genderToBarData,
  gradeToBarData,
  sessionToBarData,
  cityToBarData,
  schoolToBarData,
  synagogueToBarData,
  yearsAtCampToBarData,
  summerYearsToBarData,
  firstSummerYearToBarData,
  sessionBunkToBarData,
  priorSessionToBarData,
} from '../retentionTransforms'
import type {
  RetentionByGender,
  RetentionByGrade,
  RetentionBySession,
  RetentionByCity,
  RetentionBySchool,
  RetentionBySynagogue,
  RetentionByYearsAtCamp,
  RetentionBySummerYears,
  RetentionByFirstSummerYear,
  RetentionBySessionBunk,
  RetentionByPriorSession,
} from '../../types/metrics'

describe('genderToBarData', () => {
  it('maps gender breakdown to bar data', () => {
    const input: RetentionByGender[] = [
      { gender: 'M', base_count: 100, returned_count: 70, retention_rate: 0.7 },
      { gender: 'F', base_count: 90, returned_count: 60, retention_rate: 0.667 },
    ]
    const result = genderToBarData(input)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      name: 'M',
      retentionRate: 0.7,
      baseCount: 100,
      returnedCount: 70,
    })
  })

  it('returns empty array for empty input', () => {
    expect(genderToBarData([])).toEqual([])
  })

  it('returns empty array for undefined input', () => {
    expect(genderToBarData(undefined)).toEqual([])
  })
})

describe('gradeToBarData', () => {
  it('maps grade breakdown to bar data with "Grade X" labels', () => {
    const input: RetentionByGrade[] = [
      { grade: 3, base_count: 50, returned_count: 35, retention_rate: 0.7 },
      { grade: null, base_count: 10, returned_count: 5, retention_rate: 0.5 },
    ]
    const result = gradeToBarData(input)
    expect(result[0]!.name).toBe('Grade 3')
    expect(result[1]!.name).toBe('Unknown')
  })

  it('returns empty array for undefined', () => {
    expect(gradeToBarData(undefined)).toEqual([])
  })
})

describe('sessionToBarData', () => {
  it('maps session breakdown to bar data', () => {
    const input: RetentionBySession[] = [
      { session_cm_id: 1001, session_name: 'Session 1', base_count: 80, returned_count: 60, retention_rate: 0.75 },
    ]
    const result = sessionToBarData(input)
    expect(result[0]).toEqual({
      name: 'Session 1',
      retentionRate: 0.75,
      baseCount: 80,
      returnedCount: 60,
    })
  })

  it('returns empty array for undefined', () => {
    expect(sessionToBarData(undefined)).toEqual([])
  })
})

describe('cityToBarData', () => {
  it('maps city breakdown to bar data', () => {
    const input: RetentionByCity[] = [
      { city: 'Riverside', base_count: 40, returned_count: 30, retention_rate: 0.75 },
    ]
    const result = cityToBarData(input)
    expect(result[0]!.name).toBe('Riverside')
    expect(result[0]!.retentionRate).toBe(0.75)
  })

  it('returns empty array for undefined', () => {
    expect(cityToBarData(undefined)).toEqual([])
  })
})

describe('schoolToBarData', () => {
  it('maps school breakdown to bar data', () => {
    const input: RetentionBySchool[] = [
      { school: 'Riverside Elementary', base_count: 30, returned_count: 20, retention_rate: 0.667 },
    ]
    const result = schoolToBarData(input)
    expect(result[0]!.name).toBe('Riverside Elementary')
  })

  it('returns empty array for undefined', () => {
    expect(schoolToBarData(undefined)).toEqual([])
  })
})

describe('synagogueToBarData', () => {
  it('maps synagogue breakdown to bar data', () => {
    const input: RetentionBySynagogue[] = [
      { synagogue: 'Temple Oak', base_count: 20, returned_count: 15, retention_rate: 0.75 },
    ]
    const result = synagogueToBarData(input)
    expect(result[0]!.name).toBe('Temple Oak')
  })

  it('returns empty array for undefined', () => {
    expect(synagogueToBarData(undefined)).toEqual([])
  })
})

describe('yearsAtCampToBarData', () => {
  it('maps years at camp breakdown with "X years" labels', () => {
    const input: RetentionByYearsAtCamp[] = [
      { years: 1, base_count: 100, returned_count: 60, retention_rate: 0.6 },
      { years: 3, base_count: 50, returned_count: 40, retention_rate: 0.8 },
    ]
    const result = yearsAtCampToBarData(input)
    expect(result[0]!.name).toBe('1 year')
    expect(result[1]!.name).toBe('3 years')
  })

  it('returns empty array for undefined', () => {
    expect(yearsAtCampToBarData(undefined)).toEqual([])
  })
})

describe('summerYearsToBarData', () => {
  it('maps summer years breakdown with "X summers" labels', () => {
    const input: RetentionBySummerYears[] = [
      { summer_years: 1, base_count: 80, returned_count: 50, retention_rate: 0.625 },
      { summer_years: 4, base_count: 30, returned_count: 25, retention_rate: 0.833 },
    ]
    const result = summerYearsToBarData(input)
    expect(result[0]!.name).toBe('1 summer')
    expect(result[1]!.name).toBe('4 summers')
  })

  it('returns empty array for undefined', () => {
    expect(summerYearsToBarData(undefined)).toEqual([])
  })
})

describe('firstSummerYearToBarData', () => {
  it('maps first summer year to bar data with year as name', () => {
    const input: RetentionByFirstSummerYear[] = [
      { first_summer_year: 2020, base_count: 40, returned_count: 30, retention_rate: 0.75 },
    ]
    const result = firstSummerYearToBarData(input)
    expect(result[0]!.name).toBe('2020')
    expect(result[0]!.retentionRate).toBe(0.75)
  })

  it('returns empty array for undefined', () => {
    expect(firstSummerYearToBarData(undefined)).toEqual([])
  })
})

describe('sessionBunkToBarData', () => {
  it('maps session+bunk breakdown to bar data', () => {
    const input: RetentionBySessionBunk[] = [
      { session: 'Session 1', bunk: 'B-1', base_count: 12, returned_count: 9, retention_rate: 0.75 },
    ]
    const result = sessionBunkToBarData(input)
    expect(result[0]!.name).toBe('Session 1 / B-1')
  })

  it('returns empty array for undefined', () => {
    expect(sessionBunkToBarData(undefined)).toEqual([])
  })
})

describe('priorSessionToBarData', () => {
  it('maps prior session breakdown to bar data', () => {
    const input: RetentionByPriorSession[] = [
      { prior_session: 'Session 2', base_count: 60, returned_count: 45, retention_rate: 0.75 },
    ]
    const result = priorSessionToBarData(input)
    expect(result[0]!.name).toBe('Session 2')
  })

  it('returns empty array for undefined', () => {
    expect(priorSessionToBarData(undefined)).toEqual([])
  })
})
