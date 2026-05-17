/**
 * TDD render tests for PostValidationResultsModal — Stage 3a / 3b.2
 *
 * Stage 3a: added material_parent_* and best_effort_parent_* field consumption.
 * Stage 3b.2: removed best-effort one-liner; modal now drives banner, donut,
 *   status tier, and stats tile from material parent satisfaction rate.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'

import PostValidationResultsModal from './PostValidationResultsModal'
import { makeImpossibilityReport } from '../test/impossibilityReport'
import type { EntirelyImpossibleMpCamper } from '../services/solver'

// Stub out AuthContext so tests don't need a real AuthProvider
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { name: 'Test User' } }),
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
  it('renders parent-only fraction in the second stats tile', () => {
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

    expect(screen.getByText('18/30')).toBeInTheDocument()
    expect(screen.getByText(/parent requests met/i)).toBeInTheDocument()
    // Should NOT show the all-up "27/30" anywhere
    expect(screen.queryByText('27/30')).not.toBeInTheDocument()
  })

  it('uses amber styling on the parent tile when rate < 0.85', () => {
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

    // Find the parent tile by its caption, walk up to the tile container,
    // and assert it has amber-toned classes.
    const caption = screen.getByText(/parent requests met/i)
    const tile = caption.closest('.flex.items-center')
    expect(tile).not.toBeNull()
    // Amber icon-background class should be present in the tile
    expect(tile!.querySelector('.bg-amber-500\\/10')).not.toBeNull()
  })

  it('uses green styling on the parent tile when rate >= 0.85', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          material_parent_requests: 20,
          satisfied_material_parent_requests: 18,
          material_parent_request_satisfaction_rate: 0.9,
          campers_with_unsatisfied_material_parent_requests: 0,
        })}
      />
    )

    const caption = screen.getByText(/parent requests met/i)
    const tile = caption.closest('.flex.items-center')
    expect(tile).not.toBeNull()
    expect(tile!.querySelector('.bg-forest-500\\/10')).not.toBeNull()
    expect(tile!.querySelector('.bg-amber-500\\/10')).toBeNull()
  })

  it('falls back to all-up fraction when zero material parent requests', () => {
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

    // No parent requests this session — show "18/20" with the original
    // "requests met" caption (graceful degradation).
    expect(screen.getByText('18/20')).toBeInTheDocument()
    expect(screen.getByText(/^requests met$/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// #1105: Unmet parent requests drill-down section
// ---------------------------------------------------------------------------

describe('PostValidationResultsModal — unmet parent requests drill-down (#1105)', () => {
  it('shows no drill-down section when unsatisfied_material_parent_persons is absent', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
      />
    )

    expect(screen.queryByText(/unmet parent requests/i)).not.toBeInTheDocument()
  })

  it('shows no drill-down section when unsatisfied_material_parent_persons is empty', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({ unsatisfied_material_parent_persons: [] })}
      />
    )

    expect(screen.queryByText(/unmet parent requests/i)).not.toBeInTheDocument()
  })

  it('shows collapsible drill-down section with count when unsatisfied persons present', () => {
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
        })}
      />
    )

    // Pin both the literal label and the rendered count.
    expect(screen.getByText('Unmet parent requests (2)')).toBeInTheDocument()
  })

  it('shows camper names after expanding the drill-down section', async () => {
    const user = userEvent.setup()
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
        })}
      />
    )

    // Names should not be visible before expanding
    expect(screen.queryByText('Emma Johnson')).not.toBeInTheDocument()
    expect(screen.queryByText('Liam Garcia')).not.toBeInTheDocument()

    // Click to expand
    await user.click(screen.getByText(/unmet parent requests/i))

    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
  })

  it('exposes disclosure state via aria-expanded and aria-controls (#1169 review)', async () => {
    const user = userEvent.setup()
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          unsatisfied_material_parent_persons: [{ cm_id: 1000001, name: 'Emma Johnson' }],
        })}
      />
    )

    const toggle = screen.getByRole('button', { name: /unmet parent requests/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const controlsId = toggle.getAttribute('aria-controls')
    expect(controlsId).toBeTruthy()

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    // The controlled list element should now exist with the matching id.
    expect(document.getElementById(controlsId as string)).not.toBeNull()
  })
})

vi.mock('./CamperDetailsPanel', () => ({
  default: ({ camperId, onClose }: { camperId: string; onClose: () => void }) => (
    <div data-testid="camper-details-panel" data-camper-id={camperId} onClick={onClose} />
  ),
}))

// ---------------------------------------------------------------------------
// Task 4.3 — "Campers who got nothing" section
// ---------------------------------------------------------------------------

describe('PostValidationResultsModal — Campers who got nothing section (TG-4.3)', () => {
  it('renders named tiles for entirely-impossible MP campers', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={makeImpossibilityReport({
          mp_campers_entirely_impossible: [
            { cm_id: 1001, name: 'Emma Johnson', gender: 'Girls', grade: 7, reason_codes: [] },
            { cm_id: 1002, name: 'Liam Garcia', gender: 'Boys', grade: 4, reason_codes: [] },
          ],
        })}
      />
    )
    expect(screen.getByText('Campers who got nothing')).toBeInTheDocument()
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
  })

  it('does not render "Campers who got nothing" when the list is empty', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={makeImpossibilityReport({ mp_campers_entirely_impossible: [] })}
      />
    )
    expect(screen.queryByText('Campers who got nothing')).not.toBeInTheDocument()
  })

  it('does not render "Campers who got nothing" when impossibilityReport is absent', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
      />
    )
    expect(screen.queryByText('Campers who got nothing')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Task 4.4 — "Families to call" section
// ---------------------------------------------------------------------------

describe('PostValidationResultsModal — Families to call section (TG-4.4)', () => {
  it('renders Families to call list with named rows for not_bunk_with violations', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          negative_request_violations_detail: [
            {
              requester_cm_id: '1003',
              target_cm_id: '1004',
              requester_name: 'Riley Sam',
              target_name: 'Samuel Johnson',
              bunk_cm_id: '2003',
              bunk_name: 'Pine 3',
            },
          ],
        })}
      />
    )
    expect(screen.getByText('Families to call')).toBeInTheDocument()
    expect(screen.getByText('Riley Sam')).toBeInTheDocument()
    expect(screen.getByText('Samuel Johnson')).toBeInTheDocument()
    expect(screen.getByText('Pine 3')).toBeInTheDocument()
  })

  it('does not render "Families to call" when negative_request_violations_detail is absent', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
      />
    )
    expect(screen.queryByText('Families to call')).not.toBeInTheDocument()
  })

  it('does not render "Families to call" when negative_request_violations_detail is empty', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({ negative_request_violations_detail: [] })}
      />
    )
    expect(screen.queryByText('Families to call')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Task 4.5 — "Priority unsuccessfuls" section
// ---------------------------------------------------------------------------

describe('PostValidationResultsModal — Priority unsuccessfuls section (TG-4.5)', () => {
  it('renders Priority unsuccessfuls with parent wording snippets', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          priority_unsuccessfuls: [
            {
              requester_cm_id: '1005',
              target_cm_id: '1006',
              requester_name: 'Sophia Martinez',
              target_name: 'Mia Wilson',
              raw_text: 'Mia is our top priority',
            },
          ],
        })}
      />
    )
    expect(screen.getByText('Priority unsuccessfuls')).toBeInTheDocument()
    expect(screen.getByText('Sophia Martinez')).toBeInTheDocument()
    expect(screen.getByText('Mia Wilson')).toBeInTheDocument()
    expect(screen.getByText(/Mia is our top priority/)).toBeInTheDocument()
  })

  it('does not render "Priority unsuccessfuls" when the list is absent', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
      />
    )
    expect(screen.queryByText('Priority unsuccessfuls')).not.toBeInTheDocument()
  })

  it('does not render "Priority unsuccessfuls" when the list is empty', () => {
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults({ priority_unsuccessfuls: [] })}
      />
    )
    expect(screen.queryByText('Priority unsuccessfuls')).not.toBeInTheDocument()
  })
})

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

  it('renders camper count and total impossible request count as separate, independent texts', () => {
    // The camper count is "entirely-impossible MP campers" (zero parent reqs
    // honored), while total_impossible spans ALL impossible requests in the
    // scenario (including partially-impossible kids not named here). Combining
    // them into "X campers had Y impossible requests" implies the Y belong to
    // the X, which is wrong. Render them as two distinct statements.
    const report = makeReport(
      [
        { cm_id: 1, name: 'Emma Johnson', grade: 5, gender: 'F', reason_codes: ['cross_session'] },
        { cm_id: 2, name: 'Liam Garcia', grade: 5, gender: 'M', reason_codes: ['malformed'] },
        {
          cm_id: 3,
          name: 'Olivia Chen',
          grade: 6,
          gender: 'F',
          reason_codes: ['grade_compatibility'],
        },
      ],
      5
    )
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={report}
      />
    )

    // Primary line: how many campers got zero parent requests honored.
    expect(
      screen.getByText(/3 campers won['’]t get any parent request fulfilled/i)
    ).toBeInTheDocument()
    // Secondary line: scenario-wide impossible request count, labeled as a
    // separate fact (not "they had Y").
    expect(screen.getByText(/5 impossible requests total in this scenario/i)).toBeInTheDocument()
    // Guard against the misleading combined phrasing.
    expect(screen.queryByText(/3 campers had 5 impossible requests/i)).not.toBeInTheDocument()
  })

  it('uses singular grammar when only one camper and one impossible request', () => {
    const report = makeReport(
      [{ cm_id: 1, name: 'Emma Johnson', grade: 5, gender: 'F', reason_codes: ['malformed'] }],
      1
    )
    render(
      <PostValidationResultsModal
        sessionCmId={1000001}
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={report}
      />
    )

    expect(
      screen.getByText(/1 camper won['’]t get any parent request fulfilled/i)
    ).toBeInTheDocument()
    expect(screen.queryByText(/1 campers/i)).not.toBeInTheDocument()
    expect(screen.getByText(/1 impossible request total in this scenario/i)).toBeInTheDocument()
    expect(screen.queryByText(/1 impossible requests/i)).not.toBeInTheDocument()
  })

  it('opens the panel when a camper name in the section is clicked', async () => {
    const report = makeReport([
      { cm_id: 42, name: 'Olivia Chen', grade: 6, gender: 'F', reason_codes: ['cross_session'] },
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
    await user.click(screen.getByRole('button', { name: /Olivia Chen/ }))
    expect(await screen.findByTestId('camper-details-panel')).toHaveAttribute(
      'data-camper-id',
      '42'
    )
  })

  it('wraps CamperDetailsPanel in a session-scoped BunkRequestProvider (#1464 regression)', async () => {
    const report = makeReport([
      { cm_id: 42, name: 'Olivia Chen', grade: 6, gender: 'F', reason_codes: ['cross_session'] },
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
    await user.click(screen.getByRole('button', { name: /Olivia Chen/ }))
    const provider = await screen.findByTestId('bunk-request-provider')
    expect(provider).toHaveAttribute('data-session-cm-id', '9876543')
    expect(provider).toContainElement(screen.getByTestId('camper-details-panel'))
  })

  it('renders the per-camper hint from REASON_HINTS', () => {
    const report = makeReport([
      {
        cm_id: 7,
        name: 'Samuel Johnson',
        grade: 5,
        gender: 'M',
        reason_codes: ['cross_session'],
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
    expect(
      screen.getByText(/requested friend is in a different session — confirm intent/)
    ).toBeInTheDocument()
  })

  // Scan-it row 1: post-check used to render snake_case reason codes
  // directly; pre-check has always run them through FRIENDLY_REASON_LABELS.
  it('renders reason chips with the friendly label, not the raw snake_case code', () => {
    const report = makeReport([
      {
        cm_id: 8,
        name: 'Liam Garcia',
        grade: 4,
        gender: 'M',
        reason_codes: ['grade_compatibility'],
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
    expect(screen.getByText('Grade range too wide')).toBeInTheDocument()
    expect(screen.queryByText('grade_compatibility')).not.toBeInTheDocument()
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
      { cm_id: 99, name: 'Riley Sam', grade: 5, gender: 'F', reason_codes: ['cross_session'] },
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
    await user.click(screen.getByRole('button', { name: /Riley Sam/ }))
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
