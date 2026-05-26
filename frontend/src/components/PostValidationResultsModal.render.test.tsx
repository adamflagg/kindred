/**
 * TDD render tests for PostValidationResultsModal — Stage 3a / 3b.2
 *
 * Stage 3a: added material_parent_* and best_effort_parent_* field consumption.
 * Stage 3b.2: removed best-effort one-liner; modal now drives banner, donut,
 *   status tier, and stats tile from material parent satisfaction rate.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import toast from 'react-hot-toast'

import PostValidationResultsModal from './PostValidationResultsModal'
import { makeImpossibilityReport } from '../test/impossibilityReport'
import type { EntirelyImpossibleMpCamper } from '../services/solver'

// Stub out AuthContext so tests don't need a real AuthProvider
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { name: 'Test User' } }),
}))

// Mock react-router hooks used by PostCheckContents
const mockNavigate = vi.fn()
// Configurable pathname for useLocation — default is NOT a popout route.
// Individual tests can set mockLocationPathname to a /post-check path to
// exercise the isPopoutRoute=true branch of handleCamperClick/handlePopout.
let mockLocationPathname = '/session/1000001/bunking'
vi.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: mockLocationPathname }),
  Link: ({ children, ...p }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...p}>{children}</a>
  ),
}))

// Mock the Modal component to render children directly
vi.mock('./ui/Modal', () => ({
  Modal: ({
    isOpen,
    children,
    header,
    footer,
  }: {
    isOpen: boolean
    children: React.ReactNode
    header?: React.ReactNode
    footer?: React.ReactNode
  }) => {
    if (!isOpen) return null
    return (
      <div data-testid="modal">
        {header}
        {children}
        {footer}
      </div>
    )
  },
}))

// BunkRequestProvider runs useQuery against PocketBase; in tests we don't
// boot the real provider — wrap children in a marker div instead.
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

function makeStats(overrides: Record<string, unknown> = {}) {
  return {
    total_campers: 50,
    assigned_campers: 50,
    unassigned_campers: 0,
    total_requests: 20,
    satisfied_requests: 18,
    request_satisfaction_rate: 0.9,
    bunks_at_capacity: 4,
    bunks_under_capacity: 0,
    bunks_over_capacity: 0,
    material_parent_requests: 12,
    satisfied_material_parent_requests: 10,
    material_parent_request_satisfaction_rate: 0.83,
    campers_with_unsatisfied_material_parent_requests: 2,
    best_effort_parent_requests: 8,
    satisfied_best_effort_parent_requests: 5,
    best_effort_parent_request_satisfaction_rate: 0.625,
    field_stats: {},
    ...overrides,
  }
}

function makeResults(statsOverrides: Record<string, unknown> = {}) {
  return {
    statistics: makeStats(statsOverrides),
    issues: [],
    validated_at: '2025-06-01T12:00:00Z',
  }
}

describe('PostValidationResultsModal — best-effort line removed (Stage 3b.2)', () => {
  it('does not render the best-effort one-liner even when best_effort_parent_requests > 0', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
      />
    )

    expect(screen.queryByText(/best-effort preferences honored/i)).not.toBeInTheDocument()
  })

  it('does not render the best-effort one-liner when best_effort_parent_requests is 0', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          best_effort_parent_requests: 0,
          satisfied_best_effort_parent_requests: 0,
        })}
      />
    )

    expect(screen.queryByText(/best-effort preferences honored/i)).not.toBeInTheDocument()
  })
})

describe('PostValidationResultsModal — banner sub-text (Stage 3b.2)', () => {
  it('shows kid-count copy when ≥1 kid has an unmet parent request', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          material_parent_requests: 30,
          satisfied_material_parent_requests: 18,
          material_parent_request_satisfaction_rate: 0.6,
          campers_with_unsatisfied_material_parent_requests: 6,
        })}
      />
    )
    expect(screen.getByText(/6 kids missed a parent request/i)).toBeInTheDocument()
  })

  it('uses singular "kid" when exactly 1 kid is unmet', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          material_parent_requests: 10,
          satisfied_material_parent_requests: 9,
          material_parent_request_satisfaction_rate: 0.9,
          campers_with_unsatisfied_material_parent_requests: 1,
        })}
      />
    )
    expect(screen.getByText(/1 kid missed a parent request/i)).toBeInTheDocument()
    expect(screen.queryByText(/1 kids missed/i)).not.toBeInTheDocument()
  })

  it('shows "All N parent requests fulfilled" when zero kids unmet but parent requests exist', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          material_parent_requests: 12,
          satisfied_material_parent_requests: 12,
          material_parent_request_satisfaction_rate: 1.0,
          campers_with_unsatisfied_material_parent_requests: 0,
        })}
      />
    )
    expect(screen.getByText(/all 12 parent requests fulfilled/i)).toBeInTheDocument()
  })

  it('uses singular "request" when exactly 1 parent request exists and is fulfilled', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          material_parent_requests: 1,
          satisfied_material_parent_requests: 1,
          material_parent_request_satisfaction_rate: 1.0,
          campers_with_unsatisfied_material_parent_requests: 0,
        })}
      />
    )
    expect(screen.getByText(/all 1 parent request fulfilled/i)).toBeInTheDocument()
  })

  it('falls back to per-tier generic sub when zero parent requests in session', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          material_parent_requests: 0,
          satisfied_material_parent_requests: 0,
          material_parent_request_satisfaction_rate: 0,
          campers_with_unsatisfied_material_parent_requests: 0,
          // Force "Excellent" tier via all-up rate
          request_satisfaction_rate: 0.95,
          satisfied_requests: 19,
          total_requests: 20,
        })}
      />
    )
    // Expect existing per-tier copy ("Bunking looks great" for Excellent tier)
    expect(screen.getByText(/bunking looks great/i)).toBeInTheDocument()
    expect(screen.queryByText(/missed a parent request/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/parent requests fulfilled/i)).not.toBeInTheDocument()
  })
})

describe('PostValidationResultsModal — donut ring rate (Stage 3b.2)', () => {
  it('passes parent satisfaction rate to SatisfactionRing when parent requests exist', () => {
    const { container } = render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          material_parent_requests: 30,
          satisfied_material_parent_requests: 18,
          material_parent_request_satisfaction_rate: 0.6,
          campers_with_unsatisfied_material_parent_requests: 6,
          // Diverging all-up rate to prove we're reading the parent one
          request_satisfaction_rate: 0.9,
          satisfied_requests: 27,
          total_requests: 30,
        })}
      />
    )

    // SatisfactionRing renders the rate as a percentage; expect 60% somewhere
    // in the rendered output (NOT 90%).
    expect(container.textContent).toMatch(/60%/)
    expect(container.textContent).not.toMatch(/90%/)
  })

  it('falls back to all-up rate when zero material parent requests in session', () => {
    const { container } = render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          material_parent_requests: 0,
          satisfied_material_parent_requests: 0,
          material_parent_request_satisfaction_rate: 0,
          campers_with_unsatisfied_material_parent_requests: 0,
          request_satisfaction_rate: 0.85,
          satisfied_requests: 17,
          total_requests: 20,
        })}
      />
    )

    expect(container.textContent).toMatch(/85%/)
  })

  it('drives status tier from parent rate (parent at 60% lands in Needs Attention even when all-up is 90%)', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          material_parent_requests: 30,
          satisfied_material_parent_requests: 18,
          material_parent_request_satisfaction_rate: 0.6,
          campers_with_unsatisfied_material_parent_requests: 6,
          request_satisfaction_rate: 0.9,
          satisfied_requests: 27,
          total_requests: 30,
        })}
      />
    )

    // Parent-rate 0.6 is in [0.5, 0.7) → Needs Attention tier.
    expect(screen.getByText(/needs attention/i)).toBeInTheDocument()
    expect(screen.queryByText(/looking good/i)).not.toBeInTheDocument()
  })
})

describe('PostValidationResultsModal — parent stats tile (Stage 3b.2)', () => {
  // NOTE (#1631): The "parent requests met" and "bunks used" tiles have been
  // removed from the quick-stats grid. These tests now verify the new
  // camper-coverage tiles ("got ≥1 request" and "got all requests") that
  // replaced them. The request-level fraction (18/30) is no longer displayed
  // in the grid; the satisfaction ring still shows the parent satisfaction %.

  it('does not render the request-level fraction in the stats grid (replaced by camper-coverage tiles)', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          material_parent_requests: 30,
          satisfied_material_parent_requests: 18,
          material_parent_request_satisfaction_rate: 0.6,
          campers_with_unsatisfied_material_parent_requests: 6,
          request_satisfaction_rate: 0.9,
          satisfied_requests: 27,
          total_requests: 30,
          mp_campers_total: 25,
          mp_campers_with_at_least_one_satisfied: 20,
          mp_campers_with_all_satisfied: 15,
        })}
      />
    )

    // "parent requests met" tile is gone
    expect(screen.queryByText(/parent requests met/i)).not.toBeInTheDocument()
    // The camper-coverage tiles render instead
    expect(screen.getByText(/got ≥1 request/i)).toBeInTheDocument()
    expect(screen.getByText(/got all requests/i)).toBeInTheDocument()
  })

  it('does not render the "bunks used" tile (removed in #1631)', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          bunks_at_capacity: 4,
          bunks_under_capacity: 0,
          bunks_over_capacity: 0,
        })}
      />
    )
    expect(screen.queryByText(/bunks used/i)).not.toBeInTheDocument()
  })

  it('does not render the all-up "requests met" caption (removed in #1631)', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          material_parent_requests: 0,
          satisfied_material_parent_requests: 0,
          material_parent_request_satisfaction_rate: 0,
          campers_with_unsatisfied_material_parent_requests: 0,
          request_satisfaction_rate: 0.9,
          satisfied_requests: 18,
          total_requests: 20,
        })}
      />
    )

    // The old "requests met" fallback caption is gone; new tiles render instead
    expect(screen.queryByText(/^requests met$/i)).not.toBeInTheDocument()
    expect(screen.getByText(/got ≥1 request/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// #1105: Unmet parent requests drill-down section
// ---------------------------------------------------------------------------

describe('PostValidationResultsModal — KPI "issues" tile excludes suppressed types', () => {
  it('counts only non-suppressed issues so the tile matches the sections below', () => {
    // 2 visible + 3 suppressed = 5 raw; tile should show "2".
    const issues = [
      { type: 'capacity_violation', severity: 'error', message: 'Bunk Pine 1 is over capacity' },
      { type: 'age_spread_warning', severity: 'warning', message: 'Bunk Oak 2 has excessive age' },
      { type: 'valid_negative_request_violated', severity: 'warning', message: 'suppressed 1' },
      { type: 'no_requests', severity: 'warning', message: 'suppressed 2' },
      { type: 'campers_with_unsatisfied_valid_requests', severity: 'warning', message: 'sup 3' },
    ]
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={{ statistics: makeStats(), issues, validated_at: '2025-06-01T12:00:00Z' }}
      />
    )
    const tileLabel = screen.getByText(/^issues$/i)
    const tileValue = tileLabel.previousElementSibling
    expect(tileValue?.textContent).toBe('2')
  })
})

describe('PostValidationResultsModal — unmet parent requests drill-down removed', () => {
  // Group 65: every camper in this list is already surfaced in "Families to
  // contact" as a got-nothing row, so the separate (unformatted) drill-down was
  // removed. The KPI sub-label ("N kids missed a parent request") still conveys
  // the count — see the banner sub-text tests above.
  it('does not render a separate unmet-parents drill-down even when unsatisfied data is present', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          unsatisfied_material_parent_persons: [
            { cm_id: 1000001, name: 'Emma Johnson' },
            { cm_id: 1000002, name: 'Liam Garcia' },
          ],
          unsatisfied_material_parent_detail: [
            {
              requester_cm_id: '1000001',
              requester_name: 'Emma Johnson',
              target_cm_id: '1000003',
              target_name: 'Olivia Chen',
              requester_bunk_name: 'B-1',
              target_bunk_name: 'G-2',
            },
          ],
        })}
      />
    )

    expect(screen.queryByRole('button', { name: /unmet parent requests/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/campers with unmet parent requests/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^unmet parent requests \(\d+\)$/i)).not.toBeInTheDocument()
  })
})

vi.mock('./CamperDetailsPanel', () => ({
  default: ({ camperId, onClose }: { camperId: string; onClose: () => void }) => (
    <div data-testid="camper-details-panel" data-camper-id={camperId} onClick={onClose} />
  ),
}))

// ---------------------------------------------------------------------------
// Task 4.6 — "Impossibility by reason" section
// ---------------------------------------------------------------------------

describe('PostValidationResultsModal — Impossibility by reason section (TG-4.6)', () => {
  it('renders impossibility by_reason as stat tiles when reasons are present', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={makeImpossibilityReport({
          mp_campers_entirely_impossible: [],
          by_reason: {
            grade_compatibility: [
              {
                request_id: 'r1',
                reason_code: 'grade_compatibility',
                reason_message: 'grade too wide',
                request_type: 'bunk_with',
                requester: { cm_id: 1, name: 'Emma Johnson', grade: 5, gender: 'F' },
                requestee: { cm_id: 2, name: 'Liam Garcia', grade: 8, gender: 'M' },
                detail: {},
                bucket: 'material_parent' as const,
              },
              {
                request_id: 'r2',
                reason_code: 'grade_compatibility',
                reason_message: 'grade too wide',
                request_type: 'bunk_with',
                requester: { cm_id: 3, name: 'Olivia Chen', grade: 5, gender: 'F' },
                requestee: { cm_id: 4, name: 'Riley Sam', grade: 9, gender: 'F' },
                detail: {},
                bucket: 'material_parent' as const,
              },
            ],
            cross_session: [
              {
                request_id: 'r3',
                reason_code: 'cross_session',
                reason_message: 'different session',
                request_type: 'bunk_with',
                requester: { cm_id: 5, name: 'Sophia Martinez', grade: 6, gender: 'F' },
                requestee: null,
                detail: {},
                bucket: null,
              },
            ],
          },
        })}
      />
    )
    expect(screen.getByText(/impossible by reason/i)).toBeInTheDocument()
  })

  it('does not render a ghost "0" tile for a reason code with no items', () => {
    // After the backend strips IMMATERIAL_PARENT rows (#1537), a reason code
    // whose items were all immaterial is left with an empty array. The modal
    // must not render a "0" tile for it — mirroring PreValidationResultsModal's
    // per-tile guard. Group 65 #1549.
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={makeImpossibilityReport({
          by_reason: {
            grade_compatibility: [
              {
                request_id: 'r1',
                reason_code: 'grade_compatibility',
                reason_message: 'grade too wide',
                request_type: 'bunk_with',
                requester: { cm_id: 1, name: 'Emma Johnson', grade: 5, gender: 'F' },
                requestee: { cm_id: 2, name: 'Liam Garcia', grade: 8, gender: 'M' },
                detail: {},
                bucket: 'material_parent' as const,
              },
            ],
            cross_session: [],
          },
        })}
      />
    )
    // The populated reason renders its tile.
    expect(screen.getByText('Grade range too wide')).toBeInTheDocument()
    // The empty reason must NOT render a ghost tile.
    expect(screen.queryByText('Different sessions')).not.toBeInTheDocument()
  })

  it('does not render "Impossible by reason" when by_reason is empty', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={makeImpossibilityReport({ by_reason: {} })}
      />
    )
    expect(screen.queryByText(/impossible by reason/i)).not.toBeInTheDocument()
  })

  it('does not render "Impossible by reason" when impossibilityReport is absent', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
      />
    )
    expect(screen.queryByText(/impossible by reason/i)).not.toBeInTheDocument()
  })
})

describe('PostValidationResultsModal — impossibility section (#1442 part 2)', () => {
  const makeReport = (mp: EntirelyImpossibleMpCamper[], totalImpossible = mp.length) =>
    makeImpossibilityReport({
      total_impossible: totalImpossible,
      affected_campers: mp.length,
      mp_campers_entirely_impossible: mp,
    })

  it('does not render the section when impossibilityReport prop is omitted', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
      />
    )
    expect(screen.queryByText(/impossible request/i)).not.toBeInTheDocument()
  })

  it('does not render the section when mp_campers_entirely_impossible is empty', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={makeReport([], 0)}
      />
    )
    expect(screen.queryByText(/impossible request/i)).not.toBeInTheDocument()
  })

  it('opens the panel when a camper name in the section is clicked', async () => {
    const report = makeReport([
      {
        cm_id: 42,
        name: 'Olivia Chen',
        grade: 6,
        gender: 'F',
        reason_codes: ['cross_session'],
        session_cm_id: 1000001,
      },
    ])
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={report}
      />
    )
    const user = userEvent.setup()
    // Camper name is now a clickable span inside the family-row expand toggle,
    // not a standalone button — use getByText to target the span directly.
    await user.click(screen.getByText('Olivia Chen'))
    expect(await screen.findByTestId('camper-details-panel')).toHaveAttribute(
      'data-camper-id',
      '42'
    )
  })

  it('wraps CamperDetailsPanel in a session-scoped BunkRequestProvider (#1464 regression)', async () => {
    const report = makeReport([
      {
        cm_id: 42,
        name: 'Olivia Chen',
        grade: 6,
        gender: 'F',
        reason_codes: ['cross_session'],
        session_cm_id: 1000001,
      },
    ])
    render(
      <PostValidationResultsModal
        isOpen={true}
        sessionCmId={9876543}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={report}
      />
    )
    const user = userEvent.setup()
    await user.click(screen.getByText('Olivia Chen'))
    const provider = await screen.findByTestId('bunk-request-provider')
    expect(provider).toHaveAttribute('data-session-cm-id', '9876543')
    expect(provider).toContainElement(screen.getByTestId('camper-details-panel'))
  })

  it('shows a small "pre-check unavailable" notice when preCheckError is true and no report is in', () => {
    // Honors the 4-state query handling rule from frontend/CLAUDE.md: the post-
    // check modal silently dropping the impossibility section on pre-check
    // failure looks identical to "no impossibilities" — we surface the
    // difference instead.
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        preCheckError={true}
      />
    )
    expect(screen.getByText(/pre-check unavailable/i)).toBeInTheDocument()
  })

  it('does not show the pre-check notice when the report did arrive', () => {
    // If the report is present, no need to apologize — the section either
    // renders the cohort or correctly hides itself.
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={makeReport([])}
        preCheckError={true}
      />
    )
    expect(screen.queryByText(/pre-check unavailable/i)).not.toBeInTheDocument()
  })

  it('clears the selected camper when the modal closes, so reopening starts fresh', async () => {
    // Otherwise selectedCamperId persists across close/reopen and the camper
    // details panel remounts with stale selection.
    const report = makeReport([
      {
        cm_id: 99,
        name: 'Riley Sam',
        grade: 5,
        gender: 'F',
        reason_codes: ['cross_session'],
        session_cm_id: 1000001,
      },
    ])
    const { rerender } = render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={report}
      />
    )
    const user = userEvent.setup()
    // Camper name is now a clickable span, not a standalone button.
    await user.click(screen.getByText('Riley Sam'))
    expect(await screen.findByTestId('camper-details-panel')).toBeInTheDocument()

    // Close the modal.
    rerender(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={false}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={report}
      />
    )

    // Reopen — the details panel should NOT come back with the stale selection.
    rerender(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={report}
      />
    )
    expect(screen.queryByTestId('camper-details-panel')).not.toBeInTheDocument()
  })
})

// ── TG-5: PDF export button ──────────────────────────────────────────────────

function makeBaseProps(overrides: Record<string, unknown> = {}) {
  return {
    isOpen: true,
    onClose: () => {},
    sessionCmId: 1000001,
    results: makeResults(),
    ...overrides,
  }
}

describe('PostValidationResultsModal — PDF export button (TG-5)', () => {
  it('shows an Export PDF button before any PDF code loads', () => {
    render(<PostValidationResultsModal {...makeBaseProps()} />)
    expect(screen.getByRole('button', { name: /Export PDF/i })).toBeInTheDocument()
  })
})

describe('PostValidationResultsModal — Details by request source order', () => {
  it('renders source-field rows in fixed backend order, not by count', async () => {
    const stats = makeStats({
      field_stats: {
        socialize_with: { total: 100, satisfied: 50, satisfaction_rate: 0.5 },
        share_bunk_with: { total: 10, satisfied: 8, satisfaction_rate: 0.8 },
        do_not_share_with: { total: 5, satisfied: 4, satisfaction_rate: 0.8 },
        bunking_notes: { total: 20, satisfied: 15, satisfaction_rate: 0.75 },
        internal_notes: { total: 15, satisfied: 10, satisfaction_rate: 0.67 },
      },
    })
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults(stats)}
      />
    )
    // Expand the "Details by request source" collapsible
    await userEvent.click(screen.getByText(/details by request source/i))

    // Get the visible row labels in render order
    const labels = screen.getAllByText(
      /Bunk Request Form|Do NOT Share Bunk With|Bunking Notes|Internal Notes|Social With Checkbox/
    )
    const order = labels.map((el) => el.textContent)
    expect(order).toEqual([
      'Bunk Request Form',
      'Do NOT Share Bunk With',
      'Bunking Notes',
      'Internal Notes',
      'Social With Checkbox',
    ])
  })
})

describe('PostValidationResultsModal — Capacity by gender section', () => {
  it('renders female and male capacity bars from statistics.capacity_by_gender', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          capacity_by_gender: {
            female: { capacity: 65, assigned: 62 },
            male: { capacity: 85, assigned: 66 },
          },
        })}
      />
    )
    expect(screen.getByText(/capacity by gender/i)).toBeInTheDocument()
    expect(screen.getByText(/62.*\/.*65/)).toBeInTheDocument()
    expect(screen.getByText(/66.*\/.*85/)).toBeInTheDocument()
  })

  it('hides Capacity by gender when field is absent', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
      />
    )
    expect(screen.queryByText(/capacity by gender/i)).not.toBeInTheDocument()
  })
})

describe('PostValidationResultsModal — Bunks needing attention', () => {
  it('groups bunk-level issues into one row per bunk with chips', () => {
    // Real validator emits structured `details.bunk_name` for every
    // bunk-level issue; the extractor reads that first and falls back to
    // message parsing only when missing.
    const issues = [
      {
        type: 'capacity_violation',
        severity: 'error',
        message: 'Bunk Pine 3 is over capacity (9/8)',
        details: { bunk_name: 'Pine 3' },
      },
      {
        type: 'grade_ratio_warning',
        severity: 'warning',
        message: 'Bunk Pine 3 has 75.0% of campers from grade 6 (exceeds 50% limit)',
        details: { bunk_name: 'Pine 3' },
      },
      {
        type: 'age_spread_warning',
        severity: 'warning',
        message: 'Bunk Oak 2 has excessive age spread (26.0 months)',
        details: { bunk_name: 'Oak 2' },
      },
    ]
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={{ ...makeResults(), issues }}
      />
    )
    expect(screen.getByText(/bunks needing attention/i)).toBeInTheDocument()
    // Pine 3 appears in both the bunk row and the issues list — use getAllByText
    expect(screen.getAllByText(/Pine 3/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Oak 2/).length).toBeGreaterThan(0)
  })

  it('hides section when no bunk-level issues', () => {
    const issues = [{ type: 'unassigned_campers', severity: 'error', message: '2 unassigned' }]
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={{ ...makeResults(), issues }}
      />
    )
    // The "Other issues" subtitle mentions "Bunks needing attention" — use a
    // heading-role query to verify the Bunks section heading itself is absent.
    expect(
      screen.queryByRole('heading', { name: /bunks needing attention/i })
    ).not.toBeInTheDocument()
  })
})

describe('PostValidationResultsModal — Other issues residual', () => {
  it('hides suppressed types and renders only residual camper-level types', () => {
    const issues = [
      { type: 'valid_negative_request_violated', severity: 'error', message: 'X separated' },
      { type: 'unassigned_campers', severity: 'error', message: '2 unassigned' },
      { type: 'no_requests', severity: 'warning', message: 'Liam got nothing' },
      { type: 'level_regression', severity: 'warning', message: 'Samuel regressed' },
      { type: 'valid_request_unsatisfied', severity: 'warning', message: 'Emma unmet' },
    ]
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={{ ...makeResults(), issues }}
      />
    )
    expect(screen.getByText(/other issues/i)).toBeInTheDocument()
    expect(screen.getByText(/unassigned campers/i)).toBeInTheDocument()
    expect(screen.getByText(/level regression/i)).toBeInTheDocument()
    // Suppressed types absent (their typeLabels via getIssueTypeLabel):
    // valid_negative_request_violated → "Valid Negative Request Violated"
    expect(screen.queryByText(/valid negative request violated/i)).not.toBeInTheDocument()
    // no_requests → "No Requests"
    expect(screen.queryByText(/^no requests$/i)).not.toBeInTheDocument()
  })

  it('hides Other issues entirely when no residual issues', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
      />
    )
    expect(screen.queryByText(/^other issues$/i)).not.toBeInTheDocument()
  })
})

describe('PostValidationResultsModal — Families to contact', () => {
  it('combines impossibility, not-bunk-with violations, and priority unmet sorted by first name', () => {
    const impossibilityReport = makeImpossibilityReport({
      mp_campers_entirely_impossible: [
        {
          cm_id: 1001,
          name: 'Olivia Chen',
          grade: 4,
          gender: 'F',
          reason_codes: ['pair_no_shared_bunk'],
          session_cm_id: 1000001,
        },
        {
          cm_id: 1002,
          name: 'Emma Johnson',
          grade: 5,
          gender: 'F',
          reason_codes: ['grade_compatibility'],
          session_cm_id: 1000001,
        },
      ],
    })
    const stats = makeStats({
      negative_request_violations_detail: [
        {
          requester_cm_id: '1003',
          target_cm_id: '1004',
          requester_name: 'Riley Sam',
          target_name: 'Samuel Johnson',
          bunk_cm_id: '2001',
          bunk_name: 'Pine 3',
          session_cm_id: '1000001',
          requester_grade: 4,
        },
      ],
      priority_unsuccessfuls: [
        {
          requester_cm_id: '1005',
          target_cm_id: '1006',
          requester_name: 'Sophia Martinez',
          target_name: 'Mia Wilson',
          raw_text: 'top priority',
          session_cm_id: '1000001',
          requester_grade: 5,
        },
      ],
    })
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults(stats)}
        impossibilityReport={impossibilityReport}
      />
    )
    expect(screen.getByText(/families to contact/i)).toBeInTheDocument()
    // Rows are now flat divs with always-visible sub-lines (no expand toggle).
    // Verify grade-first ordering by DOM position of each name span.
    // Grades: Olivia=4, Riley=4, Emma=5, Sophia=5 → grade-first, name tiebreak
    const allText = document.body.textContent ?? ''
    const indexOf = (name: string) => allText.indexOf(name)
    // Grade 4 rows (Olivia, Riley) appear before grade 5 rows (Emma, Sophia)
    expect(indexOf('Olivia Chen')).toBeLessThan(indexOf('Emma Johnson'))
    expect(indexOf('Riley Sam')).toBeLessThan(indexOf('Emma Johnson'))
    expect(indexOf('Emma Johnson')).toBeLessThan(indexOf('Sophia Martinez'))
    expect(screen.getAllByText(/got nothing/i).length).toBe(2)
    expect(screen.getByText(/not-bunk-with violated/i)).toBeInTheDocument()
    expect(screen.getByText(/priority unmet/i)).toBeInTheDocument()
  })

  it('hides section when all three sources are empty', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
      />
    )
    expect(screen.queryByText(/families to contact/i)).not.toBeInTheDocument()
  })

  it('removes the old "Campers who got nothing", "Families to call", and "Priority unsuccessfuls" sections', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
      />
    )
    expect(screen.queryByText(/campers who got nothing/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/families to call/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/priority unsuccessfuls/i)).not.toBeInTheDocument()
  })
})

describe('PostValidationResultsModal — KPI tiles use MSP signal', () => {
  it('shows material parent satisfaction percentage when MP requests exist', () => {
    const stats = makeStats({
      material_parent_requests: 12,
      satisfied_material_parent_requests: 10,
      material_parent_request_satisfaction_rate: 0.83,
      total_requests: 50,
      satisfied_requests: 30,
      request_satisfaction_rate: 0.6,
    })
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults(stats)}
      />
    )
    expect(screen.getByText(/83\s*%/)).toBeInTheDocument()
  })
})

describe('PostValidationResultsModal — Impossible by reason kicker', () => {
  it('renders the "see Pre-Check or export PDF" kicker', () => {
    const impossibilityReport = makeImpossibilityReport({
      by_reason: {
        grade_compatibility: [
          {
            request_id: 'r1',
            reason_code: 'grade_compatibility',
            reason_message: 'wide',
            request_type: 'bunk_with',
            requester: { cm_id: 1, name: 'X', grade: 5, gender: 'F' },
            requestee: null,
            detail: {},
            bucket: null,
          },
        ],
      },
    })
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={impossibilityReport}
      />
    )
    expect(
      screen.getByText(/see Pre-Check or export PDF for full per-camper detail/i)
    ).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Bunks needing attention — pills inline next to bunk name, details always
// visible below (mirrors the families-to-contact style; chevrons removed).
// ---------------------------------------------------------------------------

describe('PostValidationResultsModal — bunk issue rows (always-visible details)', () => {
  const bunkIssues = [
    {
      type: 'capacity_violation',
      severity: 'error',
      message: 'Bunk Pine 3 is over capacity (9/8)',
      details: { bunk_name: 'Pine 3', assigned: 9, max_size: 8 },
    },
    {
      type: 'grade_ratio_warning',
      severity: 'warning',
      message: 'Bunk Pine 3 has 75.0% of campers from grade 5 (exceeds 67% limit)',
      details: {
        bunk_name: 'Pine 3',
        grade: 5,
        count: 6,
        total: 8,
        percentage: 75.0,
        max_allowed: 67,
        all_grades: { '5': 6, '4': 2 },
      },
    },
  ]

  it('shows chip labels inline and numeric detail lines without any expand', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={{
          statistics: makeStats(),
          issues: bunkIssues,
          validated_at: '2025-06-01T12:00:00Z',
        }}
      />
    )
    // Chip label and bunk name both visible
    expect(screen.getByText('Pine 3')).toBeInTheDocument()
    expect(screen.getByText(/capacity violation/i)).toBeInTheDocument()
    // Detail line visible immediately — no click needed
    expect(screen.getByText(/9.*8|1 over/i)).toBeInTheDocument()
  })

  it('age_spread detail shows months and limit (always visible)', () => {
    const issues = [
      {
        type: 'age_spread_warning',
        severity: 'warning',
        message: 'Bunk Oak 2 has excessive age spread (26.0 months)',
        details: { bunk_name: 'Oak 2', age_spread_months: 26, max_allowed: 24 },
      },
    ]
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={{ statistics: makeStats(), issues, validated_at: '2025-06-01T12:00:00Z' }}
      />
    )
    expect(screen.getByText(/26.*month|month.*26/i)).toBeInTheDocument()
    expect(screen.getByText(/24/)).toBeInTheDocument()
  })

  it('falls back to raw message when details are absent', () => {
    const issues = [
      {
        type: 'capacity_violation',
        severity: 'error',
        message: 'Bunk Maple 1 is over capacity',
      },
    ]
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={{ statistics: makeStats(), issues, validated_at: '2025-06-01T12:00:00Z' }}
      />
    )
    expect(screen.getByText('Bunk Maple 1 is over capacity')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Issue #1481 Item 2 — Sub-label section-aware breakdown
// ---------------------------------------------------------------------------

describe('PostValidationResultsModal — sub-label breakdown (#1481)', () => {
  it('shows "no issues to review" when issues list is empty', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          material_parent_requests: 0,
          satisfied_material_parent_requests: 0,
          material_parent_request_satisfaction_rate: 0,
          campers_with_unsatisfied_material_parent_requests: 0,
          request_satisfaction_rate: 0.5,
        })}
      />
    )
    // The "Needs Attention" tier is triggered by rate 0.5 — sub-label shows empty state
    expect(screen.getByText(/no issues to review/i)).toBeInTheDocument()
  })

  it('shows section-aware breakdown with families, bunks, and other counts', () => {
    // 1 family row (got_nothing camper), 1 bunk issue, 1 other issue
    const impossibilityReport = makeImpossibilityReport({
      mp_campers_entirely_impossible: [
        {
          cm_id: 1000001,
          name: 'Emma Johnson',
          grade: 5,
          gender: 'F',
          reason_codes: ['grade_compatibility'],
          session_cm_id: 1000001,
        },
      ],
      by_reason: {},
    })
    const issues = [
      {
        type: 'age_spread_warning',
        severity: 'warning',
        message: 'Bunk Oak 2 has excessive age spread (26.0 months)',
        details: { bunk_name: 'Oak 2', age_spread_months: 26, max_allowed: 24 },
      },
      {
        type: 'unassigned_camper',
        severity: 'error',
        message: 'Liam Garcia is not assigned to any bunk',
      },
    ]
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={{
          statistics: makeStats({
            request_satisfaction_rate: 0.5,
            material_parent_requests: 0,
            satisfied_material_parent_requests: 0,
            material_parent_request_satisfaction_rate: 0,
            campers_with_unsatisfied_material_parent_requests: 0,
          }),
          issues,
          validated_at: '2025-06-01T12:00:00Z',
        }}
        impossibilityReport={impossibilityReport}
      />
    )
    // Sub-label is in the header <p class="text-muted-foreground text-sm">
    // It should contain sections for family/bunk separated by "·"
    const sublabelMatches = screen.getAllByText(/famil.*bunk|bunk.*famil/i)
    expect(sublabelMatches.length).toBeGreaterThanOrEqual(1)
  })

  it('omits zero-count sections from breakdown', () => {
    // Only bunk issues — no family rows, no other issues
    const issues = [
      {
        type: 'age_spread_warning',
        severity: 'warning',
        message: 'Bunk Oak 2 has excessive age spread (26.0 months)',
        details: { bunk_name: 'Oak 2', age_spread_months: 26, max_allowed: 24 },
      },
    ]
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={{
          statistics: makeStats({
            request_satisfaction_rate: 0.5,
            material_parent_requests: 0,
            satisfied_material_parent_requests: 0,
            material_parent_request_satisfaction_rate: 0,
            campers_with_unsatisfied_material_parent_requests: 0,
          }),
          issues,
          validated_at: '2025-06-01T12:00:00Z',
        }}
      />
    )
    // "0 families" or "0 other" should NOT appear
    expect(screen.queryByText(/0 famil/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/0 other/i)).not.toBeInTheDocument()
    // "1 bunk" should appear somewhere in the document (the sub-label)
    const bunkMatches = screen.getAllByText(/1 bunk/i)
    expect(bunkMatches.length).toBeGreaterThanOrEqual(1)
  })

  it('does not show raw issues.length as the sub-label', () => {
    const issues = [
      {
        type: 'capacity_violation',
        severity: 'error',
        message: 'Bunk Pine 3 is over capacity',
        details: { bunk_name: 'Pine 3', assigned: 9, max_size: 8 },
      },
      {
        type: 'age_spread_warning',
        severity: 'warning',
        message: 'Bunk Oak 2 has excessive age spread',
        details: { bunk_name: 'Oak 2', age_spread_months: 26, max_allowed: 24 },
      },
    ]
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={{
          statistics: makeStats({
            request_satisfaction_rate: 0.5,
            material_parent_requests: 0,
            satisfied_material_parent_requests: 0,
            material_parent_request_satisfaction_rate: 0,
            campers_with_unsatisfied_material_parent_requests: 0,
          }),
          issues,
          validated_at: '2025-06-01T12:00:00Z',
        }}
      />
    )
    // The old label "2 issues to review" should not appear
    expect(screen.queryByText(/2 issues? to review/i)).not.toBeInTheDocument()
  })

  it('uses singular "other issue" when otherCount === 1', () => {
    // One non-bunk issue → should render "1 other issue", not "1 other issues"
    const issues = [
      {
        type: 'unassigned_camper',
        severity: 'error',
        message: 'Liam Garcia is not assigned to any bunk',
      },
    ]
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={{
          statistics: makeStats({
            request_satisfaction_rate: 0.5,
            material_parent_requests: 0,
            satisfied_material_parent_requests: 0,
            material_parent_request_satisfaction_rate: 0,
            campers_with_unsatisfied_material_parent_requests: 0,
          }),
          issues,
          validated_at: '2025-06-01T12:00:00Z',
        }}
      />
    )
    expect(screen.getAllByText(/1 other issue(?!s)/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/1 other issues/i)).not.toBeInTheDocument()
  })

  it('uses plural "other issues" when otherCount > 1', () => {
    // Two non-bunk issues → should render "2 other issues", not "2 other"
    const issues = [
      {
        type: 'unassigned_camper',
        severity: 'error',
        message: 'Liam Garcia is not assigned to any bunk',
      },
      {
        type: 'unassigned_camper',
        severity: 'error',
        message: 'Olivia Chen is not assigned to any bunk',
      },
    ]
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={{
          statistics: makeStats({
            request_satisfaction_rate: 0.5,
            material_parent_requests: 0,
            satisfied_material_parent_requests: 0,
            material_parent_request_satisfaction_rate: 0,
            campers_with_unsatisfied_material_parent_requests: 0,
          }),
          issues,
          validated_at: '2025-06-01T12:00:00Z',
        }}
      />
    )
    expect(screen.getAllByText(/2 other issues/i).length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Task 11 — Always-visible flat family rows (Group 65 #1540)
// ---------------------------------------------------------------------------

describe('PostValidationResultsModal — flat family rows (Task 11)', () => {
  it('multi-enrolled camper renders one name row with always-visible sub-lines', () => {
    // Emma Johnson appears in two sessions — should collapse to a single name row.
    // Sub-rows are always visible (no expand needed).
    const impossibilityReport = makeImpossibilityReport({
      mp_campers_entirely_impossible: [
        {
          cm_id: 1,
          name: 'Emma Johnson',
          grade: 4,
          gender: 'F',
          reason_codes: ['cross_session'],
          session_cm_id: 1000001,
        },
        {
          cm_id: 1,
          name: 'Emma Johnson',
          grade: 4,
          gender: 'F',
          reason_codes: ['grade_compatibility'],
          session_cm_id: 1000003,
        },
      ],
    })
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={impossibilityReport}
      />
    )
    // One name row per (camper, cohort), not per session entry
    expect(screen.getAllByText('Emma Johnson')).toHaveLength(1)
    // No expand toggle or chevron buttons for family rows
    expect(screen.queryByTestId(/^family-expand-toggle-/)).toBeNull()
    // Session-tag labels (e.g. "S0001") should NOT appear
    expect(screen.queryByText(/^S\d{4,}/)).toBeNull()
  })

  it('sub-rows are always visible without any click (no expand needed)', () => {
    const impossibilityReport = makeImpossibilityReport({
      mp_campers_entirely_impossible: [
        {
          cm_id: 1,
          name: 'Emma Johnson',
          grade: 4,
          gender: 'F',
          reason_codes: ['cross_session'],
          session_cm_id: 1000001,
        },
        {
          cm_id: 1,
          name: 'Emma Johnson',
          grade: 4,
          gender: 'F',
          reason_codes: ['grade_compatibility'],
          session_cm_id: 1000003,
        },
      ],
    })
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={impossibilityReport}
      />
    )
    // Sub-rows visible immediately — no click required
    const subRows = screen.getAllByTestId(/^family-subrow-/)
    expect(subRows.length).toBe(2)
    // Both detail lines rendered
    subRows.forEach((el) => {
      expect(el.textContent).toBeTruthy()
    })
  })

  it('sublabel counts distinct campers, not (camper, cohort) tuples', () => {
    // One camper appears in both 'got_nothing' (two sessions) and 'violated':
    // got_nothing = 1 (camper, cohort) tuple; 1 distinct camper; 1 family to contact
    const impossibilityReport = makeImpossibilityReport({
      mp_campers_entirely_impossible: [
        {
          cm_id: 99,
          name: 'Liam Garcia',
          grade: 5,
          gender: 'M',
          reason_codes: ['cross_session'],
          session_cm_id: 1000001,
        },
        {
          cm_id: 99,
          name: 'Liam Garcia',
          grade: 5,
          gender: 'M',
          reason_codes: ['cross_session'],
          session_cm_id: 1000002,
        },
      ],
    })
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={impossibilityReport}
      />
    )
    // 1 distinct camper (Liam) → "1 follow-up call recommended"
    expect(screen.getByText(/1 follow-up call recommended/i)).toBeInTheDocument()
    expect(screen.queryByText(/2 follow-up call/i)).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Task 16 — "Open in popout" button
// ---------------------------------------------------------------------------

describe('PostValidationResultsModal — Open in popout button (Task 16)', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  it('clicking "Open in popout" calls window.open with the friendly URL including scenario', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        scenarioId="abc"
        sessionName="Session 2"
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /open in popout/i }))
    expect(openSpy).toHaveBeenCalledWith(
      '/session/2/post-check?scenario=abc',
      'post-check',
      expect.stringMatching(/width=\d+/)
    )
    openSpy.mockRestore()
  })

  it('falls back to cm_id in URL when no sessionName is provided', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        scenarioId="abc"
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /open in popout/i }))
    expect(openSpy).toHaveBeenCalledWith(
      '/session/1000001/post-check?scenario=abc',
      'post-check',
      expect.stringMatching(/width=\d+/)
    )
    openSpy.mockRestore()
  })

  it('falls back to same-tab nav + toast when popup is blocked', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '')
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        sessionName="Session 2"
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /open in popout/i }))
    expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/popup blocked/i))
    expect(mockNavigate).toHaveBeenCalledWith('/session/2/post-check')
    openSpy.mockRestore()
    toastSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Bug regression — multiple not_bunk_with violations in same session for same
// camper must show DISTINCT target names, not repeat the first one.
// ---------------------------------------------------------------------------

describe('PostValidationResultsModal — violated sub-rows show distinct targets (#multi-violated)', () => {
  it('shows all three distinct target names when one camper has three violations in the same session', () => {
    // Emma Johnson violated not_bunk_with against three different campers,
    // all in session 1000001.  The old .find() bug returned the first match
    // (Liam Garcia) for every sub-row, so Olivia Chen and Noah Williams never
    // appeared.
    const stats = makeStats({
      negative_request_violations_detail: [
        {
          requester_cm_id: '5001',
          target_cm_id: '5002',
          requester_name: 'Emma Johnson',
          target_name: 'Liam Garcia',
          bunk_cm_id: '9001',
          bunk_name: 'g9',
          session_cm_id: '1000001',
          requester_grade: 5,
        },
        {
          requester_cm_id: '5001',
          target_cm_id: '5003',
          requester_name: 'Emma Johnson',
          target_name: 'Olivia Chen',
          bunk_cm_id: '9002',
          bunk_name: 'g10',
          session_cm_id: '1000001',
          requester_grade: 5,
        },
        {
          requester_cm_id: '5001',
          target_cm_id: '5004',
          requester_name: 'Emma Johnson',
          target_name: 'Noah Williams',
          bunk_cm_id: '9003',
          bunk_name: 'g11',
          session_cm_id: '1000001',
          requester_grade: 5,
        },
      ],
    })

    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults(stats)}
      />
    )

    // Confirm the three sub-rows are distinct (the bug repeated the first name).
    const subRows = screen.getAllByTestId(/^family-subrow-5001-violated/)
    expect(subRows).toHaveLength(3)
    const texts = subRows.map((el) => el.textContent ?? '')

    // All three distinct targets must appear across the three sub-rows.
    expect(texts.some((t) => t.includes('Liam Garcia'))).toBe(true)
    expect(texts.some((t) => t.includes('Olivia Chen'))).toBe(true)
    expect(texts.some((t) => t.includes('Noah Williams'))).toBe(true)

    // Each sub-row must mention a DIFFERENT target (the bug showed Liam 3×).
    expect(texts[0]).toMatch(/Liam Garcia/)
    expect(texts[1]).toMatch(/Olivia Chen/)
    expect(texts[2]).toMatch(/Noah Williams/)

    // No target should repeat across all three rows
    const uniqueTargetMentions = new Set(
      ['Liam Garcia', 'Olivia Chen', 'Noah Williams'].filter((name) =>
        texts.some((t) => t.includes(name))
      )
    )
    expect(uniqueTargetMentions.size).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Task: handleCamperClick — popout mode vs normal modal mode
// ---------------------------------------------------------------------------

describe('PostValidationResultsModal — background refresh indicator (#1635 scan #4)', () => {
  it('shows a refreshing indicator while a background refetch is in flight', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        isRefreshing={true}
      />
    )
    expect(screen.getByTestId('postcheck-refreshing')).toBeInTheDocument()
  })

  it('does not show the refreshing indicator when not refetching', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        isRefreshing={false}
      />
    )
    expect(screen.queryByTestId('postcheck-refreshing')).not.toBeInTheDocument()
  })
})

describe('PostValidationResultsModal — handleCamperClick behavior', () => {
  // Reset pathname after each test so subsequent describe blocks always start
  // in normal-modal (non-popout) mode.
  afterEach(() => {
    mockLocationPathname = '/session/1000001/bunking'
  })

  it('popout mode: clicking camper name opens /camper/<cm_id>/popout?session=<sessionCmId> in a new window', () => {
    // Simulate we're inside the popout route (/post-check path)
    mockLocationPathname = '/session/2/post-check'

    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window)

    const stats = makeStats({
      negative_request_violations_detail: [
        {
          requester_cm_id: '1001',
          target_cm_id: '1002',
          requester_name: 'Emma Johnson',
          target_name: 'Liam Garcia',
          bunk_cm_id: '2001',
          bunk_name: 'Pine 3',
          session_cm_id: '1000001',
          requester_grade: 5,
        },
      ],
    })

    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults(stats)}
      />
    )

    // Click the camper name in "Families to contact" list
    const camperSpan = screen.getByText('Emma Johnson')
    camperSpan.click()

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('/camper/1001/popout?session=1000001'),
      expect.stringContaining('camper-1001'),
      expect.any(String)
    )
    // Should NOT call setSelectedCamperId (no slide-in panel in popout mode)
    expect(screen.queryByTestId('camper-details-panel')).not.toBeInTheDocument()

    openSpy.mockRestore()
  })

  it('normal modal mode: clicking camper name sets selectedCamperId (slide-in path, no window.open)', async () => {
    // useLocation defaults to '/session/1000001/bunking' (NOT a popout route)
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window)

    const { makeImpossibilityReport: mir } = await import('../test/impossibilityReport')
    const report = mir({
      mp_campers_entirely_impossible: [
        {
          cm_id: 42,
          name: 'Olivia Chen',
          grade: 6,
          gender: 'F' as const,
          reason_codes: ['cross_session'],
          session_cm_id: 1000001,
        },
      ],
    })

    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={report}
      />
    )

    const camperSpan = screen.getByText('Olivia Chen')
    camperSpan.click()

    // Slide-in panel should appear (setSelectedCamperId was called)
    expect(await screen.findByTestId('camper-details-panel')).toHaveAttribute(
      'data-camper-id',
      '42'
    )
    // window.open must NOT be called in normal modal mode
    expect(openSpy).not.toHaveBeenCalled()

    openSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// #1631 — Camper-level coverage tiles
// ---------------------------------------------------------------------------

describe('PostValidationResultsModal — camper coverage tiles (#1631)', () => {
  it('renders "got ≥1 request" tile with mp_campers_with_at_least_one_satisfied / mp_campers_total', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          mp_campers_total: 40,
          mp_campers_with_at_least_one_satisfied: 35,
          mp_campers_with_all_satisfied: 28,
        })}
      />
    )
    // Label
    expect(screen.getByText(/got ≥1 request/i)).toBeInTheDocument()
    // Value fraction
    expect(screen.getByText('35/40')).toBeInTheDocument()
  })

  it('renders "got all requests" tile with mp_campers_with_all_satisfied / mp_campers_total', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          mp_campers_total: 40,
          mp_campers_with_at_least_one_satisfied: 35,
          mp_campers_with_all_satisfied: 28,
        })}
      />
    )
    // Label
    expect(screen.getByText(/got all requests/i)).toBeInTheDocument()
    // Value fraction
    expect(screen.getByText('28/40')).toBeInTheDocument()
  })

  it('does NOT render the removed "parent requests met" tile', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          material_parent_requests: 30,
          satisfied_material_parent_requests: 18,
          material_parent_request_satisfaction_rate: 0.6,
          mp_campers_total: 40,
          mp_campers_with_at_least_one_satisfied: 35,
          mp_campers_with_all_satisfied: 28,
        })}
      />
    )
    expect(screen.queryByText(/parent requests met/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^requests met$/i)).not.toBeInTheDocument()
  })

  it('does NOT render the removed "bunks used" tile', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          bunks_at_capacity: 3,
          bunks_under_capacity: 1,
          bunks_over_capacity: 0,
          mp_campers_total: 40,
          mp_campers_with_at_least_one_satisfied: 35,
          mp_campers_with_all_satisfied: 28,
        })}
      />
    )
    expect(screen.queryByText(/bunks used/i)).not.toBeInTheDocument()
  })

  it('tile row-major order: got≥1 · got-all (row 1), assigned · issues (row 2)', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          mp_campers_total: 40,
          mp_campers_with_at_least_one_satisfied: 35,
          mp_campers_with_all_satisfied: 28,
        })}
      />
    )
    const allText = document.body.textContent ?? ''
    const pos = (s: string) => allText.indexOf(s)

    // Row 1: got≥1 before got-all
    expect(pos('got ≥1 request')).toBeLessThan(pos('got all requests'))
    // Row 1 before row 2
    expect(pos('got ≥1 request')).toBeLessThan(pos('assigned'))
    expect(pos('got all requests')).toBeLessThan(pos('assigned'))
    // assigned before issues
    expect(pos('assigned')).toBeLessThan(pos('issues'))
  })

  it('renders 0/0 without crashing when mp_campers_total is 0', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          mp_campers_total: 0,
          mp_campers_with_at_least_one_satisfied: 0,
          mp_campers_with_all_satisfied: 0,
        })}
      />
    )
    // Both tiles should render 0/0 without crashing or showing NaN/%
    const zeroDivZero = screen.getAllByText('0/0')
    expect(zeroDivZero.length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
  })

  it('renders 0/0 when mp_campers fields are absent from statistics (backward compat)', () => {
    // Old validator responses may not include these fields — must degrade gracefully.
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({})}
      />
    )
    // Fields are undefined → treat as 0/0
    const zeroDivZero = screen.getAllByText('0/0')
    expect(zeroDivZero.length).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Task 5 — honored-anyway subtext
// ---------------------------------------------------------------------------

describe('PostValidationResultsModal — honored subtext (Task 5)', () => {
  it('renders "met by the final cabin anyway" subtext for honored camper instead of "All requests impossible"', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          mp_campers_entirely_impossible: [
            {
              cm_id: 21012687,
              name: 'Samuel Johnson',
              grade: 10,
              gender: 'M',
              session_cm_id: 1235404,
              reason_codes: ['age_pref_no_eligible_grade'],
              honored_in_plan: true,
              bunk_name: 'Redwood 4',
            },
          ],
        })}
      />
    )
    expect(screen.getByText(/met by same age cabin/i)).toBeInTheDocument()
    expect(screen.getByText('Redwood 4')).toBeInTheDocument()
    expect(screen.queryByText(/All requests impossible/i)).not.toBeInTheDocument()
  })
})
