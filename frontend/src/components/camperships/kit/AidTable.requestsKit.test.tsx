/**
 * AidTable's opt-ins for the final Requests screen (design-language §5, §8, §12): headers on one
 * line, a footnote mark beside a header, a slot between the status and the search, and a search
 * width the page can narrow. Fictional rows.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { AidTable, type AidColumn } from './AidTable'

interface Row {
  id: string
  camper: string
  amount: number
}
const ROWS: Row[] = [
  { id: 'a', camper: 'Emma Johnson', amount: 500 },
  { id: 'b', camper: 'Liam Garcia', amount: 250 },
]
const COLUMNS: Array<AidColumn<Row>> = [
  { key: 'camper', header: 'Camper', width: 150, pinned: true, value: (r) => r.camper },
  {
    key: 'amount',
    header: 'Decided',
    width: 100,
    align: 'right',
    value: (r) => r.amount,
    mark: { n: 1, title: 'Decided: the award for a round.' },
    total: (rows) => rows.reduce((sum, r) => sum + r.amount, 0),
  },
  {
    key: 'posted',
    header: 'Posted',
    width: 100,
    align: 'right',
    value: (r) => r.amount,
    help: 'Posted is the amount posted in this round.',
    mark: { n: 2, title: 'Posted: what the round locked.' },
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

describe('headers on one line (§8) is a per-table opt-in', () => {
  it('wraps headers by default, as every other screen still does', () => {
    renderTable()
    const th = screen.getByRole('columnheader', { name: /Camper/ })
    expect(th).toHaveClass('whitespace-normal')
  })

  it('draws every header nowrap when asked, help headers included', () => {
    renderTable({ nowrapHeaders: true })
    for (const th of document.querySelectorAll('thead th')) {
      expect(th).toHaveClass('whitespace-nowrap')
      expect(th).not.toHaveClass('whitespace-normal')
    }
  })
})

describe('a header footnote mark (§12)', () => {
  it('draws the mark at 0.72em with the note as its title, beside a sortable header', () => {
    renderTable()
    const mark = document.querySelector('thead sup[title^="Decided"]')
    expect(mark).toHaveTextContent('1')
    expect(mark).toHaveClass('text-[0.72em]')
  })

  it('draws it beside a help header too, and keeps the header name clean', () => {
    renderTable()
    const mark = document.querySelector('thead sup[title^="Posted:"]')
    expect(mark).toHaveTextContent('2')
    expect(screen.getByRole('columnheader', { name: /Decided/ })).toBeInTheDocument()
  })
})

describe('the toolbar slots Requests uses (§5)', () => {
  it('draws toolbarBeforeSearch between the status and the search, before the actions and CSV', () => {
    renderTable({
      toolbarStatus: <span>2 checked</span>,
      toolbarBeforeSearch: <button type="button">Check Accepted…</button>,
      toolbarActions: <button type="button">Other</button>,
    })
    const text = Array.from(toolbar().querySelectorAll('span,button,input')).map(
      (e) => e.textContent || (e as HTMLInputElement).placeholder
    )
    const at = (s: string) => text.findIndex((t) => t.includes(s))
    expect(at('2 checked')).toBeLessThan(at('Check Accepted…'))
    expect(at('Check Accepted…')).toBeLessThan(at('Search'))
    expect(at('Search')).toBeLessThan(at('Other'))
    expect(at('Other')).toBeLessThan(at('Download CSV'))
  })

  it('keeps the search at its default width, and takes a narrower one', () => {
    const { unmount } = renderTable()
    expect(screen.getByRole('searchbox').parentElement).toHaveClass('w-64')
    unmount()
    renderTable({ searchWidth: 180 })
    const box = screen.getByRole('searchbox').parentElement as HTMLElement
    expect(box).not.toHaveClass('w-64')
    expect(box.style.width).toBe('180px')
  })
})
