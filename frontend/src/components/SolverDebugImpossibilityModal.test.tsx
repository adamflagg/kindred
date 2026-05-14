// frontend/src/components/SolverDebugImpossibilityModal.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import SolverDebugImpossibilityModal from './SolverDebugImpossibilityModal'

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
