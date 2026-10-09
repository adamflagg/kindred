/**
 * AidTable's opt-ins for the final Money › Ledger screen (design-language §5, §10; ★11, ★13): a total
 * that carries its own native title, totals that can be switched off, and a control after Download CSV
 * (the lines card's Close). Fictional rows.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { AidTable, type AidColumn } from './AidTable'

interface Row {
  id: string
  family: string
  amount: number
}
const ROWS: Row[] = [
  { id: 'a', family: 'Garcia', amount: 500 },
  { id: 'b', family: 'Johnson', amount: 250 },
]
const COLUMNS: Array<AidColumn<Row>> = [
  { key: 'family', header: 'Family', width: 150, pinned: true, value: (r) => r.family },
  {
    key: 'amount',
    header: 'Amount',
    width: 100,
    align: 'right',
    value: (r) => r.amount,
    total: () => 750,
    totalTitle: () => 'Amount: open the lines behind it',
  },
]

function renderTable(extra: Partial<Parameters<typeof AidTable<Row>>[0]> = {}) {
  return render(
    <MemoryRouter>
      <AidTable<Row>
        rows={ROWS}
        columns={COLUMNS}
        rowKey={(r) => r.id}
        csvFilename="x.csv"
        onOpenTotal={() => undefined}
        {...extra}
      />
    </MemoryRouter>
  )
}

describe('a total with its own title (★11)', () => {
  it('puts the column totalTitle on the total that opens its rows', () => {
    renderTable()
    expect(screen.getByRole('button', { name: '$750' })).toHaveAttribute(
      'title',
      'Amount: open the lines behind it'
    )
  })

  it('draws a titled total as a link (primary, dotted underline), the kit CF.cf-link in a total row', () => {
    renderTable()
    const link = screen.getByRole('button', { name: '$750' })
    expect(link).toHaveClass('text-primary', 'underline', 'decoration-dotted')
  })

  it('leaves an untitled total in the row’s own ink', () => {
    renderTable({ columns: COLUMNS.map(({ totalTitle: _drop, ...c }) => c) })
    expect(screen.getByRole('button', { name: '$750' })).not.toHaveClass('text-primary')
  })

  it('leaves a total with no totalTitle untitled', () => {
    renderTable({ columns: COLUMNS.map(({ totalTitle: _drop, ...c }) => c) })
    expect(screen.getByRole('button', { name: '$750' })).not.toHaveAttribute('title')
  })
})

describe('totalsDisabled', () => {
  it('switches the opening totals off while the rows are a stand-in', async () => {
    const open = vi.fn()
    renderTable({ totalsDisabled: true, onOpenTotal: open })
    const total = screen.getByRole('button', { name: '$750' })
    expect(total).toBeDisabled()
    await userEvent.click(total)
    expect(open).not.toHaveBeenCalled()
  })

  it('is on by default', () => {
    renderTable()
    expect(screen.getByRole('button', { name: '$750' })).toBeEnabled()
  })
})

describe('toolbarEnd', () => {
  it('draws a control after Download CSV, the one place §5 lets the CSV button stop being last', () => {
    renderTable({ toolbarEnd: <button type="button">Close</button> })
    const toolbar = document.querySelector('[data-aid-toolbar]') as HTMLElement
    const buttons = within(toolbar)
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(buttons.at(-2)).toBe('Download CSV')
    expect(buttons.at(-1)).toBe('Close')
  })
})
