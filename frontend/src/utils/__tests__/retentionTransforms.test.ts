import { describe, it, expect } from 'vitest'
import {
  genderToBarData,
  getGenderDisplayName,
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
  sortRetentionBarData,
  sessionFlowToSankeyData,
} from '../retentionTransforms'
import type { RetentionRateBarItem } from '../../components/metrics/RetentionRateBarChart'
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
  SessionFlowItem,
} from '../../types/metrics'

describe('getGenderDisplayName', () => {
  it('maps M to Male', () => {
    expect(getGenderDisplayName('M')).toBe('Male')
  })

  it('maps F to Female', () => {
    expect(getGenderDisplayName('F')).toBe('Female')
  })

  it('passes through unknown values unchanged', () => {
    expect(getGenderDisplayName('NB')).toBe('NB')
    expect(getGenderDisplayName('Other')).toBe('Other')
    expect(getGenderDisplayName('Unknown')).toBe('Unknown')
  })

  it('handles empty string', () => {
    expect(getGenderDisplayName('')).toBe('')
  })
})

describe('genderToBarData', () => {
  it('maps gender breakdown to bar data with display names', () => {
    const input: RetentionByGender[] = [
      { gender: 'M', base_count: 100, returned_count: 70, retention_rate: 0.7 },
      { gender: 'F', base_count: 90, returned_count: 60, retention_rate: 0.667 },
    ]
    const result = genderToBarData(input)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      name: 'Male',
      retentionRate: 0.7,
      baseCount: 100,
      returnedCount: 70,
      id: 'M',
    })
    expect(result[1]).toEqual({
      name: 'Female',
      retentionRate: 0.667,
      baseCount: 90,
      returnedCount: 60,
      id: 'F',
    })
  })

  it('preserves raw gender value as id for API filtering', () => {
    const input: RetentionByGender[] = [
      { gender: 'F', base_count: 50, returned_count: 30, retention_rate: 0.6 },
    ]
    const result = genderToBarData(input)
    expect(result[0]!.id).toBe('F')
    expect(result[0]!.name).toBe('Female')
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
    expect(result[0]!.name).toBe('3')
    expect(result[1]!.name).toBe('Unknown')
  })

  it('returns empty array for undefined', () => {
    expect(gradeToBarData(undefined)).toEqual([])
  })
})

describe('sessionToBarData', () => {
  it('maps session breakdown to bar data', () => {
    const input: RetentionBySession[] = [
      {
        session_cm_id: 1001,
        session_name: 'Session 1',
        base_count: 80,
        returned_count: 60,
        retention_rate: 0.75,
      },
    ]
    const result = sessionToBarData(input)
    expect(result[0]).toEqual({
      name: 'Session 1',
      retentionRate: 0.75,
      baseCount: 80,
      returnedCount: 60,
      id: 1001,
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
      {
        session: 'Session 1',
        bunk: 'B-1',
        base_count: 12,
        returned_count: 9,
        retention_rate: 0.75,
      },
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

describe('sortRetentionBarData', () => {
  const unsortedData: RetentionRateBarItem[] = [
    { name: '3 years', retentionRate: 0.9, baseCount: 30, returnedCount: 27 },
    { name: '1 year', retentionRate: 0.5, baseCount: 100, returnedCount: 50 },
    { name: '10 years', retentionRate: 0.8, baseCount: 10, returnedCount: 8 },
    { name: '2 years', retentionRate: 0.7, baseCount: 60, returnedCount: 42 },
  ]

  it('sorts by name using natural/numeric order', () => {
    const result = sortRetentionBarData(unsortedData, 'name')
    expect(result.map((d) => d.name)).toEqual(['1 year', '2 years', '3 years', '10 years'])
  })

  it('sorts by retention rate descending', () => {
    const result = sortRetentionBarData(unsortedData, 'rate')
    expect(result.map((d) => d.name)).toEqual(['3 years', '10 years', '2 years', '1 year'])
  })

  it('sorts by base count descending', () => {
    const result = sortRetentionBarData(unsortedData, 'count')
    expect(result.map((d) => d.name)).toEqual(['1 year', '2 years', '3 years', '10 years'])
  })

  it('defaults to rate sort', () => {
    const result = sortRetentionBarData(unsortedData)
    expect(result.map((d) => d.name)).toEqual(['3 years', '10 years', '2 years', '1 year'])
  })

  it('applies topN after sorting', () => {
    const result = sortRetentionBarData(unsortedData, 'name', 2)
    expect(result).toHaveLength(2)
    expect(result.map((d) => d.name)).toEqual(['1 year', '2 years'])
  })

  it('handles grade labels naturally', () => {
    const gradeData: RetentionRateBarItem[] = [
      { name: '9', retentionRate: 0.6, baseCount: 40, returnedCount: 24 },
      { name: '3', retentionRate: 0.8, baseCount: 50, returnedCount: 40 },
      { name: '12', retentionRate: 0.5, baseCount: 30, returnedCount: 15 },
      { name: 'Unknown', retentionRate: 0.3, baseCount: 10, returnedCount: 3 },
    ]
    const result = sortRetentionBarData(gradeData, 'name')
    expect(result.map((d) => d.name)).toEqual(['3', '9', '12', 'Unknown'])
  })

  it('handles year labels naturally', () => {
    const yearData: RetentionRateBarItem[] = [
      { name: '2023', retentionRate: 0.7, baseCount: 50, returnedCount: 35 },
      { name: '2019', retentionRate: 0.6, baseCount: 40, returnedCount: 24 },
      { name: '2021', retentionRate: 0.8, baseCount: 60, returnedCount: 48 },
    ]
    const result = sortRetentionBarData(yearData, 'name')
    expect(result.map((d) => d.name)).toEqual(['2019', '2021', '2023'])
  })

  it('returns empty array for empty input', () => {
    expect(sortRetentionBarData([], 'name')).toEqual([])
  })

  it('does not mutate the original array', () => {
    const original = [...unsortedData]
    sortRetentionBarData(unsortedData, 'name')
    expect(unsortedData).toEqual(original)
  })

  it('preserves input order when sortBy is "none"', () => {
    const result = sortRetentionBarData(unsortedData, 'none')
    expect(result.map((d) => d.name)).toEqual(['3 years', '1 year', '10 years', '2 years'])
  })

  it('applies topN without sorting when sortBy is "none"', () => {
    const result = sortRetentionBarData(unsortedData, 'none', 2)
    expect(result).toHaveLength(2)
    expect(result.map((d) => d.name)).toEqual(['3 years', '1 year'])
  })
})

describe('sessionFlowToSankeyData', () => {
  it('returns null for undefined input', () => {
    expect(sessionFlowToSankeyData(undefined)).toBeNull()
  })

  it('returns null for empty array', () => {
    expect(sessionFlowToSankeyData([])).toBeNull()
  })

  it('converts flow items to Sankey nodes and links', () => {
    const input: SessionFlowItem[] = [
      {
        source: 'Session 1',
        target: 'Session 1',
        value: 50,
        source_cm_id: 1000,
        target_cm_id: 1000,
      },
      {
        source: 'Session 1',
        target: 'Session 2',
        value: 20,
        source_cm_id: 1000,
        target_cm_id: 1001,
      },
      {
        source: 'Session 2',
        target: 'Session 1',
        value: 30,
        source_cm_id: 1001,
        target_cm_id: 1000,
      },
    ]
    const result = sessionFlowToSankeyData(input)
    expect(result).not.toBeNull()

    // 2 source nodes (Session 1, Session 2) + 2 target nodes (Session 1, Session 2)
    expect(result!.nodes).toHaveLength(4)
    expect(result!.links).toHaveLength(3)

    // Verify node names include year-side disambiguation
    const nodeNames = result!.nodes.map((n) => n.name)
    expect(nodeNames).toContain('Session 1 (from)')
    expect(nodeNames).toContain('Session 2 (from)')
    expect(nodeNames).toContain('Session 1 (to)')
    expect(nodeNames).toContain('Session 2 (to)')

    // Verify link values
    const linkValues = result!.links.map((l) => l.value)
    expect(linkValues).toContain(50)
    expect(linkValues).toContain(20)
    expect(linkValues).toContain(30)
  })

  it('propagates cmId from flow items to nodes', () => {
    const input: SessionFlowItem[] = [
      {
        source: 'Session 1',
        target: 'Session 1',
        value: 50,
        source_cm_id: 1000,
        target_cm_id: 1000,
      },
      {
        source: 'Session 1',
        target: 'Session 2',
        value: 20,
        source_cm_id: 1000,
        target_cm_id: 1001,
      },
      {
        source: 'Session 2',
        target: 'Session 1',
        value: 30,
        source_cm_id: 1001,
        target_cm_id: 1000,
      },
    ]
    const result = sessionFlowToSankeyData(input)
    expect(result).not.toBeNull()

    // Source nodes should have cmId from source_cm_id
    const s1From = result!.nodes.find((n) => n.name === 'Session 1 (from)')
    expect(s1From!.cmId).toBe(1000)
    const s2From = result!.nodes.find((n) => n.name === 'Session 2 (from)')
    expect(s2From!.cmId).toBe(1001)

    // Target nodes should have cmId from target_cm_id
    const s1To = result!.nodes.find((n) => n.name === 'Session 1 (to)')
    expect(s1To!.cmId).toBe(1000)
    const s2To = result!.nodes.find((n) => n.name === 'Session 2 (to)')
    expect(s2To!.cmId).toBe(1001)
  })

  it('matching cm_ids across source and target produce same cmId on nodes', () => {
    const input: SessionFlowItem[] = [
      {
        source: 'Session 1',
        target: 'Session 1',
        value: 50,
        source_cm_id: 1000,
        target_cm_id: 1000,
      },
    ]
    const result = sessionFlowToSankeyData(input)
    expect(result).not.toBeNull()

    const sourceNode = result!.nodes.find((n) => n.name === 'Session 1 (from)')
    const targetNode = result!.nodes.find((n) => n.name === 'Session 1 (to)')
    expect(sourceNode!.cmId).toBe(targetNode!.cmId)
  })

  it('source nodes come before target nodes', () => {
    const input: SessionFlowItem[] = [
      {
        source: 'Session 1',
        target: 'Session 2',
        value: 10,
        source_cm_id: 1000,
        target_cm_id: 1001,
      },
    ]
    const result = sessionFlowToSankeyData(input)
    expect(result).not.toBeNull()

    // Source node should be index 0, target node should be index 1
    expect(result!.nodes[0]!.name).toBe('Session 1 (from)')
    expect(result!.nodes[1]!.name).toBe('Session 2 (to)')

    // Link should reference these indices
    expect(result!.links[0]).toEqual({ source: 0, target: 1, value: 10 })
  })

  it('Did Not Return node has cmId null', () => {
    const input: SessionFlowItem[] = [
      {
        source: 'Session 1',
        target: 'Did Not Return',
        value: 40,
        source_cm_id: 1000,
        target_cm_id: null,
      },
      {
        source: 'Session 1',
        target: 'Session 1',
        value: 60,
        source_cm_id: 1000,
        target_cm_id: 1000,
      },
    ]
    const result = sessionFlowToSankeyData(input)
    expect(result).not.toBeNull()

    // "Did Not Return" should appear as a target node (no disambiguation suffix)
    const nodeNames = result!.nodes.map((n) => n.name)
    expect(nodeNames).toContain('Did Not Return')

    // "Did Not Return" node should have cmId null
    const dnrNode = result!.nodes.find((n) => n.name === 'Did Not Return')
    expect(dnrNode!.cmId).toBeNull()

    // It should be after source nodes
    const dnrIndex = result!.nodes.findIndex((n) => n.name === 'Did Not Return')
    const sourceCount = input.reduce((acc, f) => {
      acc.add(f.source)
      return acc
    }, new Set<string>()).size
    expect(dnrIndex).toBeGreaterThanOrEqual(sourceCount)
  })
})
