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
        sessionCmId={1378702}
        year={2026}
      />
    )

    const button = screen.getByRole('button', { name: /copy json/i })
    fireEvent.click(button)

    expect(writeText).toHaveBeenCalledWith(JSON.stringify(stubReport, null, 2))
  })
})
