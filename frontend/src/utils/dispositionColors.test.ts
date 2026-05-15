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
  formatReason,
  shouldShowReasonInStatus,
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
  describe('resolved reasons', () => {
    it.each([
      ['exact_match', 'Matched'],
      ['high_confidence_match', 'Matched'],
      ['auto_resolved', 'Matched'],
      ['reciprocal_match', 'Mutual match'],
      ['cross_session_satisfied', 'Different sessions (neg)'],
      ['directional_preference', 'Age preference'],
    ])('maps %s to "%s"', (reason, expected) => {
      expect(formatDispositionReason(reason)).toBe(expected)
    })
  })

  describe('pending reasons', () => {
    it.each([
      ['needs_review', 'Needs review'],
      ['target_waitlisted', 'Waitlisted'],
      ['undirected_preference', 'Unclear age preference'],
    ])('maps %s to "%s"', (reason, expected) => {
      expect(formatDispositionReason(reason)).toBe(expected)
    })
  })

  describe('declined reasons', () => {
    it.each([
      ['session_mismatch', 'Different sessions'],
      ['target_not_attending', 'Not attending'],
      ['target_not_enrolled', 'Not enrolled'],
      ['requester_not_attending', 'Requester not attending'],
    ])('maps %s to "%s"', (reason, expected) => {
      expect(formatDispositionReason(reason)).toBe(expected)
    })
  })

  it('falls back to underscore replacement for unknown values', () => {
    expect(formatDispositionReason('some_unknown_reason')).toBe('some unknown reason')
    expect(formatDispositionReason('other')).toBe('other')
  })

  it('has an explicit display name for every known disposition reason', () => {
    const allReasons = [...RESOLVED_REASONS, ...PENDING_REASONS, ...DECLINED_REASONS]
    for (const reason of allReasons) {
      const display = formatDispositionReason(reason)
      const fallback = reason.replace(/_/g, ' ')
      expect(display, `${reason} is missing from DISPOSITION_DISPLAY_NAMES`).not.toBe(fallback)
    }
  })
})

describe('shouldShowReasonInStatus', () => {
  it('returns false when status is resolved regardless of reason', () => {
    expect(shouldShowReasonInStatus('resolved', 'exact_match')).toBe(false)
    expect(shouldShowReasonInStatus('resolved', 'reciprocal_match')).toBe(false)
    expect(shouldShowReasonInStatus('RESOLVED', 'exact_match')).toBe(false)
  })

  it('returns true for declined rows with any non-empty reason', () => {
    expect(shouldShowReasonInStatus('declined', 'session_mismatch')).toBe(true)
    expect(shouldShowReasonInStatus('declined', 'target_not_attending')).toBe(true)
    expect(shouldShowReasonInStatus('declined', 'requester_not_attending')).toBe(true)
    expect(shouldShowReasonInStatus('DECLINED', 'session_mismatch')).toBe(true)
  })

  it('returns false for declined rows with no reason', () => {
    expect(shouldShowReasonInStatus('declined', '')).toBe(false)
    expect(shouldShowReasonInStatus('declined', null)).toBe(false)
    expect(shouldShowReasonInStatus('declined', undefined)).toBe(false)
  })

  // Manual UI declines (RequestReviewPanel, AllCamperRequestsModal) write
  // `status: 'declined'` and leave `disposition_reason` at its prior pipeline
  // value (intentional per #1368 — empty would lose audit context). The
  // BunkRequestRow surface should not advertise that stale reason alongside
  // the new Declined chip — it produces a contradictory display ("Declined ·
  // Matched"). The all-camper audit modal continues to render the full
  // history via its own code path; this predicate is for the per-camper
  // BunkRequestRow only.
  describe('declined rows with stale resolved-family disposition_reason (#1447)', () => {
    it('returns false for declined + auto_resolved (stale manual decline)', () => {
      expect(shouldShowReasonInStatus('declined', 'auto_resolved')).toBe(false)
    })

    it('returns false for declined + exact_match (stale match reason)', () => {
      expect(shouldShowReasonInStatus('declined', 'exact_match')).toBe(false)
    })

    it('returns false for declined + high_confidence_match (stale match reason)', () => {
      expect(shouldShowReasonInStatus('declined', 'high_confidence_match')).toBe(false)
    })

    it('returns false for declined + reciprocal_match (stale match reason)', () => {
      expect(shouldShowReasonInStatus('declined', 'reciprocal_match')).toBe(false)
    })

    it('returns false for declined + cross_session_satisfied (stale resolved reason)', () => {
      expect(shouldShowReasonInStatus('declined', 'cross_session_satisfied')).toBe(false)
    })

    it('returns false for declined + needs_review (stale pending reason)', () => {
      expect(shouldShowReasonInStatus('declined', 'needs_review')).toBe(false)
    })

    it('returns false for declined + unknown_reason (unclassified stale reason)', () => {
      expect(shouldShowReasonInStatus('declined', 'unknown_reason')).toBe(false)
    })

    it('returns true for declined + session_mismatch (canonical declined reason)', () => {
      expect(shouldShowReasonInStatus('declined', 'session_mismatch')).toBe(true)
    })

    it('returns true for declined + target_not_attending (canonical declined reason)', () => {
      expect(shouldShowReasonInStatus('declined', 'target_not_attending')).toBe(true)
    })

    it('returns true for declined + target_not_enrolled (canonical declined reason)', () => {
      expect(shouldShowReasonInStatus('declined', 'target_not_enrolled')).toBe(true)
    })

    it('returns true for declined + requester_not_attending (canonical declined reason)', () => {
      expect(shouldShowReasonInStatus('declined', 'requester_not_attending')).toBe(true)
    })
  })

  it('returns true for pending rows with a triage reason', () => {
    expect(shouldShowReasonInStatus('pending', 'needs_review')).toBe(true)
    expect(shouldShowReasonInStatus('pending', 'target_waitlisted')).toBe(true)
    expect(shouldShowReasonInStatus('pending', 'undirected_preference')).toBe(true)
    expect(shouldShowReasonInStatus('PENDING', 'needs_review')).toBe(true)
  })

  it('returns false for pending rows with a non-triage reason', () => {
    expect(shouldShowReasonInStatus('pending', 'exact_match')).toBe(false)
    expect(shouldShowReasonInStatus('pending', 'session_mismatch')).toBe(false)
    expect(shouldShowReasonInStatus('pending', 'random_unknown')).toBe(false)
  })

  it('returns false for unknown status', () => {
    expect(shouldShowReasonInStatus('queued', 'needs_review')).toBe(false)
    expect(shouldShowReasonInStatus('', 'needs_review')).toBe(false)
  })

  it('returns false when reason is missing regardless of status', () => {
    expect(shouldShowReasonInStatus('pending', null)).toBe(false)
    expect(shouldShowReasonInStatus('pending', undefined)).toBe(false)
    expect(shouldShowReasonInStatus('pending', '')).toBe(false)
  })
})

describe('formatReason', () => {
  it('is an alias of formatDispositionReason', () => {
    expect(formatReason('exact_match')).toBe(formatDispositionReason('exact_match'))
    expect(formatReason('session_mismatch')).toBe(formatDispositionReason('session_mismatch'))
    expect(formatReason('needs_review')).toBe(formatDispositionReason('needs_review'))
    expect(formatReason('unknown_x')).toBe(formatDispositionReason('unknown_x'))
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

describe('self_referential disposition reason (issue #941)', () => {
  it('classifies self_referential as a PENDING (triage) reason', () => {
    expect(PENDING_REASONS.has('self_referential')).toBe(true)
    expect(RESOLVED_REASONS.has('self_referential')).toBe(false)
    expect(DECLINED_REASONS.has('self_referential')).toBe(false)
  })

  it('uses amber/warning badge classes for self_referential', () => {
    expect(getDispositionClasses('self_referential')).toBe(
      'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
    )
  })

  it('has a friendly display name (not a raw underscore-replaced fallback)', () => {
    const display = formatDispositionReason('self_referential')
    expect(display).not.toBe('self referential')
    expect(display.length).toBeGreaterThan(0)
  })

  it('shows the reason line in the Status cell for PENDING rows', () => {
    expect(shouldShowReasonInStatus('pending', 'self_referential')).toBe(true)
    expect(shouldShowReasonInStatus('PENDING', 'self_referential')).toBe(true)
  })

  it('has pending sort rank', () => {
    expect(getDispositionSortRank('self_referential')).toBe(1)
  })
})
