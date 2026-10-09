/**
 * AidTable in the final design language (2026-10-09): string cells carry a native title (§13), the
 * toolbar is one row with an actions slot before the small Download CSV (§4–5), the Flat / By …
 * switch is the segmented well (§18), the footer label can span the identity columns and truncates
 * with a title (§10), and a fixed bounded box is 420px in the page flow (§23). Fictional rows.
 */
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { AidTable, type AidColumn } from './AidTable'

interface Row {
  id: string
  camper: string
  family: string
  amount: number
  session: string
}

const ROWS: Row[] = [
  { id: 'a', camper: 'Emma Johnson', family: 'Mia & Noah Johnson', amount: 500, session: 'S2' },
  { id: 'b', camper: 'Liam Garcia', family: 'Ava Garcia', amount: 250, session: 'FC4' },
]
const COLUMNS: Array<AidColumn<Row>> = [
  { key: 'camper', header: 'Camper', width: 150, pinned: true, value: (r) => r.camper },
  { key: 'family', header: 'Family', width: 150, pinned: true, value: (r) => r.family },
  {
    key: 'session',
    header: 'Session',
    width: 90,
    value: (r) => r.session,
    title: (r) => (r.session === 'FC4' ? 'Family Camp 4' : 'Session 2'),
  },
  {
    key: 'amount',
    header: 'Amount',
    width: 100,
    align: 'right',
    value: (r) => r.amount,
    total: (rows) => rows.reduce((sum, r) => sum + r.amount, 0),
  },
]
const GROUPINGS = [
  {
    key: 'session',
    label: 'By session',
    groupOf: (r: Row) => ({ id: r.session, heading: r.session }),
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
        {...extra}
      />
    </MemoryRouter>
  )
}
const toolbar = () => document.querySelector('[data-aid-toolbar]') as HTMLElement

describe('AidTable cells carry a native title (§13: "if they are cut we need to tooltip … the full name")', () => {
  it('titles a string cell with its own words', () => {
    renderTable()
    expect(screen.getByText('Mia & Noah Johnson').closest('td')).toHaveAttribute(
      'title',
      'Mia & Noah Johnson'
    )
  })

  it("takes a column's own title for a short form", () => {
    renderTable()
    expect(screen.getByText('FC4').closest('td')).toHaveAttribute('title', 'Family Camp 4')
  })

  it('leaves a figure untitled', () => {
    renderTable()
    expect(screen.getByText('$500').closest('td')).not.toHaveAttribute('title')
  })
})

describe('AidTable toolbar: one row (§5)', () => {
  it('never wraps', () => {
    renderTable()
    expect(toolbar()).toHaveClass('flex-nowrap')
    expect(toolbar()).not.toHaveClass('flex-wrap')
  })

  it('draws the page actions after the search and before the small Download CSV, which is last', () => {
    renderTable({ toolbarActions: <button type="button">Record a Commitment…</button> })
    const buttons = within(toolbar()).getAllByRole('button')
    const names = buttons.map((b) => b.textContent)
    expect(names.at(-1)).toBe('Download CSV')
    expect(names.indexOf('Record a Commitment…')).toBe(names.length - 2)
    expect(buttons.at(-1)).toHaveClass('h-[26px]')
  })

  it('draws Flat / By … as the segmented well, the picked choice in primary', () => {
    renderTable({ groupings: GROUPINGS })
    const well = within(toolbar()).getByRole('group', { name: 'Grouping' })
    expect(well).toHaveClass('h-[26px]')
    expect(within(well).getByRole('button', { name: 'Flat' })).toHaveClass('bg-primary')
  })
})

describe('AidTable footer (§10: "flows out of its column on the bottom row")', () => {
  it('spans the label over the columns it is given and truncates it with a title', () => {
    renderTable({
      footerLabel: () => '2 grants · 0 not counted',
      footerTitle: () => '2 grants; none of them is left out of the totals',
      footerSpan: 3,
    })
    const label = screen.getByText('2 grants · 0 not counted').closest('td') as HTMLElement
    expect(label).toHaveAttribute('colspan', '3')
    expect(label).toHaveClass('truncate')
    expect(label).toHaveAttribute('title', '2 grants; none of them is left out of the totals')
  })
})

// Scan #3109: the status slot shrinks and clips rather than pushing search and CSV off the row.
describe('AidTable toolbar status', () => {
  it('sits in a slot that may shrink and clips what does not fit', () => {
    renderTable({ toolbarStatus: <span>✓ March File downloaded for 12 households</span> })
    const slot = screen.getByText('✓ March File downloaded for 12 households').parentElement
    expect(slot).toHaveClass('min-w-0', 'overflow-hidden')
  })
})

// Scan #3109: a label span never swallows a column that carries a total.
describe('AidTable footer span guard', () => {
  it('stops the label span before the first column with a total', () => {
    renderTable({ footerLabel: () => '2 grants', footerSpan: 9 })
    const label = screen.getByText('2 grants').closest('td') as HTMLElement
    expect(label).toHaveAttribute('colspan', '3')
    expect(screen.getByText('$750')).toBeInTheDocument()
  })
})

// Scan #3109: a placeholder dash says nothing a tooltip could add.
describe('AidTable placeholder cells', () => {
  it('leaves an empty-value dash untitled', () => {
    renderTable({
      columns: [
        { key: 'camper', header: 'Camper', width: 150, value: (r) => r.camper },
        { key: 'none', header: 'Note', width: 90, value: () => '—' },
      ],
    })
    expect(screen.getAllByText('—')[0]?.closest('td')).not.toHaveAttribute('title')
    expect(screen.getByText('Emma Johnson').closest('td')).toHaveAttribute('title', 'Emma Johnson')
  })
})

describe('AidTable bounded box (§23)', () => {
  it('draws a fixed 420px card in the page flow, never sized to the window', () => {
    renderTable({ bounded: true })
    const box = screen.getByRole('table').parentElement as HTMLElement
    expect(box).toHaveClass('max-h-[420px]', 'overflow-auto')
    expect(box).not.toHaveClass('overscroll-contain')
    expect(box.style.maxHeight).toBe('')
  })
})
