/** AidTable's `toolbarTrail` (slice 3 PR 4; review item 28): drawn right after Download CSV, on its line. */
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { AidTable, type AidColumn } from './AidTable'

interface Row {
  readonly id: string
  readonly name: string
}
const ROWS: readonly Row[] = [{ id: 'r1', name: 'Emma Johnson' }]
const COLUMNS: ReadonlyArray<AidColumn<Row>> = [
  { key: 'name', header: 'Name', value: (r) => r.name },
]
const rowKey = (r: Row) => r.id

describe('AidTable toolbarTrail', () => {
  it('draws the trail inside the toolbar, right after Download CSV', () => {
    render(
      <MemoryRouter>
        <AidTable
          rows={ROWS}
          columns={COLUMNS}
          rowKey={rowKey}
          csvFilename="x.csv"
          toolbarTrail={<button type="button">Trail Button</button>}
        />
      </MemoryRouter>
    )
    const toolbar = screen.getByLabelText('Search').closest('[data-aid-toolbar]') as HTMLElement
    const buttons = within(toolbar).getAllByRole('button')
    const csv = buttons.findIndex((b) => b.textContent === 'Download CSV')
    expect(buttons[csv + 1]).toHaveTextContent('Trail Button')
    // The CSV button keeps the pair at the right end of the line.
    expect(buttons[csv]).toHaveClass('ml-auto')
  })

  it('draws nothing extra without one', () => {
    render(
      <MemoryRouter>
        <AidTable rows={ROWS} columns={COLUMNS} rowKey={rowKey} csvFilename="x.csv" />
      </MemoryRouter>
    )
    const toolbar = screen.getByLabelText('Search').closest('[data-aid-toolbar]') as HTMLElement
    const buttons = within(toolbar).getAllByRole('button')
    expect(buttons.at(-1)).toHaveTextContent('Download CSV')
  })
})
