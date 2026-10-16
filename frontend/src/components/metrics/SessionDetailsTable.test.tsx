/**
 * Session Details table (decision 43 / K8): a light render test of the table the Overview page
 * shows, so retired sessions are checked without mocking the whole page.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
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
      '\u221223',
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

  describe('sort, Total and CSV (#3207 PR 10)', () => {
    const renderTable = () =>
      render(
        <SessionDetailsTable
          current={[s('Session A', 10), s('Session B', 30), s('Session C', 20)]}
          prior={[s('Session A', 8), s('Session B', 25), s('Session C', 20), s('Session D', 5)]}
          isComparing
          currentYear={2026}
          compareYear={2025}
        />
      )
    const names = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.querySelector('td')?.textContent ?? '')

    it('keeps session order, then the first click on a number column goes high to low; a second flips', () => {
      renderTable()
      expect(names().slice(0, 3)).toEqual(['Session A', 'Session B', 'Session C'])
      fireEvent.click(screen.getByRole('button', { name: /^Enrolled/ }))
      expect(names().slice(0, 3)).toEqual(['Session B', 'Session C', 'Session A'])
      fireEvent.click(screen.getByRole('button', { name: /^Enrolled/ }))
      expect(names().slice(0, 3)).toEqual(['Session A', 'Session C', 'Session B'])
    })

    it('rows with nothing to sort on stay at the bottom both ways, and Total stays last', () => {
      renderTable()
      fireEvent.click(screen.getByRole('button', { name: /^Enrolled/ }))
      expect(names().at(-2)).toMatch(/Session D/)
      expect(names().at(-1)).toBe('Total')
      fireEvent.click(screen.getByRole('button', { name: /^Enrolled/ }))
      expect(names().at(-2)).toMatch(/Session D/)
      expect(names().at(-1)).toBe('Total')
    })

    it("the Total row's Delta is Total Enrolled minus the prior total, a new session included (the mock's total)", () => {
      render(
        <SessionDetailsTable
          current={[s('Session A', 10), s('Session New', 7)]}
          prior={[s('Session A', 8), s('Session D', 5)]}
          isComparing
          currentYear={2026}
          compareYear={2025}
        />
      )
      const total = screen.getByText('Total').closest('tr')!
      const cells = within(total).getAllByRole('cell')
      // Enrolled 17, prior 13: +4, not the +2 −5 = −3 the visible row deltas add to.
      expect(cells[1]).toHaveTextContent('17')
      expect(cells[4]).toHaveTextContent('13')
      expect(cells[5]).toHaveTextContent('+4')
    })

    it('offers Copy and Download CSV', () => {
      renderTable()
      expect(screen.getByRole('button', { name: /download csv/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^copy/i })).toBeInTheDocument()
    })
  })
})
