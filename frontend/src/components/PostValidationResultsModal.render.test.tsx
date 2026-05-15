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
    render(<PostValidationResultsModal isOpen={true} onClose={() => {}} results={makeResults()} />)

    expect(screen.queryByText(/best-effort preferences honored/i)).not.toBeInTheDocument()
  })

  it('does not render the best-effort one-liner when best_effort_parent_requests is 0', () => {
    render(
      <PostValidationResultsModal
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
    render(<PostValidationResultsModal isOpen={true} onClose={() => {}} results={makeResults()} />)

    expect(screen.queryByText(/unmet parent requests/i)).not.toBeInTheDocument()
  })

  it('shows no drill-down section when unsatisfied_material_parent_persons is empty', () => {
    render(
      <PostValidationResultsModal
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

describe('PostValidationResultsModal — impossibility section (#1442 part 2)', () => {
  const makeReport = (
    mp: Array<{
      cm_id: number
      name: string
      grade: number
      gender: string
      reason_codes: string[]
    }>,
    totalImpossible = mp.length
  ) => ({
    total_impossible: totalImpossible,
    affected_campers: mp.length,
    by_reason: {},
    flat: [],
    mp_campers_entirely_impossible: mp,
  })

  it('does not render the section when impossibilityReport prop is omitted', () => {
    render(<PostValidationResultsModal isOpen={true} onClose={() => {}} results={makeResults()} />)
    expect(screen.queryByText(/impossible request/i)).not.toBeInTheDocument()
  })

  it('does not render the section when mp_campers_entirely_impossible is empty', () => {
    render(
      <PostValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={
          makeReport([], 0) as unknown as import('../services/solver').ImpossibilityReport
        }
      />
    )
    expect(screen.queryByText(/impossible request/i)).not.toBeInTheDocument()
  })

  it('renders header with both camper and request counts', () => {
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
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={report as unknown as import('../services/solver').ImpossibilityReport}
      />
    )
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === 'P' &&
          (el.textContent ?? '').includes('3 campers had 5 impossible requests we couldn’t fulfill')
      )
    ).toBeInTheDocument()
  })

  it('opens the panel when a camper name in the section is clicked', async () => {
    const report = makeReport([
      { cm_id: 42, name: 'Olivia Chen', grade: 6, gender: 'F', reason_codes: ['cross_session'] },
    ])
    render(
      <PostValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={report as unknown as import('../services/solver').ImpossibilityReport}
      />
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Olivia Chen' }))
    expect(await screen.findByTestId('camper-details-panel')).toHaveAttribute(
      'data-camper-id',
      '42'
    )
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
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        impossibilityReport={report as unknown as import('../services/solver').ImpossibilityReport}
      />
    )
    expect(
      screen.getByText(/requested friend is in a different session — confirm intent/)
    ).toBeInTheDocument()
  })
})
