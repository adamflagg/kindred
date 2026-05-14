// frontend/src/components/SolverDebugImpossibilityModal.test.tsx
import { render, screen, within, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import SolverDebugImpossibilityModal from './SolverDebugImpossibilityModal'

const emptyReport = {
  total_impossible: 0,
  affected_campers: 0,
  by_reason: {},
  flat: [],
  clusters: [],
}

const oneItem = {
  request_id: 'br_8e3fabcdef',
  reason_code: 'grade_compatibility',
  reason_message: 'Pearl and Riley span 2 grade levels',
  request_type: 'bunk_with',
  requester: { cm_id: 21001208, name: 'Pearl', grade: 3, gender: 'F' },
  requestee: { cm_id: 21004315, name: 'Riley', grade: 5, gender: 'F' },
  detail: { gap: 2, max_gap_allowed: 1 },
}

const twoItemReport = {
  total_impossible: 2,
  affected_campers: 3,
  by_reason: {
    grade_compatibility: [oneItem],
    cross_session: [
      {
        request_id: 'br_4b21abcdef',
        reason_code: 'cross_session',
        reason_message: 'Different sessions',
        request_type: 'bunk_with',
        requester: { cm_id: 21010234, name: 'Olivia', grade: 4, gender: 'F' },
        requestee: { cm_id: 21010567, name: 'Ava', grade: 4, gender: 'F' },
        detail: { requester_session: 100, requestee_session: 101 },
      },
    ],
  },
  flat: [
    oneItem,
    {
      request_id: 'br_4b21abcdef',
      reason_code: 'cross_session',
      reason_message: 'Different sessions',
      request_type: 'bunk_with',
      requester: { cm_id: 21010234, name: 'Olivia', grade: 4, gender: 'F' },
      requestee: { cm_id: 21010567, name: 'Ava', grade: 4, gender: 'F' },
      detail: { requester_session: 100, requestee_session: 101 },
    },
  ],
  clusters: [],
}

describe('SolverDebugImpossibilityModal — header', () => {
  it('renders metadata header with session, year, and report counts', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen={true}
        onClose={() => {}}
        report={twoItemReport}
        sessionCmId={1378702}
        year={2026}
      />
    )
    expect(screen.getByText(/Pre-validate.*session=1378702.*year=2026/)).toBeInTheDocument()
    expect(screen.getByText(/total=2.*affected_cms=3.*clusters=0/)).toBeInTheDocument()
  })

  it('renders an em-dash when sessionCmId is null', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen={true}
        onClose={() => {}}
        report={twoItemReport}
        sessionCmId={null}
        year={2026}
      />
    )
    expect(screen.getByText(/session=—/)).toBeInTheDocument()
  })
})

describe('SolverDebugImpossibilityModal — tabs', () => {
  it('renders three tabs: By reason / Flat table / JSON', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen={true}
        onClose={() => {}}
        report={twoItemReport}
        sessionCmId={1378702}
        year={2026}
      />
    )
    expect(screen.getByRole('tab', { name: /by reason/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /flat table/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /json/i })).toBeInTheDocument()
  })

  it('By reason is the default selected tab', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen={true}
        onClose={() => {}}
        report={twoItemReport}
        sessionCmId={1378702}
        year={2026}
      />
    )
    expect(screen.getByRole('tab', { name: /by reason/i })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('SolverDebugImpossibilityModal — By reason view', () => {
  it('renders reason_code as the group heading (no friendly label)', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen={true}
        onClose={() => {}}
        report={twoItemReport}
        sessionCmId={1378702}
        year={2026}
      />
    )
    expect(screen.getByText('grade_compatibility')).toBeInTheDocument()
    expect(screen.queryByText(/grade range too wide/i)).not.toBeInTheDocument()
  })

  it('renders technical reason description per group', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen={true}
        onClose={() => {}}
        report={twoItemReport}
        sessionCmId={1378702}
        year={2026}
      />
    )
    expect(screen.getByText(/pair_grade_gap/i)).toBeInTheDocument()
  })

  it('renders compact (name (cm_id/grade/gender)) tuples for requester and requestee', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen={true}
        onClose={() => {}}
        report={twoItemReport}
        sessionCmId={1378702}
        year={2026}
      />
    )
    expect(screen.getByText('Pearl (21001208/g3/F)')).toBeInTheDocument()
    expect(screen.getByText('Riley (21004315/g5/F)')).toBeInTheDocument()
  })

  it('renders compact detail (key=value, ...)', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen={true}
        onClose={() => {}}
        report={twoItemReport}
        sessionCmId={1378702}
        year={2026}
      />
    )
    expect(screen.getByText(/gap=2/)).toBeInTheDocument()
  })
})

describe('SolverDebugImpossibilityModal — Flat table view', () => {
  it('shows sortable columns + all rows when Flat table tab is active', async () => {
    const user = userEvent.setup()
    render(
      <SolverDebugImpossibilityModal
        isOpen={true}
        onClose={() => {}}
        report={twoItemReport}
        sessionCmId={1378702}
        year={2026}
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

  it('sorting reverses row order when column header is clicked twice', async () => {
    const user = userEvent.setup()
    render(
      <SolverDebugImpossibilityModal
        isOpen={true}
        onClose={() => {}}
        report={twoItemReport}
        sessionCmId={1378702}
        year={2026}
      />
    )
    await user.click(screen.getByRole('tab', { name: /flat table/i }))
    const nameHeader = screen.getByRole('columnheader', { name: /^name/i })
    await user.click(nameHeader)
    const firstAfter1 = within(screen.getAllByRole('row')[1]!).getByText(
      /^(Olivia|Pearl)$/
    ).textContent
    await user.click(nameHeader)
    const firstAfter2 = within(screen.getAllByRole('row')[1]!).getByText(
      /^(Olivia|Pearl)$/
    ).textContent
    expect(firstAfter1).not.toBe(firstAfter2)
  })
})

describe('SolverDebugImpossibilityModal — JSON view', () => {
  it('renders raw impossibility_report JSON', async () => {
    const user = userEvent.setup()
    render(
      <SolverDebugImpossibilityModal
        isOpen={true}
        onClose={() => {}}
        report={twoItemReport}
        sessionCmId={1378702}
        year={2026}
      />
    )
    await user.click(screen.getByRole('tab', { name: /json/i }))
    const pre = screen.getByTestId('impossibility-json')
    expect(pre.textContent).toContain('"total_impossible": 2')
    expect(pre.textContent).toContain('"reason_code": "grade_compatibility"')
    expect(pre.textContent).toContain('"cm_id": 21001208')
  })
})

describe('SolverDebugImpossibilityModal — empty state', () => {
  it('renders an empty-report banner and no tabs when report is empty', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen={true}
        onClose={() => {}}
        report={emptyReport}
        sessionCmId={1378702}
        year={2026}
      />
    )
    expect(screen.getByText(/impossibility_report empty/i)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /by reason/i })).not.toBeInTheDocument()
  })
})

describe('SolverDebugImpossibilityModal — clusters', () => {
  it('lists component members with compact tuples', () => {
    const reportWithCluster = {
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
    }
    render(
      <SolverDebugImpossibilityModal
        isOpen={true}
        onClose={() => {}}
        report={reportWithCluster}
        sessionCmId={1378702}
        year={2026}
      />
    )
    expect(screen.getByText('Pearl (1/g3/F)')).toBeInTheDocument()
    expect(screen.getByText('Ava (4/g7/F)')).toBeInTheDocument()
  })
})

// C1 — new desired behavior: single flat sortable table, no tab strip
describe('SolverDebugImpossibilityModal — C1: single flat table (no tabs)', () => {
  it('renders a single flat sortable table with no tab strip', () => {
    const stubReport = {
      total_impossible: 1,
      affected_campers: 1,
      by_reason: {
        grade_compatibility: [
          {
            request_id: 'br_test',
            reason_code: 'grade_compatibility',
            reason_message: 'test',
            request_type: 'bunk_with',
            requester: { name: 'Pearl', cm_id: 1, grade: 3, gender: 'F' },
            requestee: { name: 'Riley', cm_id: 2, grade: 5, gender: 'F' },
            detail: { gap: 2, max_gap_allowed: 1 },
          },
        ],
      },
      flat: [
        {
          request_id: 'br_test',
          reason_code: 'grade_compatibility',
          reason_message: 'test',
          request_type: 'bunk_with',
          requester: { name: 'Pearl', cm_id: 1, grade: 3, gender: 'F' },
          requestee: { name: 'Riley', cm_id: 2, grade: 5, gender: 'F' },
          detail: { gap: 2, max_gap_allowed: 1 },
        },
      ],
      clusters: [],
    }

    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={stubReport}
        sessionCmId={1378702}
        year={2026}
      />
    )

    // No tabs visible
    expect(screen.queryAllByRole('tab')).toHaveLength(0)

    // Table present
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})

// C2 — new desired behavior: Copy JSON button writes pretty-printed JSON to clipboard
describe('SolverDebugImpossibilityModal — C2: Copy JSON button', () => {
  it('Copy JSON button writes JSON.stringify(report, null, 2) to clipboard', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard)

    const stubReport = {
      total_impossible: 1,
      affected_campers: 1,
      by_reason: {
        grade_compatibility: [
          {
            request_id: 'br_test',
            reason_code: 'grade_compatibility',
            reason_message: 'test',
            request_type: 'bunk_with',
            requester: { name: 'Pearl', cm_id: 1, grade: 3, gender: 'F' },
            requestee: { name: 'Riley', cm_id: 2, grade: 5, gender: 'F' },
            detail: { gap: 2, max_gap_allowed: 1 },
          },
        ],
      },
      flat: [
        {
          request_id: 'br_test',
          reason_code: 'grade_compatibility',
          reason_message: 'test',
          request_type: 'bunk_with',
          requester: { name: 'Pearl', cm_id: 1, grade: 3, gender: 'F' },
          requestee: { name: 'Riley', cm_id: 2, grade: 5, gender: 'F' },
          detail: { gap: 2, max_gap_allowed: 1 },
        },
      ],
      clusters: [],
    }

    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={stubReport}
        sessionCmId={1378702}
        year={2026}
      />
    )

    const button = screen.getByRole('button', { name: /copy json/i })
    fireEvent.click(button)

    expect(writeText).toHaveBeenCalledWith(JSON.stringify(stubReport, null, 2))
  })
})
