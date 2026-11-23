/**
 * `bandRow` (design-language rule 8): one full-width tone row, first in the body, for a fact that holds for every row
 * in view (Form intake's refused Google read, adult aid form mock callout 4). It is not a data row: the search, the
 * footer's count, the CSV and the highlight never see it. Fictional rows (tests/CLAUDE.md).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { AidTable, type AidColumn } from './AidTable'
import { CS_BAND_WARN } from './csType'

interface Row {
  id: string
  name: string
}
const ROWS: Row[] = [
  { id: 'a', name: 'Rachel Garcia' },
  { id: 'b', name: 'Grace Chen' },
]
const COLUMNS: Array<AidColumn<Row>> = [
  { key: 'name', header: 'Name', width: 150, searchable: true, value: (r) => r.name },
  { key: 'n', header: 'N', width: 60, value: () => 1, total: (rows) => rows.length },
]
const BAND = {
  tone: 'warn' as const,
  title: 'The 14:20 read was refused',
  content: <span>⚠ The 14:20 read was refused</span>,
}

function renderTable(extra: Partial<Parameters<typeof AidTable<Row>>[0]> = {}) {
  return render(
    <MemoryRouter>
      <AidTable<Row>
        rows={ROWS}
        columns={COLUMNS}
        rowKey={(r) => r.id}
        csvFilename="x.csv"
        footerLabel={(rows) => `${String(rows.length)} rows`}
        bandRow={BAND}
        {...extra}
      />
    </MemoryRouter>
  )
}
const band = () => {
  const row = document.querySelector('tr[data-band-row]')
  if (!(row instanceof HTMLElement)) throw new Error('no band row')
  return row
}

describe('AidTable bandRow', () => {
  it('draws one warn row first in the body, across every column, with its title', () => {
    renderTable()
    const body = document.querySelector('tbody')
    expect(body?.firstElementChild).toBe(band())
    const cell = band().querySelector('td')
    expect(cell).toHaveAttribute('colspan', '2')
    expect(cell?.className).toContain(CS_BAND_WARN)
    expect(cell).toHaveAttribute('title', 'The 14:20 read was refused')
    expect(screen.getByText('⚠ The 14:20 read was refused')).toBeInTheDocument()
  })

  it('is no data row: the footer counts the rows only, and a click highlights nothing', async () => {
    renderTable()
    expect(screen.getByText('2 rows')).toBeInTheDocument()
    await userEvent.click(screen.getByText('⚠ The 14:20 read was refused'))
    expect(document.querySelector('tr[data-highlighted]')).toBeNull()
  })

  it('stays when the search empties the list, above the empty line', async () => {
    renderTable({ emptyText: 'No camper matches the search.' })
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'zzz')
    expect(band()).toBeInTheDocument()
    expect(screen.getByText('No camper matches the search.')).toBeInTheDocument()
    expect(document.querySelector('tbody')?.firstElementChild).toBe(band())
  })

  it('draws nothing without the prop', () => {
    renderTable({ bandRow: undefined })
    expect(document.querySelector('tr[data-band-row]')).toBeNull()
  })
})
