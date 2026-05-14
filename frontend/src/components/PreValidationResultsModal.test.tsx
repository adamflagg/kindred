// frontend/src/components/PreValidationResultsModal.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import PreValidationResultsModal from './PreValidationResultsModal'

const baseStatistics = {
  total_campers: 30,
  total_bunks: 4,
  total_capacity: 48,
  total_requests: 25,
  campers_with_requests: 18,
  campers_without_requests: 12,
}

const baseResults = {
  valid: true,
  errors: [],
  warnings: [],
  statistics: baseStatistics,
  impossibility_report: {
    total_impossible: 0,
    affected_campers: 0,
    by_reason: {},
    flat: [],
    clusters: [],
  },
}

const oneImpossibleItem = {
  request_id: 'r1',
  reason_code: 'grade_compatibility',
  reason_message: 'Pearl and Riley span 2 grade levels',
  request_type: 'bunk_with',
  requester: { cm_id: 1, name: 'Pearl', grade: 3, gender: 'F' },
  requestee: { cm_id: 2, name: 'Riley', grade: 5, gender: 'F' },
  detail: { gap: 2, max_gap_allowed: 1 },
}

const resultsWithImpossibility = {
  valid: true,
  errors: [],
  warnings: [],
  statistics: baseStatistics,
  impossibility_report: {
    total_impossible: 1,
    affected_campers: 2,
    by_reason: {
      grade_compatibility: [oneImpossibleItem],
    },
    flat: [oneImpossibleItem],
    clusters: [],
  },
}

describe('PreValidationResultsModal — staff modal updates (D1-D5)', () => {
  it('header renders amber "Heads Up" when impossibility_report.total_impossible > 0 even if valid=true', () => {
    const results = {
      valid: true,
      errors: [],
      warnings: [],
      statistics: { total_campers: 10, campers_with_requests: 8 },
      // clusters: [] kept temporarily so current modal doesn't crash — removed from type in C3, modal ref cleaned in D6
      impossibility_report: {
        total_impossible: 2,
        affected_campers: 2,
        by_reason: {},
        flat: [],
        clusters: [],
      } as unknown as import('../services/solver').ImpossibilityReport,
    }
    render(
      <PreValidationResultsModal
        isOpen
        onClose={() => {}}
        results={results}
        // @ts-expect-error sessionLookup added in D6
        sessionLookup={() => 'Session'}
      />
    )

    expect(screen.queryByText(/ready to run/i)).not.toBeInTheDocument()
    expect(screen.getByText(/heads up/i)).toBeInTheDocument()
  })

  it('renders "Prefers older bunkmates — already in the oldest grade" subtext for age_pref_no_eligible_grade older case', () => {
    const results = {
      valid: false,
      errors: [],
      warnings: [],
      statistics: { total_campers: 10, campers_with_requests: 8 },
      impossibility_report: {
        total_impossible: 1,
        affected_campers: 1,
        by_reason: {
          age_pref_no_eligible_grade: [
            {
              request_id: 'br_age',
              reason_code: 'age_pref_no_eligible_grade',
              reason_message: 'no older peer',
              request_type: 'age_preference',
              requester: { name: 'Olivia Chen', cm_id: 1, grade: 6, gender: 'F' },
              requestee: null,
              detail: { direction: 'older', requester_grade: 6, pool_max_grade: 6 },
            },
          ],
        },
        flat: [],
        clusters: [],
      } as unknown as import('../services/solver').ImpossibilityReport,
    }
    render(
      <PreValidationResultsModal
        isOpen
        onClose={() => {}}
        results={results}
        // @ts-expect-error sessionLookup added in D6
        sessionLookup={() => 'Session'}
      />
    )

    expect(screen.getByText(/Prefers older bunkmates/)).toBeInTheDocument()
    expect(screen.getByText(/already in the oldest grade in their session/)).toBeInTheDocument()
  })

  it('renders cross_session subtext with sessionLookup-resolved session name', () => {
    const results = {
      valid: false,
      errors: [],
      warnings: [],
      statistics: { total_campers: 10, campers_with_requests: 8 },
      impossibility_report: {
        total_impossible: 1,
        affected_campers: 1,
        by_reason: {
          cross_session: [
            {
              request_id: 'br_xs',
              reason_code: 'cross_session',
              reason_message: 'different sessions',
              request_type: 'bunk_with',
              requester: { name: 'Aubrey Engler', cm_id: 10, grade: 4, gender: 'F' },
              requestee: { name: 'Judith Klein', cm_id: 11, grade: 4, gender: 'F' },
              detail: { requester_session: 1378702, requestee_session: 1378704 },
            },
          ],
        },
        flat: [],
        clusters: [],
      } as unknown as import('../services/solver').ImpossibilityReport,
    }
    const sessionLookup = (cm: number) => (cm === 1378704 ? 'Pioneer Period' : 'Taste of Camp')

    render(
      <PreValidationResultsModal
        isOpen
        onClose={() => {}}
        results={results}
        // @ts-expect-error sessionLookup added in D6
        sessionLookup={sessionLookup}
      />
    )

    expect(screen.getByText(/Pioneer Period/)).toBeInTheDocument()
    expect(screen.getByText(/Judith Klein/)).toBeInTheDocument()
  })

  it('renders pair_no_shared_bunk subtext with no compatible cabin context', () => {
    const results = {
      valid: false,
      errors: [],
      warnings: [],
      statistics: { total_campers: 10, campers_with_requests: 8 },
      impossibility_report: {
        total_impossible: 1,
        affected_campers: 1,
        by_reason: {
          pair_no_shared_bunk: [
            {
              request_id: 'br_gender',
              reason_code: 'pair_no_shared_bunk',
              reason_message: 'no shared bunk',
              request_type: 'bunk_with',
              requester: { name: 'Samuel Johnson', cm_id: 20, grade: 5, gender: 'M' },
              requestee: { name: 'Olivia Chen', cm_id: 21, grade: 5, gender: 'F' },
              detail: { requester_gender: 'M', requestee_gender: 'F', session: 1378702 },
            },
          ],
        },
        flat: [],
        clusters: [],
      } as unknown as import('../services/solver').ImpossibilityReport,
    }
    render(
      <PreValidationResultsModal
        isOpen
        onClose={() => {}}
        results={results}
        // @ts-expect-error sessionLookup added in D6
        sessionLookup={() => 'Session'}
      />
    )

    expect(screen.getByText(/Olivia Chen/)).toBeInTheDocument()
    expect(screen.getByText(/no compatible cabin in this session/)).toBeInTheDocument()
  })

  it('renders each reason block as a <details> element with open attribute by default', () => {
    const results = {
      valid: false,
      errors: [],
      warnings: [],
      statistics: { total_campers: 10, campers_with_requests: 8 },
      impossibility_report: {
        total_impossible: 1,
        affected_campers: 1,
        by_reason: {
          grade_compatibility: [
            {
              request_id: 'br_g',
              reason_code: 'grade_compatibility',
              reason_message: '',
              request_type: 'bunk_with',
              requester: { name: 'A', cm_id: 1, grade: 3, gender: 'F' },
              requestee: { name: 'B', cm_id: 2, grade: 5, gender: 'F' },
              detail: {},
            },
          ],
        },
        flat: [],
        clusters: [],
      } as unknown as import('../services/solver').ImpossibilityReport,
    }
    const { container } = render(
      <PreValidationResultsModal
        isOpen
        onClose={() => {}}
        results={results}
        // @ts-expect-error sessionLookup added in D6
        sessionLookup={() => 'Session'}
      />
    )

    const detailsEls = container.querySelectorAll('details')
    expect(detailsEls.length).toBeGreaterThan(0)
    detailsEls.forEach((el) => expect(el.hasAttribute('open')).toBe(true))
  })
})

describe('PreValidationResultsModal — staff-only view', () => {
  it('shows empty-state banner when no impossibilities', () => {
    render(
      <PreValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={baseResults}
        sessionId="100"
      />
    )
    expect(screen.getByText(/no impossible requests/i)).toBeInTheDocument()
  })

  it('renders grouped section for grade_compatibility with friendly label', () => {
    const results = {
      ...baseResults,
      impossibility_report: {
        total_impossible: 1,
        affected_campers: 2,
        by_reason: {
          grade_compatibility: [
            {
              ...oneImpossibleItem,
              requester: { cm_id: 1, name: 'Pearl Szasz-Toth', grade: 3, gender: 'F' },
              requestee: { cm_id: 2, name: 'Riley Raines', grade: 5, gender: 'F' },
            },
          ],
        },
        flat: [],
        clusters: [],
      },
    }

    render(
      <PreValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={results}
        sessionId="100"
      />
    )
    expect(screen.getByText(/grade range too wide/i)).toBeInTheDocument()
    expect(screen.getByText(/Pearl Szasz-Toth/)).toBeInTheDocument()
    expect(screen.getByText(/Riley Raines/)).toBeInTheDocument()
  })

  it('renders cluster section when clusters present', () => {
    const results = {
      ...baseResults,
      impossibility_report: {
        total_impossible: 0,
        affected_campers: 4,
        by_reason: {},
        flat: [],
        clusters: [
          {
            reason_code: 'cluster_grade_compatibility',
            reason_message: 'A group of 4 spans grades 3-7',
            cm_ids: [1, 2, 3, 4],
            campers: [
              { cm_id: 1, name: 'Pearl', grade: 3, gender: 'F' },
              { cm_id: 2, name: 'Riley', grade: 5, gender: 'F' },
              { cm_id: 3, name: 'Olivia', grade: 6, gender: 'F' },
              { cm_id: 4, name: 'Ava', grade: 7, gender: 'F' },
            ],
            detail: { grade_min: 3, grade_max: 7, range: 4 },
          },
        ],
      },
    }

    render(
      <PreValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={results}
        sessionId="100"
      />
    )
    expect(screen.getByText(/group spans too many grades/i)).toBeInTheDocument()
  })

  it('does not render reason codes (staff-only view)', () => {
    render(
      <PreValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={resultsWithImpossibility}
        sessionId="100"
      />
    )
    expect(screen.queryByText('grade_compatibility')).not.toBeInTheDocument()
  })

  it('does not render admin tabs (staff-only view)', () => {
    render(
      <PreValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={resultsWithImpossibility}
        sessionId="100"
      />
    )
    expect(screen.queryByRole('tab', { name: /by reason/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /flat table/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /json/i })).not.toBeInTheDocument()
  })

  it('renders impossibility section only once in the DOM (no duplicate)', () => {
    render(
      <PreValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={resultsWithImpossibility}
        sessionId="100"
      />
    )
    const friendlyLabels = screen.getAllByText(/grade range too wide/i)
    expect(friendlyLabels).toHaveLength(1)
  })
})
