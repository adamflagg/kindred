/**
 * TDD tests for validationIssueFormatter — Issue #1481 Item 1
 * RED PHASE: written before implementation.
 */

import { describe, it, expect } from 'vitest'
import { formatBunkIssueDetail } from './validationIssueFormatter'
import type { PostCheckIssue } from '../components/issueClassifier'

// Helper to build a minimal PostCheckIssue
function issue(type: string, message: string, details?: Record<string, unknown>): PostCheckIssue {
  const base: PostCheckIssue = { type, severity: 'warning', message }
  if (details !== undefined) base.details = details
  return base
}

describe('formatBunkIssueDetail — capacity_violation', () => {
  it('returns capacity detail with assigned and max', () => {
    const result = formatBunkIssueDetail(
      issue('capacity_violation', 'Bunk Pine 3 is over capacity (9/8)', {
        bunk_name: 'Pine 3',
        assigned: 9,
        max_size: 8,
      })
    )
    expect(result).toContain('9')
    expect(result).toContain('8')
    expect(result).toMatch(/over|capacity/i)
  })

  it('shows how many over capacity', () => {
    const result = formatBunkIssueDetail(
      issue('capacity_violation', 'Bunk Pine 3 is over capacity (9/8)', {
        bunk_name: 'Pine 3',
        assigned: 9,
        max_size: 8,
      })
    )
    // Should convey "1 over" or similar
    expect(result).toMatch(/1\s*over|over.*1/i)
  })
})

describe('formatBunkIssueDetail — age_spread_warning', () => {
  it('returns age spread with months and limit', () => {
    const result = formatBunkIssueDetail(
      issue('age_spread_warning', 'Bunk Oak 2 has excessive age spread (26.0 months)', {
        bunk_name: 'Oak 2',
        age_spread_months: 26,
        max_allowed: 24,
      })
    )
    expect(result).toContain('26')
    expect(result).toContain('24')
    expect(result).toMatch(/month/i)
  })
})

describe('formatBunkIssueDetail — grade_spread_warning', () => {
  it('returns grade spread with unique grades count and limit', () => {
    const result = formatBunkIssueDetail(
      issue(
        'grade_spread_warning',
        'Bunk Maple 1 has too many different grades (3 grades, max allowed: 2)',
        {
          bunk_name: 'Maple 1',
          unique_grades: 3,
          grades: [4, 5, 6],
          max_allowed: 2,
        }
      )
    )
    expect(result).toContain('3')
    expect(result).toContain('2')
    expect(result).toMatch(/grade/i)
  })
})

describe('formatBunkIssueDetail — grade_ratio_warning', () => {
  it('returns grade ratio with count and percentage', () => {
    const result = formatBunkIssueDetail(
      issue(
        'grade_ratio_warning',
        'Bunk Pine 3 has 75.0% of campers from grade 5 (exceeds 67% limit)',
        {
          bunk_name: 'Pine 3',
          grade: 5,
          count: 6,
          total: 8,
          percentage: 75.0,
          max_allowed: 67,
          all_grades: { '5': 6, '4': 2 },
        }
      )
    )
    expect(result).toContain('75')
    expect(result).toContain('6')
    expect(result).toContain('8')
  })
})

describe('formatBunkIssueDetail — grade_adjacency_warning', () => {
  it('returns missing grades info', () => {
    const result = formatBunkIssueDetail(
      issue(
        'grade_adjacency_warning',
        'Bunk Maple 1 has non-adjacent grades [4, 6] (missing grade 5)',
        {
          bunk_name: 'Maple 1',
          grades_present: [4, 6],
          missing_grades: [5],
          gap: 1,
        }
      )
    )
    // Should reference the present grades [4, 6] and missing grade 5
    expect(result).toMatch(/4.*6|6.*4/i)
    expect(result).toContain('5')
  })
})

describe('formatBunkIssueDetail — age_flow_inversion', () => {
  it('returns avg age comparison between bunks', () => {
    const result = formatBunkIssueDetail(
      issue(
        'age_flow_inversion',
        'Riverside (avg age 12.5) has older campers than Hillcrest (avg age 11.2)',
        {
          bunk_name: 'Riverside',
          lower_bunk: 'Riverside',
          lower_avg_age: 12.5,
          higher_bunk: 'Hillcrest',
          higher_avg_age: 11.2,
          gender: 'Boys',
        }
      )
    )
    expect(result).toMatch(/12\.5|12,5/i)
    expect(result).toMatch(/11\.2|11,2/i)
    expect(result).toContain('Hillcrest')
  })
})

describe('formatBunkIssueDetail — isolation_risk', () => {
  it('returns group size and isolated camper count', () => {
    const result = formatBunkIssueDetail(
      issue('isolation_risk', 'Pine 3 has 5 connected friends + 2 isolated camper(s)', {
        bunk_name: 'Pine 3',
        group_size: 5,
        isolated_campers: [
          { cm_id: 1, name: 'Emma Johnson' },
          { cm_id: 2, name: 'Liam Garcia' },
        ],
      })
    )
    expect(result).toContain('5')
    expect(result).toContain('2')
    expect(result).toMatch(/isolat/i)
  })
})

describe('formatBunkIssueDetail — fallback', () => {
  it('returns issue.message when details is missing', () => {
    const msg = 'Bunk Pine 3 has some unknown problem'
    const result = formatBunkIssueDetail(issue('capacity_violation', msg))
    expect(result).toBe(msg)
  })

  it('returns issue.message for unknown type with details', () => {
    const msg = 'Unknown bunk issue occurred'
    const result = formatBunkIssueDetail(
      issue('unknown_type', msg, { bunk_name: 'Pine 3', some: 'data' })
    )
    expect(result).toBe(msg)
  })
})
