/**
 * AidTable's per-group sections (final UX, Money › To place; design-language §16, §19): each reason
 * group is its own heading, callout and table, as the approved mock draws them, while the search,
 * the checks, the ↑/↓ walk and the CSV stay the one table's. Also the search a page may hold itself,
 * so a second table on the page answers the same box. Fictional rows.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { AidTable, type AidColumn, type AidGrouping } from './AidTable'

interface Row {
  id: string
  camper: string
  reason: 'several' | 'none'
}
const ROWS: Row[] = [
  { id: 'a', camper: 'Emma Johnson', reason: 'several' },
  { id: 'b', camper: 'Liam Garcia', reason: 'several' },
  { id: 'c', camper: 'Olivia Chen', reason: 'none' },
]
const COLUMNS: Array<AidColumn<Row>> = [
  { key: 'camper', header: 'Camper', width: 150, value: (r) => r.camper, searchable: true },
]
const GROUPINGS: Array<AidGrouping<Row>> = [
  {
    key: 'reason',
    label: 'By reason',
    groupOf: (r) => ({ id: r.reason, heading: r.reason === 'several' ? 'Several' : 'No request' }),
  },
]

function Harness({
  withSections = true,
  selectable = false,
}: {
  withSections?: boolean
  selectable?: boolean
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  return (
    <MemoryRouter>
      <AidTable<Row>
        rows={ROWS}
        columns={COLUMNS}
        rowKey={(r) => r.id}
        csvFilename="x.csv"
        groupings={GROUPINGS}
        defaultGrouping="reason"
        {...(selectable ? { selected, onSelectedChange: setSelected } : {})}
        {...(withSections
          ? {
              groupSections: (g) => (
                <div data-testid={`section-${g.id || 'flat'}`}>
                  <button type="button" onClick={g.toggle}>
                    {g.grouped ? (g.folded ? '▸' : '▾') : ''} {g.heading || 'All'}
                  </button>
                  <span>{g.rows.length} rows</span>
                </div>
              ),
            }
          : {})}
      />
    </MemoryRouter>
  )
}

describe('groupSections: one heading, callout and table per group', () => {
  it('draws each group as its own table with its own header, and the page’s section above it', () => {
    render(<Harness />)
    expect(document.querySelectorAll('table')).toHaveLength(2)
    expect(document.querySelectorAll('thead')).toHaveLength(2)
    expect(screen.getByTestId('section-several')).toHaveTextContent('Several')
    expect(screen.getByTestId('section-none')).toHaveTextContent('No request')
    // The section sits before its table, and no group row is drawn inside a table.
    const section = screen.getByTestId('section-several')
    expect(section.closest('[data-aid-section]')?.querySelector('table')).not.toBeNull()
    expect(document.querySelector('[data-group-heading]')).toBeNull()
  })

  it('gives each section its matching rows and tracks the search', async () => {
    render(<Harness />)
    expect(screen.getByTestId('section-several')).toHaveTextContent('2 rows')
    await userEvent.type(screen.getByRole('searchbox'), 'Emma')
    expect(screen.getByTestId('section-several')).toHaveTextContent('1 rows')
    // A group the search empties draws nothing, not an empty table.
    expect(screen.queryByTestId('section-none')).toBeNull()
    expect(document.querySelectorAll('table')).toHaveLength(1)
  })

  it('folds a group through the section’s toggle: its table goes, its section stays', async () => {
    render(<Harness />)
    await userEvent.click(within(screen.getByTestId('section-several')).getByRole('button'))
    expect(document.querySelectorAll('table')).toHaveLength(1)
    expect(screen.getByTestId('section-several')).toHaveTextContent('▸')
    expect(screen.queryByText('Emma Johnson')).toBeNull()
    await userEvent.click(within(screen.getByTestId('section-several')).getByRole('button'))
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
  })

  it('Flat is one section with no fold glyph, over one table', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Flat' }))
    expect(screen.getByTestId('section-flat')).toHaveTextContent('3 rows')
    expect(document.querySelectorAll('table')).toHaveLength(1)
  })

  it('checks a group’s rows from its own header box, leaving the other group alone', async () => {
    render(<Harness selectable />)
    const tables = document.querySelectorAll('table')
    const headBox = within(tables[0] as HTMLElement).getByRole('checkbox', { name: 'Select all' })
    await userEvent.click(headBox)
    const first = within(tables[0] as HTMLElement).getAllByRole('checkbox', { name: 'Select' })
    const second = within(tables[1] as HTMLElement).getAllByRole('checkbox', { name: 'Select' })
    expect(first.every((b) => (b as HTMLInputElement).checked)).toBe(true)
    expect(second.some((b) => (b as HTMLInputElement).checked)).toBe(false)
  })

  it('without groupSections the one table keeps its group rows, as every other screen draws it', () => {
    render(<Harness withSections={false} />)
    expect(document.querySelectorAll('table')).toHaveLength(1)
    expect(document.querySelectorAll('[data-group-heading]')).toHaveLength(2)
  })
})

describe('a search the page holds (query, onQueryChange)', () => {
  function Two() {
    const [q, setQ] = useState('')
    return (
      <MemoryRouter>
        <AidTable<Row>
          rows={ROWS}
          columns={COLUMNS}
          rowKey={(r) => r.id}
          csvFilename="x.csv"
          query={q}
          onQueryChange={setQ}
        />
        <div data-testid="second">
          <AidTable<Row>
            rows={ROWS}
            columns={COLUMNS}
            rowKey={(r) => `second-${r.id}`}
            csvFilename="y.csv"
            hideToolbar
            query={q}
            urlPrefix="second_"
          />
        </div>
      </MemoryRouter>
    )
  }

  it('one box filters both tables', async () => {
    render(<Two />)
    expect(screen.getAllByText('Liam Garcia')).toHaveLength(2)
    await userEvent.type(screen.getByRole('searchbox'), 'Liam')
    expect(screen.getAllByText('Liam Garcia')).toHaveLength(2)
    expect(screen.queryByText('Emma Johnson')).toBeNull()
    expect(within(screen.getByTestId('second')).getByText('Liam Garcia')).toBeInTheDocument()
  })
})
