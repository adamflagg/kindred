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

describe('PreValidationResultsModal — staff view', () => {
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
              request_id: 'r1',
              reason_code: 'grade_compatibility',
              reason_message: 'span 2 grade levels',
              request_type: 'bunk_with',
              requester: { cm_id: 1, name: 'Pearl Szasz-Toth', grade: 3, gender: 'F' },
              requestee: { cm_id: 2, name: 'Riley Raines', grade: 5, gender: 'F' },
              detail: { gap: 2, max_gap_allowed: 1 },
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
    // Reason code should NOT appear in default (staff) view
    expect(screen.queryByText('grade_compatibility')).not.toBeInTheDocument()
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
})
