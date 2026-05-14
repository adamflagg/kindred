// frontend/src/components/PreValidationResultsModal.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import PreValidationResultsModal from './PreValidationResultsModal'

const noopSessionLookup = () => undefined

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
  },
}

describe('PreValidationResultsModal — staff modal updates (D1-D5)', () => {
  it('header renders amber "Heads Up" when impossibility_report.total_impossible > 0 even if valid=true', () => {
    const results = {
      valid: true,
      errors: [],
      warnings: [],
      statistics: {
        total_campers: 10,
        total_bunks: 2,
        total_capacity: 20,
        total_requests: 5,
        campers_with_requests: 8,
        campers_without_requests: 2,
      },
      impossibility_report: {
        total_impossible: 2,
        affected_campers: 2,
        by_reason: {},
        flat: [],
      } as unknown as import('../services/solver').ImpossibilityReport,
    }
    render(
      <PreValidationResultsModal
        isOpen
        onClose={() => {}}
        results={results}
        sessionLookup={() => 'Session'}
      />
    )

    expect(screen.queryByText(/ready to run/i)).not.toBeInTheDocument()
    expect(screen.getByText(/heads up/i)).toBeInTheDocument()
  })

  it('renders "Wants older — already at top grade" subtext for age_pref_no_eligible_grade older case', () => {
    const results = {
      valid: false,
      errors: [],
      warnings: [],
      statistics: {
        total_campers: 10,
        total_bunks: 2,
        total_capacity: 20,
        total_requests: 5,
        campers_with_requests: 8,
        campers_without_requests: 2,
      },
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
      } as unknown as import('../services/solver').ImpossibilityReport,
    }
    render(
      <PreValidationResultsModal
        isOpen
        onClose={() => {}}
        results={results}
        sessionLookup={() => 'Session'}
      />
    )

    expect(screen.getByText(/Wants older/)).toBeInTheDocument()
    expect(screen.getByText(/already at oldest grade/)).toBeInTheDocument()
  })

  it('renders cross_session subtext with sessionLookup-resolved session name', () => {
    const results = {
      valid: false,
      errors: [],
      warnings: [],
      statistics: {
        total_campers: 10,
        total_bunks: 2,
        total_capacity: 20,
        total_requests: 5,
        campers_with_requests: 8,
        campers_without_requests: 2,
      },
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
              detail: { requester_session: 1000001, requestee_session: 1000002 },
            },
          ],
        },
        flat: [],
      } as unknown as import('../services/solver').ImpossibilityReport,
    }
    const sessionLookup = (cm: number) => (cm === 1000002 ? 'Pioneer Period' : 'Taste of Camp')

    render(
      <PreValidationResultsModal
        isOpen
        onClose={() => {}}
        results={results}
        sessionLookup={sessionLookup}
      />
    )

    expect(screen.getByText(/Pioneer Period/)).toBeInTheDocument()
    expect(screen.getByText(/Judith Klein/)).toBeInTheDocument()
  })

  it('cross-gender pair shows requester gender on top line and requestee grade in subtext', () => {
    const results = {
      valid: false,
      errors: [],
      warnings: [],
      statistics: {
        total_campers: 10,
        total_bunks: 2,
        total_capacity: 20,
        total_requests: 5,
        campers_with_requests: 8,
        campers_without_requests: 2,
      },
      impossibility_report: {
        total_impossible: 1,
        affected_campers: 1,
        by_reason: {
          pair_no_shared_bunk: [
            {
              request_id: 'br_cg',
              reason_code: 'pair_no_shared_bunk',
              reason_message: 'cross gender',
              request_type: 'bunk_with',
              requester: { name: 'Samuel Johnson', cm_id: 40, grade: 5, gender: 'M' },
              requestee: { name: 'Emma Johnson', cm_id: 41, grade: 7, gender: 'F' },
              detail: { requester_gender: 'M', requestee_gender: 'F', session: 1000001 },
            },
          ],
        },
        flat: [],
      } as unknown as import('../services/solver').ImpossibilityReport,
    }

    render(
      <PreValidationResultsModal
        isOpen
        onClose={() => {}}
        results={results}
        sessionLookup={() => undefined}
      />
    )

    // Top line shows requester's gender — used to be only name + grade.
    expect(screen.getByText(/Samuel Johnson \(M\) · 5th/)).toBeInTheDocument()
    // Subtext surfaces requestee gender (in parens, right next to name) and
    // grade (short "Xth" form) — staff scan name → gender → grade left-to-right.
    expect(screen.getByText(/Emma Johnson \(F\)/)).toBeInTheDocument()
  })

  it('renders not_bunk_with subtext with negative wording (not "wants to bunk with")', () => {
    const results = {
      valid: false,
      errors: [],
      warnings: [],
      statistics: {
        total_campers: 10,
        total_bunks: 2,
        total_capacity: 20,
        total_requests: 5,
        campers_with_requests: 8,
        campers_without_requests: 2,
      },
      impossibility_report: {
        total_impossible: 1,
        affected_campers: 1,
        by_reason: {
          grade_compatibility: [
            {
              request_id: 'br_nb',
              reason_code: 'grade_compatibility',
              reason_message: 'gap too wide',
              request_type: 'not_bunk_with',
              requester: { name: 'Emma Johnson', cm_id: 30, grade: 5, gender: 'F' },
              requestee: { name: 'Olivia Chen', cm_id: 31, grade: 8, gender: 'F' },
              detail: {},
            },
          ],
        },
        flat: [],
      } as unknown as import('../services/solver').ImpossibilityReport,
    }
    render(
      <PreValidationResultsModal
        isOpen
        onClose={() => {}}
        results={results}
        sessionLookup={() => undefined}
      />
    )

    // Verb must reflect the negative request type — never the positive "bunk with".
    expect(screen.queryByText(/\bbunk with\b(?! )/i)).not.toBeInTheDocument()
    // Should mention Olivia and use language that fits a "don't bunk with" request.
    expect(screen.getByText(/Olivia Chen/)).toBeInTheDocument()
    expect(screen.getByText(/don['’]t bunk with/i)).toBeInTheDocument()
  })

  it('renders pair_no_shared_bunk subtext with no compatible cabin context', () => {
    const results = {
      valid: false,
      errors: [],
      warnings: [],
      statistics: {
        total_campers: 10,
        total_bunks: 2,
        total_capacity: 20,
        total_requests: 5,
        campers_with_requests: 8,
        campers_without_requests: 2,
      },
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
              detail: { requester_gender: 'M', requestee_gender: 'F', session: 1000001 },
            },
          ],
        },
        flat: [],
      } as unknown as import('../services/solver').ImpossibilityReport,
    }
    render(
      <PreValidationResultsModal
        isOpen
        onClose={() => {}}
        results={results}
        sessionLookup={() => 'Session'}
      />
    )

    expect(screen.getByText(/Olivia Chen/)).toBeInTheDocument()
    expect(screen.getByText(/not AG session/)).toBeInTheDocument()
  })

  it('renders each reason block as a <details> element with open attribute by default', () => {
    const results = {
      valid: false,
      errors: [],
      warnings: [],
      statistics: {
        total_campers: 10,
        total_bunks: 2,
        total_capacity: 20,
        total_requests: 5,
        campers_with_requests: 8,
        campers_without_requests: 2,
      },
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
      } as unknown as import('../services/solver').ImpossibilityReport,
    }
    render(
      <PreValidationResultsModal
        isOpen
        onClose={() => {}}
        results={results}
        sessionLookup={() => 'Session'}
      />
    )

    // Modal renders via createPortal into document.body; query there
    const detailsEls = document.querySelectorAll('details')
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
        sessionLookup={noopSessionLookup}
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
      },
    }

    render(
      <PreValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={results}
        sessionLookup={noopSessionLookup}
      />
    )
    expect(screen.getByText(/grade range too wide/i)).toBeInTheDocument()
    expect(screen.getByText(/Pearl Szasz-Toth/)).toBeInTheDocument()
    expect(screen.getByText(/Riley Raines/)).toBeInTheDocument()
  })

  it('renders friendly label + subtext for target_not_in_solver (requestee is null)', () => {
    const results = {
      ...baseResults,
      impossibility_report: {
        total_impossible: 1,
        affected_campers: 1,
        by_reason: {
          target_not_in_solver: [
            {
              request_id: 'br_ghost',
              reason_code: 'target_not_in_solver',
              reason_message: 'requested camper not enrolled',
              request_type: 'bunk_with',
              requester: { name: 'Emma Johnson', cm_id: 30, grade: 5, gender: 'F' },
              requestee: null,
              detail: { requested_person_cm_id: 99999 },
            },
          ],
        },
        flat: [],
      } as unknown as import('../services/solver').ImpossibilityReport,
    }

    render(
      <PreValidationResultsModal
        isOpen
        onClose={() => {}}
        results={results}
        sessionLookup={noopSessionLookup}
      />
    )

    // Section header uses the friendly label, never the raw snake_case code.
    expect(screen.queryByText('target_not_in_solver')).not.toBeInTheDocument()
    expect(screen.getByText(/friend not enrolled/i)).toBeInTheDocument()
    // Subtext explains the situation even though requestee is null — staff get
    // an actionable line instead of a bare requester name.
    expect(screen.getByText(/isn['’]t enrolled in this session/i)).toBeInTheDocument()
  })

  it('does not render cluster_grade_compatibility reason code (clusters removed)', () => {
    // clusters field is no longer part of ImpossibilityReport; this verifies
    // the modal renders cleanly with no cluster-related output
    render(
      <PreValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={baseResults}
        sessionLookup={noopSessionLookup}
      />
    )
    expect(screen.queryByText(/group spans too many grades/i)).not.toBeInTheDocument()
  })

  it('does not render reason codes (staff-only view)', () => {
    render(
      <PreValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={resultsWithImpossibility}
        sessionLookup={noopSessionLookup}
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
        sessionLookup={noopSessionLookup}
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
        sessionLookup={noopSessionLookup}
      />
    )
    const friendlyLabels = screen.getAllByText(/grade range too wide/i)
    expect(friendlyLabels).toHaveLength(1)
  })
})

describe('PreValidationResultsModal — entirely-impossible MP campers', () => {
  it('renders a camper-level section with action hints by reason code', () => {
    const results = {
      ...baseResults,
      impossibility_report: {
        total_impossible: 2,
        affected_campers: 2,
        by_reason: {},
        flat: [],
        mp_campers_entirely_impossible: [
          {
            cm_id: 1,
            name: 'Emma Johnson',
            grade: 5,
            gender: 'F',
            reason_codes: ['target_not_in_solver'],
          },
          {
            cm_id: 2,
            name: 'Liam Garcia',
            grade: 6,
            gender: 'M',
            reason_codes: ['grade_compatibility'],
          },
        ],
      } as unknown as import('../services/solver').ImpossibilityReport,
    }

    render(
      <PreValidationResultsModal
        isOpen
        onClose={() => {}}
        results={results}
        sessionLookup={noopSessionLookup}
      />
    )

    expect(screen.getByText(/zero parent requests honored/i)).toBeInTheDocument()
    expect(screen.getByText(/Emma Johnson/)).toBeInTheDocument()
    expect(screen.getByText(/confirm enrollment/i)).toBeInTheDocument()
    expect(screen.getByText(/Liam Garcia/)).toBeInTheDocument()
    expect(screen.getByText(/fix parent input/i)).toBeInTheDocument()
  })

  it('renders no camper-level section when the rollup is empty', () => {
    render(
      <PreValidationResultsModal
        isOpen
        onClose={() => {}}
        results={baseResults}
        sessionLookup={noopSessionLookup}
      />
    )
    expect(screen.queryByText(/zero parent requests honored/i)).not.toBeInTheDocument()
  })
})
