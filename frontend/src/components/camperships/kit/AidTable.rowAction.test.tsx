/**
 * A row action that fits the grid row (design-language rule 20): the kit's buttons are 26px, which would make
 * an action row taller than its neighbours. CS_ROW_BTN is 20px, the cell's own line, so a row with the button
 * stays the grid's 30px (5px padding, a 20px line, 5px padding). `aidActionColumn` puts it in a column that
 * neither sorts nor exports. Fictional rows.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { AidTable, type AidColumn } from './AidTable'
import { aidActionColumn } from './RowAction'
import * as cs from './csType'

interface Row {
  id: string
  camper: string
  gap: boolean
}
const ROWS: Row[] = [
  { id: 'a', camper: 'Emma Johnson', gap: true },
  { id: 'b', camper: 'Liam Garcia', gap: false },
]

function renderTable(onAdd = vi.fn(), extra: Partial<Parameters<typeof AidTable<Row>>[0]> = {}) {
  const columns: Array<AidColumn<Row>> = [
    { key: 'camper', header: 'Camper', width: 150, value: (r) => r.camper },
    aidActionColumn<Row>({
      width: 132,
      action: (r) =>
        r.gap
          ? {
              label: 'Add a Request…',
              title: 'Add the missing request',
              onClick: () => onAdd(r.id),
            }
          : null,
    }),
  ]
  render(
    <MemoryRouter>
      <AidTable<Row>
        rows={ROWS}
        columns={columns}
        rowKey={(r) => r.id}
        csvFilename="x.csv"
        {...extra}
      />
    </MemoryRouter>
  )
  return onAdd
}
const rowOf = (key: string) => document.querySelector(`tr[data-row-key="${key}"]`) as HTMLElement

describe('CS_ROW_BTN: a row action that fits the 30px grid row', () => {
  it('is 20px tall, border-box, on a 16px line, so it never outgrows the cell line (text-sm/20)', () => {
    expect(cs.CS_ROW_BTN).toContain('h-5')
    expect(cs.CS_ROW_BTN).toContain('box-border')
    expect(cs.CS_ROW_BTN).toContain('leading-4')
    expect(cs.CS_ROW_BTN).toContain('text-xs')
    // no vertical padding of its own (the 20px is the whole box) and never the 26px control height
    expect(cs.CS_ROW_BTN).not.toMatch(/\bpy-(?!0\b)/)
    expect(cs.CS_ROW_BTN).not.toContain(cs.CS_CTL_H)
  })

  it('wears the household card button grammar: card white, forest ink in both themes, semibold, Title Case left to the words', () => {
    for (const c of [
      'bg-card',
      'border-border',
      'text-forest-700',
      'dark:text-forest-300',
      'font-semibold',
    ])
      expect(cs.CS_ROW_BTN).toContain(c)
  })
})

describe('aidActionColumn', () => {
  it('draws the action as a CS_ROW_BTN button inside a plain grid cell (TD: 5px padding), so the row keeps its height', () => {
    renderTable()
    const button = within(rowOf('a')).getByRole('button', { name: 'Add a Request…' })
    expect(button.className).toBe(cs.CS_ROW_BTN)
    expect(button).toHaveAttribute('title', 'Add the missing request')
    const cell = button.closest('td') as HTMLElement
    expect(cell).toHaveClass('py-[5px]', 'whitespace-nowrap')
  })

  it('draws an empty cell, not a dash, on a row with no action', () => {
    renderTable()
    const cells = rowOf('b').querySelectorAll('td')
    expect(cells[1]).toHaveTextContent(/^$/)
    expect(within(rowOf('b')).queryByRole('button')).toBeNull()
  })

  it('runs the action, and the click still opens the row (the editor goes in its detail line)', () => {
    const onAdd = renderTable()
    fireEvent.click(within(rowOf('a')).getByRole('button', { name: 'Add a Request…' }))
    expect(onAdd).toHaveBeenCalledWith('a')
    expect(rowOf('a')).toHaveAttribute('data-highlighted', 'true')
  })

  it('has a header that does not sort, and stays out of the CSV', () => {
    renderTable()
    const headers = document.querySelectorAll('thead th')
    expect(headers[1]?.querySelector('button')).toBeNull()
    const col = aidActionColumn<Row>({ action: () => null })
    expect(col.inCsv).toBe(false)
    expect(col.sortable).toBe(false)
    expect(col.header).toBe('')
  })
})

describe('AidColumn.sortable', () => {
  it('false leaves that one header unsortable while the others still sort', () => {
    render(
      <MemoryRouter>
        <AidTable<Row>
          rows={ROWS}
          columns={[
            { key: 'camper', header: 'Camper', value: (r) => r.camper },
            { key: 'gap', header: 'Gap', sortable: false, value: (r) => String(r.gap) },
          ]}
          rowKey={(r) => r.id}
          csvFilename="x.csv"
        />
      </MemoryRouter>
    )
    const [camper, gap] = [...document.querySelectorAll('thead th')]
    expect(camper?.querySelector('button')).not.toBeNull()
    expect(gap?.querySelector('button')).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Gap' })).toBeInTheDocument()
  })
})
