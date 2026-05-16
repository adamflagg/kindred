// frontend/src/components/PreValidationResultsModal.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import PreValidationResultsModal from './PreValidationResultsModal'
import { makeImpossibilityReport } from '../test/impossibilityReport'

vi.mock('./CamperDetailsPanel', () => ({
  default: ({ camperId, onClose }: { camperId: string; onClose: () => void }) => (
    <div data-testid="camper-details-panel" data-camper-id={camperId} onClick={onClose} />
  ),
}))

// BunkRequestProvider runs useQuery against PocketBase; in tests we don't
// boot the real provider — wrap children in a marker div instead so we can
// also assert the panel mounts inside the provider.
vi.mock('../providers/BunkRequestProvider', () => ({
  BunkRequestProvider: ({
    sessionCmId,
    children,
  }: {
    sessionCmId: number
    children: React.ReactNode
  }) => (
    <div data-testid="bunk-request-provider" data-session-cm-id={sessionCmId}>
      {children}
    </div>
  ),
}))

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
  impossibility_report: makeImpossibilityReport({
    total_impossible: 0,
    affected_campers: 0,
    by_reason: {},
    flat: [],
  }),
}

const oneImpossibleItem = {
  request_id: 'r1',
  reason_code: 'grade_compatibility',
  reason_message: 'Emma and Riley Sam span 2 grade levels',
  request_type: 'bunk_with',
  requester: { cm_id: 1, name: 'Emma', grade: 3, gender: 'F' },
  requestee: { cm_id: 2, name: 'Riley Sam', grade: 5, gender: 'F' },
  detail: { gap: 2, max_gap_allowed: 1 },
}

const resultsWithImpossibility = {
  valid: true,
  errors: [],
  warnings: [],
  statistics: baseStatistics,
  impossibility_report: makeImpossibilityReport({
    total_impossible: 1,
    affected_campers: 2,
    by_reason: {
      grade_compatibility: [oneImpossibleItem],
    },
    flat: [oneImpossibleItem],
  }),
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
      impossibility_report: makeImpossibilityReport({
        total_impossible: 2,
        affected_campers: 2,
        by_reason: {},
        flat: [],
      }),
    }
    render(
      <PreValidationResultsModal
        sessionCmId={1000001}
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
      impossibility_report: makeImpossibilityReport({
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
      }),
    }
    render(
      <PreValidationResultsModal
        sessionCmId={1000001}
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
      impossibility_report: makeImpossibilityReport({
        total_impossible: 1,
        affected_campers: 1,
        by_reason: {
          cross_session: [
            {
              request_id: 'br_xs',
              reason_code: 'cross_session',
              reason_message: 'different sessions',
              request_type: 'bunk_with',
              requester: { name: 'Olivia Chen', cm_id: 10, grade: 4, gender: 'F' },
              requestee: { name: 'Samuel Johnson', cm_id: 11, grade: 4, gender: 'F' },
              detail: { requester_session: 1000001, requestee_session: 1000002 },
            },
          ],
        },
        flat: [],
      }),
    }
    const sessionLookup = (cm: number) => (cm === 1000002 ? 'Pioneer Period' : 'Taste of Camp')

    render(
      <PreValidationResultsModal
        sessionCmId={1000001}
        isOpen
        onClose={() => {}}
        results={results}
        sessionLookup={sessionLookup}
      />
    )

    expect(screen.getByText(/Pioneer Period/)).toBeInTheDocument()
    expect(screen.getByText(/Samuel Johnson/)).toBeInTheDocument()
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
      impossibility_report: makeImpossibilityReport({
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
      }),
    }

    render(
      <PreValidationResultsModal
        sessionCmId={1000001}
        isOpen
        onClose={() => {}}
        results={results}
        sessionLookup={() => undefined}
      />
    )

    // Top line shows requester's gender — used to be only name + grade.
    // Name is now a click-through button; check the assembled text via parent element.
    expect(screen.getByRole('button', { name: /Samuel Johnson/ })).toBeInTheDocument()
    expect(
      screen.getByText((_, el) => el?.textContent === 'Samuel Johnson (M) · 5th')
    ).toBeInTheDocument()
    // Subtext surfaces requestee gender (in parens, right next to name) and
    // grade (short "Xth" form) — staff scan name → gender → grade left-to-right.
    // Name is now a click-through button; check assembled text via parent.
    expect(screen.getByRole('button', { name: /Emma Johnson/ })).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.textContent === 'Emma Johnson (F)')).toBeInTheDocument()
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
      impossibility_report: makeImpossibilityReport({
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
      }),
    }
    render(
      <PreValidationResultsModal
        sessionCmId={1000001}
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
      impossibility_report: makeImpossibilityReport({
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
      }),
    }
    render(
      <PreValidationResultsModal
        sessionCmId={1000001}
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
      impossibility_report: makeImpossibilityReport({
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
      }),
    }
    render(
      <PreValidationResultsModal
        sessionCmId={1000001}
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
        sessionCmId={1000001}
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
      impossibility_report: makeImpossibilityReport({
        total_impossible: 1,
        affected_campers: 2,
        by_reason: {
          grade_compatibility: [
            {
              ...oneImpossibleItem,
              requester: { cm_id: 1, name: 'Liam Garcia', grade: 3, gender: 'F' },
              requestee: { cm_id: 2, name: 'Riley Sam', grade: 5, gender: 'F' },
            },
          ],
        },
        flat: [],
      }),
    }

    render(
      <PreValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={results}
        sessionLookup={noopSessionLookup}
      />
    )
    expect(screen.getByText(/grade range too wide/i)).toBeInTheDocument()
    expect(screen.getByText(/Liam Garcia/)).toBeInTheDocument()
    expect(screen.getByText(/Riley Sam/)).toBeInTheDocument()
  })

  it('renders friendly label + subtext for target_not_in_solver (requestee is null)', () => {
    const results = {
      ...baseResults,
      impossibility_report: makeImpossibilityReport({
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
      }),
    }

    render(
      <PreValidationResultsModal
        sessionCmId={1000001}
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

  it('renders friendly label + subtext for self_conflict (#1446)', () => {
    const results = {
      ...baseResults,
      impossibility_report: makeImpossibilityReport({
        total_impossible: 2,
        affected_campers: 1,
        by_reason: {
          self_conflict: [
            {
              request_id: 'r_bw',
              reason_code: 'self_conflict',
              reason_message:
                "Emma Johnson has both a 'bunk_with' and a 'not_bunk_with' request toward Liam Garcia",
              request_type: 'bunk_with',
              requester: { cm_id: 1, name: 'Emma Johnson', grade: 6, gender: 'F' },
              requestee: { cm_id: 2, name: 'Liam Garcia', grade: 6, gender: 'M' },
              detail: {
                conflicting_request_id: 'r_nbw',
                requested_person_cm_id: 2,
                this_type: 'bunk_with',
                conflicting_type: 'not_bunk_with',
              },
            },
          ],
        },
        flat: [],
      }),
    }

    render(
      <PreValidationResultsModal
        sessionCmId={1000001}
        isOpen
        onClose={() => {}}
        results={results}
        sessionLookup={noopSessionLookup}
      />
    )

    // Section header uses the friendly label, never the raw snake_case code.
    expect(screen.queryByText('self_conflict')).not.toBeInTheDocument()
    expect(screen.getByText(/contradicting requests/i)).toBeInTheDocument()
    // Subtext explains the contradiction shape: "bunk with X — also marked don't bunk with"
    expect(screen.getByText(/Liam Garcia/)).toBeInTheDocument()
    expect(screen.getByText(/don't bunk with/i)).toBeInTheDocument()
  })

  it('does not render cluster_grade_compatibility reason code (clusters removed)', () => {
    // clusters field is no longer part of ImpossibilityReport; this verifies
    // the modal renders cleanly with no cluster-related output
    render(
      <PreValidationResultsModal
        sessionCmId={1000001}
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
        sessionCmId={1000001}
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
        sessionCmId={1000001}
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
        sessionCmId={1000001}
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
      impossibility_report: makeImpossibilityReport({
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
      }),
    }

    render(
      <PreValidationResultsModal
        sessionCmId={1000001}
        isOpen
        onClose={() => {}}
        results={results}
        sessionLookup={noopSessionLookup}
      />
    )

    expect(screen.getByText(/zero parent requests honored/i)).toBeInTheDocument()
    expect(screen.getByText(/Emma Johnson/)).toBeInTheDocument()
    expect(
      screen.getByText(/check enrollment — requested camper not on roster/)
    ).toBeInTheDocument()
    expect(screen.getByText(/Liam Garcia/)).toBeInTheDocument()
    expect(
      screen.getByText(/grade gap too wide — confirm priority with the family/)
    ).toBeInTheDocument()
  })

  it('renders no camper-level section when the rollup is empty', () => {
    render(
      <PreValidationResultsModal
        sessionCmId={1000001}
        isOpen
        onClose={() => {}}
        results={baseResults}
        sessionLookup={noopSessionLookup}
      />
    )
    expect(screen.queryByText(/zero parent requests honored/i)).not.toBeInTheDocument()
  })
})

describe('PreValidationResultsModal — per-reason hint copy', () => {
  const renderWithMpCamper = (reasonCodes: string[]) => {
    const results = {
      ...baseResults,
      impossibility_report: makeImpossibilityReport({
        total_impossible: reasonCodes.length,
        affected_campers: 1,
        by_reason: {},
        flat: [],
        mp_campers_entirely_impossible: [
          { cm_id: 100, name: 'Emma Johnson', grade: 4, gender: 'F', reason_codes: reasonCodes },
        ],
      }),
    }
    render(
      <PreValidationResultsModal
        sessionCmId={1000001}
        isOpen
        onClose={() => {}}
        results={results}
        sessionLookup={noopSessionLookup}
      />
    )
  }

  it.each([
    ['target_not_in_solver', 'check enrollment — requested camper not on roster'],
    ['grade_compatibility', 'grade gap too wide — confirm priority with the family'],
    ['cross_session', 'requested friend is in a different session — confirm intent'],
    ['pair_no_shared_bunk', 'cross-gender request — confirm with the family'],
    ['age_pref_no_eligible_grade', 'at the youngest/oldest grade — preference is moot'],
    ['malformed', 'request is missing a name — needs parent resubmission'],
    // self_conflict is emitted by bunking/solver/constraints/self_conflict.py
    // and shows up in FRIENDLY_REASON_LABELS already; needs a hint too so a
    // camper with only self_conflict doesn't fall through to "review request".
    ['self_conflict', 'contradicting requests — confirm which preference the family meant'],
  ])('renders the hint for reason code %s', (code, expectedHint) => {
    renderWithMpCamper([code])
    expect(screen.getByText(new RegExp(expectedHint))).toBeInTheDocument()
  })

  it('joins hints for multi-reason campers with " / "', () => {
    renderWithMpCamper(['grade_compatibility', 'cross_session'])
    expect(
      screen.getByText(
        /grade gap too wide — confirm priority with the family \/ requested friend is in a different session — confirm intent/
      )
    ).toBeInTheDocument()
  })

  it('falls back to a generic hint for unknown reason codes', () => {
    renderWithMpCamper(['some_brand_new_code'])
    expect(screen.getByText(/review request/)).toBeInTheDocument()
  })
})

describe('PreValidationResultsModal — click-through to CamperDetailsPanel', () => {
  const resultsWithRedSectionAndYellow = {
    ...baseResults,
    impossibility_report: makeImpossibilityReport({
      total_impossible: 1,
      affected_campers: 2,
      by_reason: { grade_compatibility: [oneImpossibleItem] },
      flat: [oneImpossibleItem],
      mp_campers_entirely_impossible: [
        {
          cm_id: 500,
          name: 'Olivia Chen',
          grade: 6,
          gender: 'F',
          reason_codes: ['cross_session'],
        },
      ],
    }),
  }

  it('opens the panel for the red-section camper when their name is clicked', async () => {
    render(
      <PreValidationResultsModal
        sessionCmId={1000001}
        isOpen
        onClose={() => {}}
        results={resultsWithRedSectionAndYellow}
        sessionLookup={noopSessionLookup}
      />
    )
    expect(screen.queryByTestId('camper-details-panel')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Olivia Chen/ }))
    const panel = await screen.findByTestId('camper-details-panel')
    expect(panel).toHaveAttribute('data-camper-id', '500')
  })

  it('opens the panel for a yellow-section requester when their name is clicked', async () => {
    render(
      <PreValidationResultsModal
        sessionCmId={1000001}
        isOpen
        onClose={() => {}}
        results={resultsWithRedSectionAndYellow}
        sessionLookup={noopSessionLookup}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Emma/ }))
    expect(await screen.findByTestId('camper-details-panel')).toHaveAttribute('data-camper-id', '1')
  })

  it('opens the panel for a yellow-section requestee when their name is clicked', async () => {
    render(
      <PreValidationResultsModal
        sessionCmId={1000001}
        isOpen
        onClose={() => {}}
        results={resultsWithRedSectionAndYellow}
        sessionLookup={noopSessionLookup}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Riley Sam/ }))
    expect(await screen.findByTestId('camper-details-panel')).toHaveAttribute('data-camper-id', '2')
  })

  it('wraps CamperDetailsPanel in a session-scoped BunkRequestProvider (#1464 regression)', () => {
    render(
      <PreValidationResultsModal
        isOpen
        sessionCmId={1234567}
        onClose={() => {}}
        results={resultsWithRedSectionAndYellow}
        sessionLookup={noopSessionLookup}
      />
    )
    // Pre-existing test data uses cm_id=500; click and assert the panel is
    // wrapped inside a BunkRequestProvider keyed to the modal's session.
    fireEvent.click(screen.getByRole('button', { name: /Olivia Chen/ }))
    const provider = screen.getByTestId('bunk-request-provider')
    expect(provider).toHaveAttribute('data-session-cm-id', '1234567')
    expect(provider).toContainElement(screen.getByTestId('camper-details-panel'))
  })

  it('renders the requestee as plain text (not a button) when requestee is null', () => {
    const targetMissingItem = {
      request_id: 'r_missing',
      reason_code: 'target_not_in_solver',
      reason_message: 'friend not enrolled',
      request_type: 'bunk_with',
      requester: { cm_id: 7, name: 'Riley Sam', grade: 4, gender: 'M' },
      requestee: null,
      detail: { requested_name: 'Phantom Friend' },
    }
    const results = {
      ...baseResults,
      impossibility_report: makeImpossibilityReport({
        total_impossible: 1,
        affected_campers: 1,
        by_reason: { target_not_in_solver: [targetMissingItem] },
        flat: [targetMissingItem],
      }),
    }
    render(
      <PreValidationResultsModal
        sessionCmId={1000001}
        isOpen
        onClose={() => {}}
        results={results}
        sessionLookup={noopSessionLookup}
      />
    )
    expect(screen.getByRole('button', { name: /Riley Sam/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Phantom Friend/ })).not.toBeInTheDocument()
  })
})
