/**
 * Batch 4 (owner LOCKED, grid-layout-options.html#or=i, round 6): a column frozen on the right whose
 * width fits the widest chip on screen, and the opened row's detail line, which wraps and stays put
 * while the rows scroll sideways. jsdom has no layout, so widths come from mocked rects and the
 * sticky behaviour is held by its class and style contract (Playwright is the real proof).
 * Fictional rows (tests/CLAUDE.md).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AidTable, type AidColumn } from './AidTable'

interface Row {
  id: string
  camper: string
  chip: string
}

const ROWS: Row[] = [
  { id: 'r1', camper: 'Emma Johnson', chip: 'Placeholder income' },
  { id: 'r2', camper: 'Liam Garcia', chip: 'On hold' },
  { id: 'r3', camper: 'Olivia Chen', chip: '' },
]

const COLUMNS: Array<AidColumn<Row>> = [
  { key: 'camper', header: 'Camper', width: 130, pinned: true, value: (r) => r.camper },
  { key: 'spare', header: 'Family', width: 130, flex: true, value: () => 'x' },
  {
    key: 'chip',
    header: 'Needs attention',
    pinnedRight: true,
    fitContent: { pad: 18, min: 84 },
    value: (r) => r.chip,
    render: (r) => (r.chip === '' ? null : <span data-testid="chip">{r.chip}</span>),
  },
]

function Table({ rows = ROWS, detail = true }: { rows?: readonly Row[]; detail?: boolean }) {
  const [highlighted, setHighlighted] = useState<string | null>(null)
  return (
    <MemoryRouter>
      <AidTable<Row>
        rows={rows}
        columns={COLUMNS}
        rowKey={(r) => r.id}
        csvFilename="x.csv"
        arrowKeys
        scrollBox
        highlighted={highlighted}
        onHighlight={setHighlighted}
        {...(detail ? { renderDetail: (r: Row) => <span>Detail of {r.camper}</span> } : {})}
      />
    </MemoryRouter>
  )
}

const classesOf = (el: Element) => el.className.split(/\s+/)
const chipCol = () => screen.getByRole('table').querySelectorAll('col')[2] as HTMLElement
const rowOf = (camper: string) => screen.getByText(camper).closest('tr') as HTMLElement

// A chip is as wide as 7px a character; the scroll box is 900px wide inside.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const width = this.dataset['testid'] === 'chip' ? this.textContent.length * 7 : 0
    return { top: 0, bottom: 0, left: 0, right: width, width, height: 0, x: 0, y: 0, toJSON() {} }
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement
  ) {
    return this.className.includes('overscroll-contain') ? 900 : 0
  })
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('AidTable: a column frozen on the right', () => {
  it('holds its header, body and footer cells at the right edge, over the scrolling cells', () => {
    render(<Table />)
    const th = screen.getByRole('columnheader', { name: 'Needs attention' })
    expect(th.style.right).toBe('0px')
    expect(classesOf(th)).toEqual(expect.arrayContaining(['sticky', 'top-0', 'z-40']))
    const td = screen.getByText('Placeholder income').closest('td') as HTMLElement
    expect(td.style.right).toBe('0px')
    expect(classesOf(td)).toEqual(expect.arrayContaining(['sticky', 'z-10']))
    // Not pinned on the left as well.
    expect(td.style.left).toBe('')
  })
})

describe('AidTable: a column that fits its widest chip on screen', () => {
  it('is the widest rendered chip plus its padding', () => {
    render(<Table />)
    // "Placeholder income" is 18 characters: 126 + 18.
    expect(chipCol().style.width).toBe('144px')
  })

  it('re-measures when the rows change, down to the floor', () => {
    const { rerender } = render(<Table />)
    expect(chipCol().style.width).toBe('144px')
    rerender(<Table rows={ROWS.filter((r) => r.id !== 'r1')} />)
    // "On hold": 49 + 18 is under the floor.
    expect(chipCol().style.width).toBe('84px')
    rerender(<Table rows={ROWS} />)
    expect(chipCol().style.width).toBe('144px')
  })

  it('follows the search: only the rows drawn count', async () => {
    render(<Table />)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'liam')
    expect(chipCol().style.width).toBe('84px')
  })
})

describe('AidTable: the opened row and its detail line', () => {
  it('opens a detail line under the clicked row only', async () => {
    render(<Table />)
    expect(screen.queryByText(/^Detail of/)).toBeNull()
    await userEvent.click(screen.getByText('Liam Garcia'))
    expect(screen.getAllByText(/^Detail of/)).toHaveLength(1)
    const detailRow = screen.getByText('Detail of Liam Garcia').closest('tr') as HTMLElement
    expect(detailRow.previousElementSibling).toBe(rowOf('Liam Garcia'))
    expect(detailRow).toHaveAttribute('data-aid-detail')
  })

  it('opens it with ↓ and moves it with ↑/↓, and Esc closes it', async () => {
    render(<Table />)
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByText('Detail of Emma Johnson')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByText('Detail of Liam Garcia')).toBeInTheDocument()
    expect(screen.queryByText('Detail of Emma Johnson')).toBeNull()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText(/^Detail of/)).toBeNull()
    expect(rowOf('Liam Garcia')).not.toHaveAttribute('data-highlighted')
  })

  it('leaves Esc to the search box while you type in it', async () => {
    render(<Table />)
    await userEvent.click(screen.getByText('Liam Garcia'))
    await userEvent.click(screen.getByRole('searchbox', { name: 'Search' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.getByText('Detail of Liam Garcia')).toBeInTheDocument()
  })

  it('stays put on a sideways scroll: its cell does not clip, and the line sticks at the left as wide as the box', async () => {
    render(<Table />)
    await userEvent.click(screen.getByText('Liam Garcia'))
    const line = screen.getByText('Detail of Liam Garcia').parentElement as HTMLElement
    const cell = line.closest('td') as HTMLTableCellElement
    expect(cell.colSpan).toBe(3)
    expect(classesOf(cell)).toEqual(expect.arrayContaining(['overflow-visible', 'px-0']))
    expect(classesOf(cell)).not.toContain('overflow-hidden')
    expect(classesOf(line)).toEqual(
      expect.arrayContaining(['sticky', 'left-0', 'whitespace-normal'])
    )
    expect(line.style.width).toBe('900px')
  })

  it('follows the box when the window resizes', async () => {
    render(<Table />)
    await userEvent.click(screen.getByText('Liam Garcia'))
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return this.className.includes('overscroll-contain') ? 700 : 0
    })
    act(() => {
      fireEvent(window, new Event('resize'))
    })
    const line = screen.getByText('Detail of Liam Garcia').parentElement as HTMLElement
    expect(line.style.width).toBe('700px')
  })

  it('is not a row click: clicking inside it keeps the row open', async () => {
    render(<Table />)
    await userEvent.click(screen.getByText('Liam Garcia'))
    await userEvent.click(screen.getByText('Detail of Liam Garcia'))
    expect(rowOf('Liam Garcia')).toHaveAttribute('data-highlighted', 'true')
    expect(within(screen.getByRole('table')).getAllByText(/^Detail of/)).toHaveLength(1)
  })

  it('draws no detail line without renderDetail', async () => {
    render(<Table detail={false} />)
    await userEvent.click(screen.getByText('Liam Garcia'))
    expect(document.querySelector('[data-aid-detail]')).toBeNull()
  })
})
