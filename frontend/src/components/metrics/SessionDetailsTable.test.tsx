/**
 * Session Details table (decision 43 / K8): a light render test of the table the Overview page
 * shows, so retired sessions are checked without mocking the whole page.
 */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SessionBreakdown } from '../../types/metrics'
import { SessionDetailsTable } from './SessionDetailsTable'

function s(session_name: string, count: number): SessionBreakdown {
  return { session_cm_id: 0, session_name, count, capacity: 40, utilization: (count / 40) * 100 }
}

describe('SessionDetailsTable', () => {
  it('shows a retired prior session with dashes, its prior count, a negative delta and a pill', () => {
    render(
      <SessionDetailsTable
        current={[s('Session A', 10)]}
        prior={[s('Session A', 8), s('Session B', 23)]}
        isComparing
        currentYear={2026}
        compareYear={2025}
      />
    )

    expect(screen.getByText('2025 Enrolled')).toBeInTheDocument()
    const row = screen.getByText('Session B').closest('tr')!
    const cells = within(row).getAllByRole('cell')
    expect(cells.map((c) => c.textContent)).toEqual([
      'Session Bnot offered in 2026',
      '—',
      '—',
      '—',
      '23',
      '-23',
    ])
    expect(within(row).getByText('not offered in 2026')).toBeInTheDocument()

    const matched = screen.getByText('Session A').closest('tr')!
    expect(
      within(matched)
        .getAllByRole('cell')
        .map((c) => c.textContent)
    ).toEqual(['Session A', '10', '40', '25.0%', '8', '+2'])
  })

  it('shows only current sessions and no compare columns outside compare mode', () => {
    render(
      <SessionDetailsTable
        current={[s('Session A', 10)]}
        prior={[s('Session B', 23)]}
        isComparing={false}
        currentYear={2026}
        compareYear={null}
      />
    )

    expect(screen.queryByText('Session B')).not.toBeInTheDocument()
    expect(screen.queryByText('Delta')).not.toBeInTheDocument()
    expect(screen.queryByText(/not offered/)).not.toBeInTheDocument()
  })
})
