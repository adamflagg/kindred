/**
 * The table's two opt-in props for a grouped list (Money › Funders): `rowTone` draws a row as a
 * group header (tinted, bold, top rule), and `sortable={false}` stops the headers sorting. Defaults
 * leave every other table as it was. Fictional rows (tests/CLAUDE.md).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { AidTable, type AidColumn } from './AidTable'

interface Row {
  id: string
  name: string
  kind: 'head' | 'warn' | 'item'
  count: number
}

const ROWS: Row[] = [
  { id: 'h1', name: 'Fund A', kind: 'head', count: 3 },
  { id: 'i1', name: 'Fund A grant', kind: 'item', count: 1 },
  { id: 'h2', name: 'No funder yet', kind: 'warn', count: 2 },
  { id: 'i2', name: 'Scholarship', kind: 'item', count: 2 },
]
const COLUMNS: Array<AidColumn<Row>> = [
  { key: 'name', header: 'Name', width: 150, pinned: true, value: (r) => r.name },
  { key: 'count', header: 'Count', width: 80, value: (r) => r.count },
]
const tone = (r: Row) => (r.kind === 'head' ? 'group' : r.kind === 'warn' ? 'warn' : undefined)

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
const rowOf = (key: string) => {
  const row = document.querySelector(`tr[data-row-key="${key}"]`)
  if (!(row instanceof HTMLElement)) throw new Error(`no row ${key}`)
  return row
}

describe('AidTable rowTone', () => {
  it('draws a group row tinted, bold and ruled, and leaves other rows alone', () => {
    renderTable({ rowTone: tone })
    const head = rowOf('h1')
    expect(head).toHaveAttribute('data-row-tone', 'group')
    expect(head.className).toContain('bg-emerald-50')
    for (const cell of Array.from(head.querySelectorAll('td'))) {
      expect(cell.className).toContain('font-semibold')
      expect(cell.className).toContain('border-t')
    }
    // A header's text may run across the empty cells beside it: no clipping, no opaque cell.
    const second = head.querySelectorAll('td')[1]
    expect(second?.className).not.toContain('overflow-hidden')
    expect(second?.className).not.toContain('bg-card')
    const item = rowOf('i1')
    expect(item).not.toHaveAttribute('data-row-tone')
    expect(item.className).not.toContain('bg-emerald-50')
    expect(item.querySelectorAll('td')[1]?.className).toContain('bg-card')
  })

  it('draws a warn group row amber-ish and distinct from a plain group', () => {
    renderTable({ rowTone: tone })
    expect(rowOf('h2').className).toContain('bg-yellow-50')
    expect(rowOf('h2')).toHaveAttribute('data-row-tone', 'warn')
  })

  it('keeps the pinned cell opaque in the same tint, so scrolled cells never show under it', () => {
    renderTable({ rowTone: tone })
    const pinned = rowOf('h1').querySelectorAll('td')[0]
    expect(pinned?.className).toContain('bg-emerald-50')
    expect(pinned?.className).toContain('sticky')
  })

  it('without rowTone nothing is drawn as a group row', () => {
    renderTable()
    expect(document.querySelector('[data-row-tone]')).toBeNull()
    expect(rowOf('h1').querySelectorAll('td')[1]?.className).toContain('bg-card')
  })
})

describe('AidTable sortable', () => {
  it('sorts on a header click by default', async () => {
    renderTable()
    await userEvent.click(screen.getByRole('button', { name: /Count/ }))
    expect(rowOf('i1')).toBeInTheDocument()
    const keys = Array.from(document.querySelectorAll('tr[data-row-key]')).map((r) =>
      r.getAttribute('data-row-key')
    )
    expect(keys).toEqual(['i1', 'h2', 'i2', 'h1'])
  })

  it('draws plain headers, with no sort button, when sortable is false', () => {
    renderTable({ sortable: false })
    expect(screen.queryByRole('button', { name: /Count/ })).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Count' })).toBeInTheDocument()
  })

  it('keeps the given row order even when the URL holds a sort', () => {
    render(
      <MemoryRouter initialEntries={['/x?sort=count']}>
        <AidTable<Row>
          rows={ROWS}
          columns={COLUMNS}
          rowKey={(r) => r.id}
          csvFilename="x.csv"
          sortable={false}
        />
      </MemoryRouter>
    )
    const keys = Array.from(document.querySelectorAll('tr[data-row-key]')).map((r) =>
      r.getAttribute('data-row-key')
    )
    expect(keys).toEqual(['h1', 'i1', 'h2', 'i2'])
  })
})
