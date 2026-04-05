/**
 * Tests for shared disposition/status/confidence badge color utility.
 *
 * Follows the pattern of sourceFieldColors.test.ts.
 */
import { describe, it, expect } from 'vitest'
import {
  getDispositionClasses,
  getStatusClasses,
  getConfidenceClasses,
  getDispositionSortRank,
  formatDispositionReason,
  RESOLVED_REASONS,
  PENDING_REASONS,
  DECLINED_REASONS,
  CONFIDENCE_RESOLVED,
  CONFIDENCE_WARNING,
  CONFIDENCE_AUTO_ACCEPT,
} from './dispositionColors'

describe('getDispositionClasses', () => {
  it.each([
    ['exact_match', 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'],
    [
      'reciprocal_match',
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
    ],
    ['needs_review', 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'],
    ['target_waitlisted', 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'],
    ['session_mismatch', 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400'],
    ['target_not_attending', 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400'],
    ['requester_not_attending', 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400'],
  ])('returns correct classes for %s', (reason, expected) => {
    expect(getDispositionClasses(reason)).toBe(expected)
  })

  it('returns neutral classes for unknown reasons', () => {
    expect(getDispositionClasses('some_unknown_reason')).toBe(
      'bg-bark-100 text-bark-600 dark:bg-bark-700 dark:text-bark-300'
    )
  })
})

describe('getStatusClasses', () => {
  it.each([
    ['RESOLVED', 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'],
    ['PENDING', 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'],
    ['DECLINED', 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400'],
  ])('returns correct classes for %s', (status, expected) => {
    expect(getStatusClasses(status)).toBe(expected)
  })

  it('handles lowercase input', () => {
    expect(getStatusClasses('resolved')).toBe(
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
    )
  })

  it('returns neutral classes for unknown status', () => {
    expect(getStatusClasses('unknown')).toBe(
      'bg-bark-100 text-bark-600 dark:bg-bark-700 dark:text-bark-300'
    )
  })
})

describe('getConfidenceClasses', () => {
  it('returns success for >= 0.85', () => {
    expect(getConfidenceClasses(0.85)).toBe(
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
    )
    expect(getConfidenceClasses(0.99)).toBe(
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
    )
  })

  it('returns warning for >= 0.7 and < 0.85', () => {
    expect(getConfidenceClasses(0.7)).toBe(
      'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
    )
    expect(getConfidenceClasses(0.84)).toBe(
      'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
    )
  })

  it('returns danger for < 0.7', () => {
    expect(getConfidenceClasses(0.69)).toBe(
      'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400'
    )
    expect(getConfidenceClasses(0)).toBe(
      'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400'
    )
  })
})

describe('reason sets', () => {
  it('RESOLVED_REASONS contains expected values', () => {
    expect(RESOLVED_REASONS.has('exact_match')).toBe(true)
    expect(RESOLVED_REASONS.has('reciprocal_match')).toBe(true)
    expect(RESOLVED_REASONS.has('high_confidence_match')).toBe(true)
    expect(RESOLVED_REASONS.has('auto_resolved')).toBe(true)
    expect(RESOLVED_REASONS.has('cross_session_satisfied')).toBe(true)
    expect(RESOLVED_REASONS.has('directional_preference')).toBe(true)
  })

  it('PENDING_REASONS contains expected values', () => {
    expect(PENDING_REASONS.has('needs_review')).toBe(true)
    expect(PENDING_REASONS.has('target_waitlisted')).toBe(true)
    expect(PENDING_REASONS.has('undirected_preference')).toBe(true)
  })

  it('DECLINED_REASONS contains expected values', () => {
    expect(DECLINED_REASONS.has('session_mismatch')).toBe(true)
    expect(DECLINED_REASONS.has('target_not_attending')).toBe(true)
    expect(DECLINED_REASONS.has('target_not_enrolled')).toBe(true)
    expect(DECLINED_REASONS.has('requester_not_attending')).toBe(true)
  })

  it('sets are mutually exclusive', () => {
    for (const reason of RESOLVED_REASONS) {
      expect(PENDING_REASONS.has(reason)).toBe(false)
      expect(DECLINED_REASONS.has(reason)).toBe(false)
    }
    for (const reason of PENDING_REASONS) {
      expect(RESOLVED_REASONS.has(reason)).toBe(false)
      expect(DECLINED_REASONS.has(reason)).toBe(false)
    }
    for (const reason of DECLINED_REASONS) {
      expect(RESOLVED_REASONS.has(reason)).toBe(false)
      expect(PENDING_REASONS.has(reason)).toBe(false)
    }
  })
})

describe('getDispositionSortRank', () => {
  it('returns 0 for declined reasons', () => {
    expect(getDispositionSortRank('session_mismatch')).toBe(0)
    expect(getDispositionSortRank('target_not_attending')).toBe(0)
    expect(getDispositionSortRank('requester_not_attending')).toBe(0)
  })

  it('returns 1 for pending reasons', () => {
    expect(getDispositionSortRank('needs_review')).toBe(1)
    expect(getDispositionSortRank('target_waitlisted')).toBe(1)
  })

  it('returns 2 for resolved reasons', () => {
    expect(getDispositionSortRank('exact_match')).toBe(2)
    expect(getDispositionSortRank('reciprocal_match')).toBe(2)
  })

  it('returns 3 for unknown reasons', () => {
    expect(getDispositionSortRank('unknown_reason')).toBe(3)
    expect(getDispositionSortRank('')).toBe(3)
  })
})

describe('formatDispositionReason', () => {
  it('replaces underscores with spaces', () => {
    expect(formatDispositionReason('exact_match')).toBe('exact match')
    expect(formatDispositionReason('target_not_attending')).toBe('target not attending')
  })

  it('returns single-word reasons unchanged', () => {
    expect(formatDispositionReason('other')).toBe('other')
  })
})

describe('confidence constants', () => {
  it('exports expected threshold values', () => {
    expect(CONFIDENCE_AUTO_ACCEPT).toBe(0.95)
    expect(CONFIDENCE_RESOLVED).toBe(0.85)
    expect(CONFIDENCE_WARNING).toBe(0.7)
  })

  it('thresholds are in descending order', () => {
    expect(CONFIDENCE_AUTO_ACCEPT).toBeGreaterThan(CONFIDENCE_RESOLVED)
    expect(CONFIDENCE_RESOLVED).toBeGreaterThan(CONFIDENCE_WARNING)
  })
})
