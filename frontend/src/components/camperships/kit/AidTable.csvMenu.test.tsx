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

  it('draws the status below the toolbar, nothing under it before then', () => {
    renderTable(true)
    expect(toolbar().nextElementSibling).toHaveTextContent('Status Line')
    expect(toolbar()).not.toHaveTextContent('Status Line')
  })
})
