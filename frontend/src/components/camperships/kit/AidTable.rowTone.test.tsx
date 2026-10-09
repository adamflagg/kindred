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
import { CS_BAND, CS_BAND_WARN } from './csType'

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
  // Design language §9 (owner: "wrong green on the header sections?"): a group row is the one green
  // band, CS_BAND; "No funder yet" is the amber band warn. Emerald and yellow are retired.
  it('draws a group row in the green band, bold and ruled, and leaves other rows alone', () => {
    renderTable({ rowTone: tone })
    const head = rowOf('h1')
    expect(head).toHaveAttribute('data-row-tone', 'group')
    expect(head.className).toContain(CS_BAND)
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
    expect(item.className).not.toContain(CS_BAND)
    expect(item.querySelectorAll('td')[1]?.className).toContain('bg-card')
  })

  it('draws a warn group row amber-ish and distinct from a plain group', () => {
    renderTable({ rowTone: tone })
    expect(rowOf('h2').className).toContain(CS_BAND_WARN)
    expect(rowOf('h2')).toHaveAttribute('data-row-tone', 'warn')
  })

  it('keeps the pinned cell opaque in the same tint, so scrolled cells never show under it', () => {
    renderTable({ rowTone: tone })
    const pinned = rowOf('h1').querySelectorAll('td')[0]
    expect(pinned?.className).toContain(CS_BAND)
    expect(pinned?.className).toContain('sticky')
  })

  it('without rowTone nothing is drawn as a group row', () => {
    renderTable()
    expect(document.querySelector('[data-row-tone]')).toBeNull()
    expect(rowOf('h1').querySelectorAll('td')[1]?.className).toContain('bg-card')
  })
})

describe('AidTable firstCellSpan', () => {
  // Design language §5 (money-funders.html): a funder's long name and its terms line run across the columns up
  // to the totals. The live row let the words spill over the next cells and overprint; now the first cell
  // owns those columns (colSpan), the cells it covers are not drawn, and the words cut with a title.
  const THREE: Array<AidColumn<Row>> = [
    { key: 'name', header: 'Name', width: 150, pinned: true, value: (r) => r.name },
    { key: 'kind', header: 'Kind', width: 80, value: (r) => r.kind },
    { key: 'count', header: 'Count', width: 80, value: (r) => r.count },
  ]
  const span = (r: Row) => (r.kind === 'head' ? 2 : undefined)

  it('gives a tone row`s first cell the columns it spans and draws no cell under them', () => {
    renderTable({ columns: THREE, rowTone: tone, firstCellSpan: span })
    const cells = rowOf('h1').querySelectorAll('td')
    expect(cells).toHaveLength(2)
    expect(cells[0]).toHaveAttribute('colspan', '2')
    expect(cells[0]?.textContent).toBe('Fund A')
    expect(cells[1]?.textContent).toBe('3')
  })

  it('leaves rows that ask for no span, and tables that give none, as they were', () => {
    renderTable({ columns: THREE, rowTone: tone, firstCellSpan: span })
    expect(rowOf('i1').querySelectorAll('td')).toHaveLength(3)
    expect(rowOf('h2').querySelectorAll('td')).toHaveLength(3)
    document.body.innerHTML = ''
    renderTable({ columns: THREE, rowTone: tone })
    expect(rowOf('h1').querySelectorAll('td')).toHaveLength(3)
  })

  it('spans a plain row too, for a muted line that owns the width ("nothing under it yet")', () => {
    renderTable({ columns: THREE, firstCellSpan: (r) => (r.kind === 'item' ? 3 : undefined) })
    expect(rowOf('i1').querySelectorAll('td')).toHaveLength(1)
    expect(rowOf('i1').querySelector('td')).toHaveAttribute('colspan', '3')
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

describe('AidTable belowToolbar', () => {
  // Design language §24 (money-funders.html): New Funder… opens its page-level editor between the toolbar
  // and the table, as the mock draws it, not above the toolbar.
  it('draws the page-level editor between the toolbar and the table, and nothing when none is given', () => {
    renderTable({ belowToolbar: <div data-testid="page-editor">New funder</div> })
    const editor = screen.getByTestId('page-editor')
    const toolbar = document.querySelector('[data-aid-toolbar]')
    const table = document.querySelector('table')
    expect(toolbar?.compareDocumentPosition(editor)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(editor.compareDocumentPosition(table as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    document.body.innerHTML = ''
    renderTable()
    expect(screen.queryByTestId('page-editor')).toBeNull()
  })
})
