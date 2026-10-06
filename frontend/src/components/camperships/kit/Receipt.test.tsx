import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { TRACE_CAPPED_BY_ASK, traceStep } from './fixtures'
import { MINUS } from './money'
import { Receipt } from './Receipt'

const LIVE = {
  kind: 'live',
  season: 2027,
  rules_version: 3,
  locked_on: null,
  lock_source: null,
  ticked_by_name: null,
  decided_by_name: null,
} as const

function renderReceipt(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('Receipt (D33 form D; D34 folding; D76)', () => {
  it('shows its label, the sentence on top and every line under it', () => {
    const { container } = renderReceipt(<Receipt trace={TRACE_CAPPED_BY_ASK} label={LIVE} />)
    expect(container.querySelector('p')).toHaveTextContent(
      "Round 1: 40% of $5,000 = $2,000, limited by the family's ask to $1,500."
    )
    expect(screen.getByRole('button', { name: /Weighted income/ })).toBeInTheDocument()
  })

  it('links its rules version to the approved rules (D76)', () => {
    renderReceipt(<Receipt trace={TRACE_CAPPED_BY_ASK} label={LIVE} />)
    expect(screen.getByRole('link', { name: 'rules 2027 v3' })).toHaveAttribute(
      'href',
      '/aid/season/rules?version=3&year=2027'
    )
  })

  it('inks the line whose limit decided the amount, and names the limit', () => {
    renderReceipt(<Receipt trace={TRACE_CAPPED_BY_ASK} label={LIVE} />)
    const line = screen.getByRole('button', { name: /Round 1 award/ })
    expect(line).toHaveClass('bg-amber-50')
    expect(line).toHaveTextContent("limited by the family's ask")
  })

  it('opens a line on click to show how it was worked out (never on hover)', async () => {
    renderReceipt(<Receipt trace={TRACE_CAPPED_BY_ASK} label={LIVE} />)
    expect(screen.queryByText("the family's ask $1,500, under the potential $2,000")).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Round 1 award/ }))
    expect(
      screen.getByText("the family's ask $1,500, under the potential $2,000")
    ).toBeInTheDocument()
  })

  it('folds under its sentence on the household page, and unfolds on request (D34)', async () => {
    renderReceipt(<Receipt trace={TRACE_CAPPED_BY_ASK} label={LIVE} folded />)
    expect(screen.queryByRole('button', { name: /Weighted income/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show the receipt (11 lines) ▾' }))
    expect(screen.getByRole('button', { name: /Weighted income/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide the receipt ▴' })).toBeInTheDocument()
  })

  it('M8: lines show when the receipt stops being folded after mount', () => {
    const { rerender } = renderReceipt(<Receipt trace={TRACE_CAPPED_BY_ASK} label={LIVE} folded />)
    expect(screen.queryByRole('button', { name: /Weighted income/ })).toBeNull()
    rerender(
      <MemoryRouter>
        <Receipt trace={TRACE_CAPPED_BY_ASK} label={LIVE} folded={false} />
      </MemoryRouter>
    )
    expect(screen.getByRole('button', { name: /Weighted income/ })).toBeInTheDocument()
  })

  it('M9: a hold that stays does not re-open a receipt the user folded', async () => {
    renderReceipt(<Receipt trace={TRACE_CAPPED_BY_ASK} label={LIVE} folded openByItself />)
    expect(screen.getByRole('button', { name: /Weighted income/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Hide the receipt ▴' }))
    expect(screen.queryByRole('button', { name: /Weighted income/ })).toBeNull()
  })

  it('M7: the rules link carries the as-of of the view', () => {
    renderReceipt(
      <Receipt
        trace={TRACE_CAPPED_BY_ASK}
        label={LIVE}
        view={{ year: 2027, asOf: { kind: 'past', date: '2027-03-09', axis: 'campminder' } }}
      />
    )
    expect(screen.getByRole('link', { name: 'rules 2027 v3' })).toHaveAttribute(
      'href',
      '/aid/season/rules?version=3&year=2027&as_of=2027-03-09'
    )
  })

  it('I6: a negative figure is red in the lines and the sentence', () => {
    const trace = [
      traceStep('adjusted_income', 'Adjusted household income', '-1200.00', {}),
      traceStep('income_tier', 'Income tier', 1, {}),
    ]
    const { container } = renderReceipt(<Receipt trace={trace} label={LIVE} />)
    expect(screen.getByText(`${MINUS}$1,200`, { selector: 'b' })).toHaveClass('text-red-700')
    expect(container.querySelector('button span.tabular-nums')).toHaveClass('text-red-700')
  })

  it('opens by itself on a hold or a would-change flag, including one that arrives later (D34)', () => {
    const { rerender } = renderReceipt(<Receipt trace={TRACE_CAPPED_BY_ASK} label={LIVE} folded />)
    expect(screen.queryByRole('button', { name: /Weighted income/ })).toBeNull()
    rerender(
      <MemoryRouter>
        <Receipt trace={TRACE_CAPPED_BY_ASK} label={LIVE} folded openByItself />
      </MemoryRouter>
    )
    expect(screen.getByRole('button', { name: /Weighted income/ })).toBeInTheDocument()
  })
})
