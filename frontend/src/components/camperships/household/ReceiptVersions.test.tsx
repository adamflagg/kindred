import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { ApiAidHouseholdRequest } from '../../../types/api-types'
import { TRACE_CAPPED_BY_ASK, traceStep } from '../kit/fixtures'
import { ROW_EMMA } from '../requests/gridFixtures'
import { householdRequest, receiptOut } from './householdFixtures'
import { ReceiptVersions } from './ReceiptVersions'

const VIEW = { year: 2027, asOf: { kind: 'live' } as const }

const R1 = receiptOut(1, {
  kind: 'locked',
  rules_version: 1,
  locked_on: '2027-03-09',
  lock_source: 'tick',
  ticked_by_name: 'Test User',
})
const R2 = {
  ...receiptOut(2, { kind: 'locked', rules_version: 2, locked_on: '2027-04-22' }),
  trace: TRACE_CAPPED_BY_ASK.map((s) =>
    s.key === 'adjusted_income' ? { ...s, value: '90000.00' } : s
  ),
}
const LIVE = {
  ...receiptOut(3, { rules_version: 3 }),
  trace: [
    ...R2.trace.filter((s) => s.key !== 'total'),
    traceStep('r2', 'Round 2 award', '600.00', { appeal: '600.00', cap: '900.00' }, 'appeal'),
    traceStep('total', 'Total award', '2100.00', { r1: '1500.00', r2: '600.00' }),
  ],
}
const HOLD = [{ code: 'manual_hold', severity: 'hold' as const, message: 'Waiting on a call' }]

function renderVersions(over: Partial<ApiAidHouseholdRequest>, holds = false) {
  const request = householdRequest(holds ? { ...ROW_EMMA, holds: HOLD } : ROW_EMMA, over)
  return render(
    <MemoryRouter>
      <ReceiptVersions request={request} view={VIEW} />
    </MemoryRouter>
  )
}

const line = (label: string) =>
  screen.getByText(label, { selector: 'span' }).closest('button') as HTMLElement
const open = () => userEvent.click(screen.getByRole('button', { name: /^Show the receipt/ }))

describe('ReceiptVersions: one receipt, a version switcher (round 3, section 1 (B))', () => {
  it('folds to one control that counts the versions', () => {
    renderVersions({ receipts: [R1, R2, LIVE] })
    expect(
      screen.getByRole('button', { name: 'Show the receipt · 3 versions ▾' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /as posted/ })).toBeNull()
  })

  it('heads the card with one line of chips, not the sentence (household-v4 §2 (B))', () => {
    renderVersions({ receipts: [R1, R2, LIVE] })
    const chips = screen.getByTestId('receipt-chips')
    expect(chips.textContent).toBe(
      "Adjusted $90,000 · tier 5R1 40%, limited by the family's ask → $1,500R2 limited by the family's appeal → $600Total $2,100"
    )
    expect(within(chips).getByText("limited by the family's appeal")).toHaveClass('text-amber-700')
    // The prose sentence is the hover, not the line.
    expect(screen.queryByText(/Adjusted income/)).toBeNull()
    expect(chips.getAttribute('title')).toMatch(/^Adjusted income \$90,000 → tier 5\. Round 1: /)
  })

  it('keeps the Total out of the chips that truncate, pinned at the right', () => {
    renderVersions({ receipts: [R1, R2, LIVE] })
    const chips = screen.getByTestId('receipt-chips')
    const [flow, total] = [...chips.children] as HTMLElement[]
    expect(flow).toHaveClass('overflow-hidden', 'text-ellipsis', 'min-w-0')
    expect(total).toHaveTextContent('Total $2,100')
    expect(total).toHaveClass('flex-none')
    expect(chips).toHaveClass('whitespace-nowrap')
  })

  it('the chips follow the picked version', async () => {
    renderVersions({ receipts: [R1, R2, LIVE] })
    await open()
    await userEvent.click(screen.getByRole('button', { name: /^Round 2 as posted/ }))
    const chips = screen.getByTestId('receipt-chips')
    expect(chips).toHaveTextContent('Total $1,500')
    expect(chips.textContent).not.toMatch(/R2/)
  })

  it('lists the versions oldest first, each with its date and total, the current one picked', async () => {
    const { container } = renderVersions({ receipts: [LIVE, R2, R1] })
    await open()
    const versions = [...container.querySelectorAll('[aria-pressed]')]
    expect(versions.map((b) => b.textContent)).toEqual([
      'Round 1 as postedMar 9$1,500',
      'Round 2 as postedApr 22$1,500',
      'Currentlive$2,100',
    ])
    expect(screen.getByRole('button', { name: /^Current/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('link', { name: 'rules 2027 v3' })).toBeInTheDocument()
  })

  it('diffs the picked version against the one before it: old struck, new bold, new lines tagged', async () => {
    renderVersions({ receipts: [R1, R2, LIVE] })
    await open()
    expect(screen.getByText(/Compared with/)).toHaveTextContent(
      'Compared with Round 2 as posted: 1 changed, 1 new · old new'
    )
    const total = line('Total award')
    expect(total).toHaveAttribute('data-mark', 'changed')
    expect(within(total).getByText('$1,500').tagName).toBe('DEL')
    expect(within(total).getByText('$2,100').tagName).toBe('INS')
    const r2 = line('Round 2 award')
    expect(r2).toHaveAttribute('data-mark', 'new')
    expect(within(r2).getByText('new')).toBeInTheDocument()
    expect(line('Cost')).toHaveAttribute('data-mark', 'same')
  })

  it('switches versions: the label, the sentence and the diff follow', async () => {
    renderVersions({ receipts: [R1, R2, LIVE] })
    await open()
    await userEvent.click(screen.getByRole('button', { name: /^Round 2 as posted/ }))
    expect(screen.getByRole('button', { name: /^Round 2 as posted/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('link', { name: 'rules 2027 v2' })).toBeInTheDocument()
    expect(screen.getByText(/Compared with/)).toHaveTextContent(
      'Compared with Round 1 as posted: 1 changed'
    )
    const adjusted = line('Adjusted household income')
    expect(within(adjusted).getByText('$120,000').tagName).toBe('DEL')
    expect(within(adjusted).getByText('$90,000').tagName).toBe('INS')
    expect(screen.queryByText('Round 2 award', { selector: 'span' })).toBeNull()
  })

  it('marks nothing on the first version', async () => {
    const { container } = renderVersions({ receipts: [R1, R2, LIVE] })
    await open()
    await userEvent.click(screen.getByRole('button', { name: /^Round 1 as posted/ }))
    expect(screen.getByText('The first version: nothing before it to compare')).toBeInTheDocument()
    expect(container.querySelector('del, ins')).toBeNull()
    expect(container.querySelector('[data-mark]:not([data-mark="same"])')).toBeNull()
  })

  it('returns to the current version when it is folded again', async () => {
    renderVersions({ receipts: [R1, R2, LIVE] })
    await open()
    await userEvent.click(screen.getByRole('button', { name: /^Round 1 as posted/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Hide the receipt ▴' }))
    expect(screen.getByRole('link', { name: 'rules 2027 v3' })).toBeInTheDocument()
  })

  it('opens by itself on a hold, on the current version (D34)', () => {
    renderVersions({ receipts: [R1, LIVE] }, true)
    expect(screen.getByRole('button', { name: 'Hide the receipt ▴' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Current/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('with one version: no count, no switcher, "One version so far"', async () => {
    const { container } = renderVersions({ receipts: [receiptOut(1), receiptOut(2)] })
    await userEvent.click(screen.getByRole('button', { name: 'Show the receipt ▾' }))
    expect(container.querySelector('[aria-pressed]')).toBeNull()
    expect(screen.getByText('One version so far')).toBeInTheDocument()
    expect(line('Weighted income')).toBeInTheDocument()
  })

  it('opens a line on click to show how it was worked out', async () => {
    renderVersions({ receipts: [receiptOut(1)] })
    await open()
    await userEvent.click(line('Round 1 award'))
    expect(
      screen.getByText("the family's ask $1,500, under the potential $2,000")
    ).toBeInTheDocument()
  })

  it('draws nothing without a receipt', () => {
    const { container } = renderVersions({ receipts: [] })
    expect(container).toBeEmptyDOMElement()
  })
})
