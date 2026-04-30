/**
 * TDD render tests for PostValidationResultsModal — Stage 3a
 *
 * Written FIRST (red phase) to verify new field consumption:
 *   - ValidationStatistics includes material_parent_* and best_effort_parent_* fields
 *   - Best-effort display line appears: "Best-effort preferences honored: X of Y"
 */

import { render, screen } from '@testing-library/react'
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

describe('PostValidationResultsModal — material_parent + best_effort fields', () => {
  it('renders best-effort preferences line showing X of Y', () => {
    render(
      <PostValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={makeResults()}
        sessionId="1000001"
      />
    )

    // Should display "Best-effort preferences honored: 5 of 8"
    expect(screen.getByText(/best-effort preferences honored/i)).toBeInTheDocument()
    expect(screen.getByText(/5 of 8/i)).toBeInTheDocument()
  })

  it('does not render best-effort line when best_effort_parent_requests is 0', () => {
    render(
      <PostValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={makeResults({
          best_effort_parent_requests: 0,
          satisfied_best_effort_parent_requests: 0,
        })}
        sessionId="1000001"
      />
    )

    expect(screen.queryByText(/best-effort preferences honored/i)).not.toBeInTheDocument()
  })
})
