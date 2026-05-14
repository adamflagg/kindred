// frontend/src/components/PreValidationResultsModal.test.tsx
import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import PreValidationResultsModal from './PreValidationResultsModal'

let mockAuthValue: { user: { is_admin: boolean } | null; isLoading: boolean } = {
  user: { is_admin: false },
  isLoading: false,
}

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}))

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

const twoImpossibleItems = {
  ...resultsWithImpossibility,
  impossibility_report: {
    total_impossible: 2,
    affected_campers: 3,
    by_reason: {
      grade_compatibility: [oneImpossibleItem],
      cross_session: [
        {
          request_id: 'r2',
          reason_code: 'cross_session',
          reason_message: 'Different sessions',
          request_type: 'bunk_with',
          requester: { cm_id: 3, name: 'Olivia', grade: 4, gender: 'F' },
          requestee: { cm_id: 4, name: 'Ava', grade: 4, gender: 'F' },
          detail: { requester_session: 100, requestee_session: 101 },
        },
      ],
    },
    flat: [
      oneImpossibleItem,
      {
        request_id: 'r2',
        reason_code: 'cross_session',
        reason_message: 'Different sessions',
        request_type: 'bunk_with',
        requester: { cm_id: 3, name: 'Olivia', grade: 4, gender: 'F' },
        requestee: { cm_id: 4, name: 'Ava', grade: 4, gender: 'F' },
        detail: { requester_session: 100, requestee_session: 101 },
      },
    ],
    clusters: [],
  },
}

describe('PreValidationResultsModal — staff view', () => {
  beforeEach(() => {
    mockAuthValue = { user: { is_admin: false }, isLoading: false }
  })

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

  it('does not show admin tab strip for non-admin users', () => {
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

  it('does not render reason codes for non-admin users', () => {
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

  it('renders staff impossibility section only once in the DOM (no duplicate)', () => {
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

describe('PreValidationResultsModal — admin tabbed view', () => {
  beforeEach(() => {
    mockAuthValue = { user: { is_admin: true }, isLoading: false }
  })

  it('renders three tabs: By reason, Flat table, JSON', () => {
    render(
      <PreValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={resultsWithImpossibility}
        sessionId="100"
      />
    )
    expect(screen.getByRole('tab', { name: /by reason/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /flat table/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /json/i })).toBeInTheDocument()
  })

  it('By reason tab is selected by default', () => {
    render(
      <PreValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={resultsWithImpossibility}
        sessionId="100"
      />
    )
    expect(screen.getByRole('tab', { name: /by reason/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('By reason tab shows per-reason tables with reason code, compact tuples, and detail', () => {
    render(
      <PreValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={resultsWithImpossibility}
        sessionId="100"
      />
    )
    expect(screen.getByText('grade_compatibility')).toBeInTheDocument()
    expect(screen.getByText('Pearl (1/g3/F)')).toBeInTheDocument()
    expect(screen.getByText('Riley (2/g5/F)')).toBeInTheDocument()
    expect(screen.getByText(/gap=2/)).toBeInTheDocument()
  })

  it('By reason tab shows technical reason description per group', () => {
    render(
      <PreValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={resultsWithImpossibility}
        sessionId="100"
      />
    )
    expect(screen.getByText(/pair_grade_gap/i)).toBeInTheDocument()
  })

  it('Flat table tab shows sortable columns and renders all rows', async () => {
    const user = userEvent.setup()
    render(
      <PreValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={twoImpossibleItems}
        sessionId="100"
      />
    )
    await user.click(screen.getByRole('tab', { name: /flat table/i }))

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /^name/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /cm.id/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /grade/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /gender/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /reason/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /detail/i })).toBeInTheDocument()

    const table = screen.getByRole('table')
    expect(within(table).getByText('Pearl')).toBeInTheDocument()
    expect(within(table).getByText('Olivia')).toBeInTheDocument()
  })

  it('Flat table sorting reverses row order when column header is clicked twice', async () => {
    const user = userEvent.setup()
    render(
      <PreValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={twoImpossibleItems}
        sessionId="100"
      />
    )
    await user.click(screen.getByRole('tab', { name: /flat table/i }))

    const nameHeader = screen.getByRole('columnheader', { name: /^name/i })
    await user.click(nameHeader)
    const rowsAfter1 = screen.getAllByRole('row').slice(1)
    const firstAfter1 = within(rowsAfter1[0]!).getByText(/^(Olivia|Pearl)$/).textContent

    await user.click(nameHeader)
    const rowsAfter2 = screen.getAllByRole('row').slice(1)
    const firstAfter2 = within(rowsAfter2[0]!).getByText(/^(Olivia|Pearl)$/).textContent

    expect(firstAfter1).not.toBe(firstAfter2)
  })

  it('JSON tab shows raw impossibility_report content', async () => {
    const user = userEvent.setup()
    render(
      <PreValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={resultsWithImpossibility}
        sessionId="100"
      />
    )
    await user.click(screen.getByRole('tab', { name: /json/i }))
    const pre = screen.getByTestId('impossibility-json')
    expect(pre.textContent).toContain('"total_impossible": 1')
    expect(pre.textContent).toContain('"reason_code": "grade_compatibility"')
    expect(pre.textContent).toContain('"cm_id": 1')
  })

  it('Cluster section lists component members with cm_id, grade, gender for admin', () => {
    const resultsWithCluster = {
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
        results={resultsWithCluster}
        sessionId="100"
      />
    )
    expect(screen.getByText('Pearl')).toBeInTheDocument()
    expect(screen.getByText('Riley')).toBeInTheDocument()
    expect(screen.getByText('Olivia')).toBeInTheDocument()
    expect(screen.getByText('Ava')).toBeInTheDocument()
  })

  it('renders admin impossibility section only once in the DOM (no duplicate)', () => {
    render(
      <PreValidationResultsModal
        isOpen={true}
        onClose={() => {}}
        results={resultsWithImpossibility}
        sessionId="100"
      />
    )
    const codeMatches = screen.getAllByText('grade_compatibility')
    expect(codeMatches).toHaveLength(1)
  })
})
