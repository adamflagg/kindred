/**
 * The table's opt-in screen box (grid layout T1, owner lock Scroll b): one scrolling box with the
 * header and totals held, so the horizontal scrollbar is always on screen. Opt-in: a table without
 * `scrollBox` renders as it always did. Fictional rows (tests/CLAUDE.md).
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AidTable, type AidColumn } from './AidTable'
import { Money } from './MoneyText'

interface Row {
  id: string
  camper: string
  note: string
  decided: number
}

const ROWS: Row[] = [
  { id: 'r1', camper: 'Emma Johnson', note: 'a', decided: 100 },
  { id: 'r2', camper: 'Liam Garcia', note: 'b', decided: 200 },
]

const COLUMNS: Array<AidColumn<Row>> = [
  { key: 'camper', header: 'Camper', width: 130, pinned: true, value: (r) => r.camper },
  { key: 'note', header: 'Note', width: 90, value: (r) => r.note },
  {
    key: 'decided',
    header: 'Decided',
    width: 90,
    align: 'right',
    value: (r) => r.decided,
    render: (r) => <Money value={r.decided} />,
    total: (rows) => rows.reduce((sum, r) => sum + r.decided, 0),
  },
]

function renderTable(scrollBox?: boolean, highlighted?: string | null) {
  return render(
    <MemoryRouter>
      <AidTable<Row>
        rows={ROWS}
        columns={COLUMNS}
        rowKey={(r) => r.id}
        csvFilename="x.csv"
        footerLabel={() => 'label'}
        {...(scrollBox === undefined ? {} : { scrollBox })}
        {...(highlighted === undefined ? {} : { highlighted, onHighlight: () => undefined })}
      />
    </MemoryRouter>
  )
}

const box = () => screen.getByRole('table').parentElement as HTMLElement
const th = (name: string) => screen.getByRole('columnheader', { name })
const classesOf = (el: Element) => el.className.split(/\s+/)

describe('AidTable scrollBox: the sticky contract', () => {
  it('scrolls both ways in one box that keeps its scroll to itself', () => {
    renderTable(true)
    expect(classesOf(box())).toEqual(
      expect.arrayContaining(['overflow-auto', 'overscroll-contain'])
    )
    expect(classesOf(box())).not.toContain('overflow-x-auto')
  })

  it('holds the header cells at the top, the pinned ones one layer above', () => {
    renderTable(true)
    expect(classesOf(th('Note'))).toEqual(expect.arrayContaining(['sticky', 'top-0', 'z-30']))
    expect(classesOf(th('Camper'))).toEqual(expect.arrayContaining(['sticky', 'top-0', 'z-40']))
    expect(classesOf(th('Camper'))).not.toContain('z-30')
  })

  it('holds the totals at the bottom, the pinned one a layer above, both over a pinned body cell', () => {
    renderTable(true)
    const cells = screen
      .getAllByRole('row')
      .at(-1)
      ?.querySelectorAll('td') as NodeListOf<HTMLElement>
    expect(classesOf(cells[0] as HTMLElement)).toEqual(
      expect.arrayContaining(['sticky', 'bottom-0', 'z-40'])
    )
    expect(classesOf(cells[1] as HTMLElement)).toEqual(
      expect.arrayContaining(['sticky', 'bottom-0', 'z-30'])
    )
    const body = screen.getByText('Emma Johnson').closest('td') as HTMLElement
    expect(classesOf(body)).toContain('z-10')
  })
})

describe('AidTable scrollBox: the totals label', () => {
  it('wraps inside its pinned cell, so a label wider than the Camper column never prints over a total', () => {
    renderTable(true)
    const label = screen.getByText('label').closest('td') as HTMLElement
    expect(classesOf(label)).toContain('whitespace-normal')
    expect(classesOf(label)).not.toContain('whitespace-nowrap')
  })

  it('keeps one line without the box', () => {
    renderTable()
    const label = screen.getByText('label').closest('td') as HTMLElement
    expect(classesOf(label)).toContain('whitespace-nowrap')
  })
})

describe('AidTable scrollBox: its height', () => {
  const realInner = window.innerHeight
  let top = 200
  beforeEach(() => {
    top = 200
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const isBox = this.className.includes('overscroll-contain')
      return {
        top: isBox ? top : 0,
        height: 0,
        bottom: 0,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'innerHeight', { value: realInner, configurable: true })
  })
  const setInner = (h: number) =>
    Object.defineProperty(window, 'innerHeight', { value: h, configurable: true })

  it('runs from the box top to the bottom of the screen, less a 12px gap', () => {
    setInner(900)
    renderTable(true)
    expect(box().style.maxHeight).toBe('688px')
  })

  // Spec change (RULED screen box (a)): the floor is 200px, so the box ends inside a 720px screen.
  it('never goes under 200px', () => {
    setInner(380)
    renderTable(true)
    expect(box().style.maxHeight).toBe('200px')
  })

  it('ends inside a short screen rather than holding a taller floor', () => {
    setInner(500)
    renderTable(true)
    expect(box().style.maxHeight).toBe('288px')
  })

  it('measures again when the window resizes and when the box moves', () => {
    setInner(900)
    renderTable(true)
    setInner(700)
    act(() => {
      fireEvent(window, new Event('resize'))
    })
    expect(box().style.maxHeight).toBe('488px')
    top = 260
    act(() => {
      fireEvent(window, new Event('resize'))
    })
    expect(box().style.maxHeight).toBe('428px')
  })
})

describe('AidTable scrollBox: the highlighted row stays clear of the held header and totals', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const h = this.tagName === 'THEAD' ? 44 : this.tagName === 'TFOOT' ? 33 : 0
      return {
        top: 0,
        height: h,
        bottom: 0,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('leaves a scroll margin as tall as the header above and the totals below', () => {
    renderTable(true, 'r2')
    const row = screen.getByText('Liam Garcia').closest('tr') as HTMLElement
    expect(row.style.scrollMarginTop).toBe('44px')
    expect(row.style.scrollMarginBottom).toBe('33px')
  })
})

describe('AidTable without scrollBox', () => {
  it('renders exactly as before: x-scroll card, no max-height, no held header or totals, no margins', () => {
    renderTable(undefined, 'r2')
    expect(box().className).toBe(
      'bg-card border-border shadow-lodge-sm overflow-x-auto rounded-xl border'
    )
    expect(box().style.maxHeight).toBe('')
    expect(th('Note').className).not.toMatch(/sticky|top-0/)
    expect(th('Camper').className).toMatch(/\bsticky z-20\b/)
    const row = screen.getByText('Liam Garcia').closest('tr') as HTMLElement
    expect(row.getAttribute('style')).toBeNull()
    const foot = screen.getAllByRole('row').at(-1)?.querySelectorAll('td')[1] as HTMLElement
    expect(foot.className).not.toMatch(/bottom-0/)
  })
})
