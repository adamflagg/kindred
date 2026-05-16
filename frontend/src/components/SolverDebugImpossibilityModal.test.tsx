// frontend/src/components/SolverDebugImpossibilityModal.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import SolverDebugImpossibilityModal from './SolverDebugImpossibilityModal'

vi.mock('./CamperDetailsPanel', () => ({
  default: ({ camperId, onClose }: { camperId: string; onClose: () => void }) => (
    <div data-testid="camper-details-panel" data-camper-id={camperId} onClick={onClose} />
  ),
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
        requester: { name: 'Emma Johnson', cm_id: 1, grade: 3, gender: 'F' },
        requestee: { name: 'Riley Sam', cm_id: 2, grade: 5, gender: 'F' },
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
      requester: { name: 'Emma Johnson', cm_id: 1, grade: 3, gender: 'F' },
      requestee: { name: 'Riley Sam', cm_id: 2, grade: 5, gender: 'F' },
      detail: { gap: 2, max_gap_allowed: 1 },
    },
  ],
}

// C1 — new desired behavior: single flat sortable table, no tab strip
describe('SolverDebugImpossibilityModal — C1: single flat table (no tabs)', () => {
  it('renders a single flat sortable table with no tab strip', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={stubReport}
        sessionCmId={1000001}
        year={2026}
      />
    )

    // No tabs visible
    expect(screen.queryAllByRole('tab')).toHaveLength(0)

    // Table present
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})

// Sortable column headers must be keyboard-operable and expose aria-sort
describe('SolverDebugImpossibilityModal — sortable header a11y', () => {
  it('sortable header is focusable and toggles sort on Enter', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={stubReport}
        sessionCmId={1000001}
        year={2026}
      />
    )

    const reasonHeader = screen.getByRole('columnheader', { name: /reason/i })
    expect(reasonHeader).toHaveAttribute('aria-sort')
    const button = screen.getByRole('button', { name: /sort by reason/i })
    expect(button).toHaveAttribute('tabindex', '0')

    const initialSort = reasonHeader.getAttribute('aria-sort')
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(reasonHeader.getAttribute('aria-sort')).not.toBe(initialSort)
  })

  it('sortable header toggles sort on Space', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={stubReport}
        sessionCmId={1000001}
        year={2026}
      />
    )

    const reasonHeader = screen.getByRole('columnheader', { name: /reason/i })
    const button = screen.getByRole('button', { name: /sort by reason/i })
    const initial = reasonHeader.getAttribute('aria-sort')
    fireEvent.keyDown(button, { key: ' ' })
    expect(reasonHeader.getAttribute('aria-sort')).not.toBe(initial)
  })
})

describe('SolverDebugImpossibilityModal — entirely-impossible MP campers', () => {
  it('renders a compact camper-level block with reason chips', () => {
    const report = {
      total_impossible: 1,
      affected_campers: 1,
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
      ],
    } as unknown as import('../services/solver').ImpossibilityReport

    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={report}
        sessionCmId={1000001}
        year={2026}
      />
    )

    expect(screen.getByText(/entirely-impossible MP campers/i)).toBeInTheDocument()
    // Copy reads "honored" — "honorable" is ungrammatical here.
    expect(screen.getByText(/zero parent requests honored/i)).toBeInTheDocument()
    expect(screen.queryByText(/honorable/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Emma Johnson/)).toBeInTheDocument()
    const chip = screen.getByText('target_not_in_solver')
    expect(chip).toBeInTheDocument()
    // target_not_in_solver has an explicit (red-tier) chip style, not the
    // neutral gray fallback.
    expect(chip).toHaveStyle({ background: '#fee2e2' })
  })
})

// C2 — new desired behavior: Copy JSON button writes pretty-printed JSON to clipboard
describe('SolverDebugImpossibilityModal — C2: Copy JSON button', () => {
  it('Copy JSON button writes JSON.stringify(report, null, 2) to clipboard', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    })

    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={stubReport}
        sessionCmId={1000001}
        year={2026}
      />
    )

    const button = screen.getByRole('button', { name: /copy json/i })
    fireEvent.click(button)

    expect(writeText).toHaveBeenCalledWith(JSON.stringify(stubReport, null, 2))
  })
})

describe('SolverDebugImpossibilityModal — click-through to CamperDetailsPanel', () => {
  const reportWithRed = {
    ...stubReport,
    mp_campers_entirely_impossible: [
      {
        cm_id: 999,
        name: 'Samuel Johnson',
        grade: 7,
        gender: 'M',
        reason_codes: ['grade_compatibility'],
      },
    ],
  }

  it('opens the panel for a red-section camper when their name is clicked', async () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={reportWithRed}
        sessionCmId={1000001}
        year={2026}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Samuel Johnson/ }))
    expect(await screen.findByTestId('camper-details-panel')).toHaveAttribute(
      'data-camper-id',
      '999'
    )
  })

  it('opens the panel for a flat-table requester when their name is clicked', async () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={stubReport}
        sessionCmId={1000001}
        year={2026}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Emma Johnson/ }))
    expect(await screen.findByTestId('camper-details-panel')).toHaveAttribute('data-camper-id', '1')
  })

  it('opens the panel for a flat-table requestee when their name is clicked', async () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={stubReport}
        sessionCmId={1000001}
        year={2026}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Riley Sam/ }))
    expect(await screen.findByTestId('camper-details-panel')).toHaveAttribute('data-camper-id', '2')
  })

  it('wraps CamperDetailsPanel in a session-scoped BunkRequestProvider (#1464 regression)', async () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={reportWithRed}
        sessionCmId={5555555}
        year={2026}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Samuel Johnson/ }))
    const provider = await screen.findByTestId('bunk-request-provider')
    expect(provider).toHaveAttribute('data-session-cm-id', '5555555')
    expect(provider).toContainElement(screen.getByTestId('camper-details-panel'))
  })

  it('renders a null requestee as plain text in the flat table (no button)', () => {
    const reportNull = {
      ...stubReport,
      flat: [
        {
          ...stubReport.flat[0],
          request_id: 'r_null',
          reason_code: 'target_not_in_solver',
          requestee: null,
        },
      ],
      by_reason: {},
    } as unknown as import('../services/solver').ImpossibilityReport
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={reportNull}
        sessionCmId={1000001}
        year={2026}
      />
    )
    // Requester still has a button; requestee column shows the dash placeholder.
    expect(screen.getByRole('button', { name: /Emma Johnson/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Riley Sam/ })).not.toBeInTheDocument()
  })
})

// Scan-it row 2: the modal stays mounted across opens (SolverDebugPage gates
// it on preCheckQuery.data which is stable), so selectedCamperId must be
// cleared on close — otherwise reopening shows the previously selected camper.
describe('SolverDebugImpossibilityModal — reset on close', () => {
  it('does not render the details panel after the modal is closed and reopened', async () => {
    const { rerender } = render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={stubReport}
        sessionCmId={1000001}
        year={2026}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Emma Johnson/ }))
    expect(await screen.findByTestId('camper-details-panel')).toBeInTheDocument()

    // Close
    rerender(
      <SolverDebugImpossibilityModal
        isOpen={false}
        onClose={() => {}}
        report={stubReport}
        sessionCmId={1000001}
        year={2026}
      />
    )

    // Reopen
    rerender(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={stubReport}
        sessionCmId={1000001}
        year={2026}
      />
    )

    expect(screen.queryByTestId('camper-details-panel')).not.toBeInTheDocument()
  })

  it('clears the selected camper when sessionCmId becomes null', async () => {
    const { rerender } = render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={stubReport}
        sessionCmId={1000001}
        year={2026}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Emma Johnson/ }))
    expect(await screen.findByTestId('camper-details-panel')).toBeInTheDocument()

    rerender(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={stubReport}
        sessionCmId={null}
        year={2026}
      />
    )

    expect(screen.queryByTestId('camper-details-panel')).not.toBeInTheDocument()
  })
})

// Scan-it row 8: with no session selected the panel mount is gated, so
// clicking a name does nothing. Render plain text instead of an interactive
// button to avoid the dead-click.
describe('SolverDebugImpossibilityModal — disable click-through when sessionCmId is null', () => {
  it('renders camper names as plain text (no buttons) when sessionCmId is null', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={stubReport}
        sessionCmId={null}
        year={2026}
      />
    )
    expect(screen.queryByRole('button', { name: /Emma Johnson/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Riley Sam/ })).not.toBeInTheDocument()
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.getByText('Riley Sam')).toBeInTheDocument()
  })
})
