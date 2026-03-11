import { describe, it, expect } from 'vitest'

import { parseIssueMessage, getIssueTypeLabel } from './PostValidationResultsModal'

describe('parseIssueMessage', () => {
  it('handles campers_with_unsatisfied_valid_requests message', () => {
    const issue = {
      type: 'campers_with_unsatisfied_valid_requests',
      severity: 'warning',
      message: '8 campers have valid requests but NONE are satisfied',
      details: {
        count: 8,
        total_valid_requests: 20,
        total_satisfied: 0,
        explicit_unsatisfied_count: 3,
      },
    }
    const parsed = parseIssueMessage(issue)
    expect(parsed.primary).toBe('8 campers')
    expect(parsed.badge).toBe('0 satisfied')
    expect(parsed.badgeColor).toBe('red')
  })

  it('handles singular camper in unsatisfied valid requests', () => {
    const issue = {
      type: 'campers_with_unsatisfied_valid_requests',
      severity: 'warning',
      message: '1 campers have valid requests but NONE are satisfied',
      details: { count: 1 },
    }
    const parsed = parseIssueMessage(issue)
    expect(parsed.primary).toBe('1 camper')
    expect(parsed.badge).toBe('0 satisfied')
  })

  it('does not truncate messages under 40 chars in fallback', () => {
    const issue = {
      type: 'unknown_type',
      severity: 'info',
      message: 'Short message here',
    }
    const parsed = parseIssueMessage(issue)
    expect(parsed.primary).toBe('Short message here')
  })

  it('truncates long fallback messages at 40 chars', () => {
    const issue = {
      type: 'unknown_type',
      severity: 'info',
      message: 'This is a very long message that should definitely be truncated by the fallback',
    }
    const parsed = parseIssueMessage(issue)
    expect(parsed.primary.length).toBeLessThanOrEqual(40)
    expect(parsed.primary).toContain('...')
  })
})

describe('getIssueTypeLabel', () => {
  it('returns label for campers_with_unsatisfied_valid_requests', () => {
    expect(getIssueTypeLabel('campers_with_unsatisfied_valid_requests')).toBe(
      'Unsatisfied Requests'
    )
  })

  it('returns label for known types', () => {
    expect(getIssueTypeLabel('unsatisfied_request')).toBe('Unfulfilled Requests')
    expect(getIssueTypeLabel('capacity_exceeded')).toBe('Over Capacity')
  })

  it('falls back to title case for unknown types', () => {
    expect(getIssueTypeLabel('some_unknown_type')).toBe('Some Unknown Type')
  })
})
