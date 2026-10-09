/** AidTable's `csvMenu` (slice 3 rework R1; variant A): Download CSV becomes a split button with a menu. */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { AidTable, type AidColumn } from './AidTable'

interface Row {
  readonly id: string
  readonly name: string
}
const downloaded: string[] = []
vi.mock('../../../utils/csvExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/csvExport')>()),
  downloadCsv: (_content: string, name: string) => {
    downloaded.push(name)
  },
}))

const ROWS: readonly Row[] = [{ id: 'r1', name: 'Emma Johnson' }]
const COLUMNS: ReadonlyArray<AidColumn<Row>> = [
  { key: 'name', header: 'Name', value: (r) => r.name },
]
const rowKey = (r: Row) => r.id

function renderTable(withMenu: boolean) {
  return render(
    <MemoryRouter>
      <AidTable
        rows={ROWS}
        columns={COLUMNS}
        rowKey={rowKey}
        csvFilename="x.csv"
        csvMenu={withMenu ? <button type="button">Menu Extra</button> : undefined}
        toolbarStatus={withMenu ? <p>Status Line</p> : undefined}
      />
    </MemoryRouter>
  )
}
const toolbar = () => screen.getByLabelText('Search').closest('[data-aid-toolbar]') as HTMLElement
const caret = () => within(toolbar()).queryByRole('button', { name: 'More downloads' })

describe('AidTable csvMenu', () => {
  it('stays closed when the menu goes away and comes back (a view change), not reopening by itself', async () => {
    const table = (withMenu: boolean) => (
      <MemoryRouter>
        <AidTable
          rows={ROWS}
          columns={COLUMNS}
          rowKey={rowKey}
          csvFilename="x.csv"
          csvMenu={withMenu ? <button type="button">Menu Extra</button> : undefined}
        />
      </MemoryRouter>
    )
    const { rerender } = render(table(true))
    await userEvent.click(caret()!)
    expect(screen.getByText('Menu Extra')).toBeInTheDocument()
    rerender(table(false))
    rerender(table(true))
    expect(screen.queryByText('Menu Extra')).toBeNull()
  })

  it('draws a plain Download CSV, no caret, without one', () => {
    renderTable(false)
    expect(within(toolbar()).getByRole('button', { name: 'Download CSV' })).toBeInTheDocument()
    expect(caret()).toBeNull()
  })

  it('draws the split control: Download CSV with a caret after it, menu closed', () => {
    renderTable(true)
    const buttons = within(toolbar()).getAllByRole('button')
    const csv = buttons.findIndex((b) => b.textContent === 'Download CSV')
    expect(buttons[csv + 1]).toBe(caret())
    expect(screen.queryByText('Menu Extra')).toBeNull()
  })

  it('opens a menu with Download CSV and its hint, a rule, then the extra items', async () => {
    renderTable(true)
    await userEvent.click(caret() as HTMLElement)
    const menu = screen.getByTestId('csv-menu')
    expect(within(menu).getByText('This list, as filtered')).toBeInTheDocument()
    expect(within(menu).getByRole('button', { name: /Download CSV/ })).toBeInTheDocument()
    expect(within(menu).getByRole('separator')).toBeInTheDocument()
    expect(within(menu).getByText('Menu Extra')).toBeInTheDocument()
  })

  it('sits above the sticky table headers (they are z-40): the control and the menu are z-50', async () => {
    renderTable(true)
    const caret = screen.getByRole('button', { name: 'More downloads' })
    expect(caret.parentElement).toHaveClass('z-50')
    await userEvent.click(caret)
    expect(screen.getByTestId('csv-menu')).toHaveClass('z-50')
  })

  it('closes on Escape and on an outside click, not on a click inside', async () => {
    renderTable(true)
    await userEvent.click(caret() as HTMLElement)
    expect(screen.getByTestId('csv-menu')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('csv-menu')).toBeNull()
    await userEvent.click(caret() as HTMLElement)
    await userEvent.click(screen.getByText('Name'))
    expect(screen.queryByTestId('csv-menu')).toBeNull()
  })

  it('the main part and the menu item both download the CSV, and the menu then closes', async () => {
    downloaded.length = 0
    renderTable(true)
    await userEvent.click(within(toolbar()).getByRole('button', { name: 'Download CSV' }))
    expect(downloaded).toHaveLength(1)
    await userEvent.click(caret() as HTMLElement)
    await userEvent.click(
      within(screen.getByTestId('csv-menu')).getByRole('button', { name: /Download CSV/ })
    )
    expect(downloaded).toHaveLength(2)
    expect(screen.queryByTestId('csv-menu')).toBeNull()
  })

  // Design language §5–6: the result of an action sits in the toolbar's status slot, on the same
  // row, never in a line that comes and goes under it (replaces the slice 3 status line).
  it('draws the status in the toolbar row, before Download CSV, and no line under the toolbar', () => {
    renderTable(true)
    expect(toolbar()).toHaveTextContent('Status Line')
    expect(toolbar().nextElementSibling).not.toHaveTextContent('Status Line')
    const text = toolbar().textContent
    expect(text.indexOf('Status Line')).toBeLessThan(text.indexOf('Download CSV'))
  })

  // §4: the caret part of the split is 22px; the whole control is the small 26px button.
  it('draws the split small: a 26px button and a 22px caret', () => {
    renderTable(true)
    expect(screen.getByRole('button', { name: 'More downloads' })).toHaveClass(
      'w-[22px]',
      'h-[26px]'
    )
    expect(within(toolbar()).getByRole('button', { name: 'Download CSV' })).toHaveClass('h-[26px]')
  })
})
