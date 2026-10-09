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
  // Design language §23 (owner: "how do staff ever see footnotes?"): scroll chaining stays on, so a
  // wheel at the box's end carries on scrolling the page to the notes below it.
  it('scrolls both ways in one box, and hands the wheel back to the page at its ends', () => {
    renderTable(true)
    expect(classesOf(box())).toContain('overflow-auto')
    expect(classesOf(box())).not.toContain('overscroll-contain')
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
      const isBox = this.hasAttribute('data-aid-scroll-box')
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

  // Design language §23: the box stops about 40px short of the window's bottom edge, so the first
  // footnote line peeks above the fold on first load: max(420px, 100vh − its top − 40px).
  it('runs from the box top to 40px short of the bottom of the screen', () => {
    setInner(900)
    renderTable(true)
    expect(box().style.maxHeight).toBe('660px')
  })

  // §23 replaces the 200px floor (RULED screen box (a)) with 420px: on a short screen the box keeps
  // 420px and the page, which still scrolls, carries the notes below it.
  it('never goes under 420px', () => {
    setInner(380)
    renderTable(true)
    expect(box().style.maxHeight).toBe('420px')
  })

  it('holds the 420px floor on a short screen, the page scrolling on to the notes', () => {
    setInner(500)
    renderTable(true)
    expect(box().style.maxHeight).toBe('420px')
  })

  it('measures again when the window resizes and when the box moves', () => {
    setInner(900)
    renderTable(true)
    setInner(800)
    act(() => {
      fireEvent(window, new Event('resize'))
    })
    expect(box().style.maxHeight).toBe('560px')
    top = 260
    act(() => {
      fireEvent(window, new Event('resize'))
    })
    expect(box().style.maxHeight).toBe('500px')
  })
})

describe('AidTable scrollBox: content above the box changes height', () => {
  const realInner = window.innerHeight
  let top = 200
  beforeEach(() => {
    top = 200
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      return {
        top: this.hasAttribute('data-aid-scroll-box') ? top : 0,
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

  // A view change (a note appearing above the box) re-renders the table with other columns and
  // fires no resize: the box must still be measured again.
  it('measures again on a re-render, without a resize', () => {
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
    const tree = (columns: Array<AidColumn<Row>>) => (
      <MemoryRouter>
        <AidTable<Row>
          rows={ROWS}
          columns={columns}
          rowKey={(r) => r.id}
          csvFilename="x.csv"
          footerLabel={() => 'label'}
          scrollBox
        />
      </MemoryRouter>
    )
    const { rerender } = render(tree(COLUMNS))
    expect(box().style.maxHeight).toBe('660px')
    top = 232
    rerender(tree(COLUMNS.slice(0, 2)))
    expect(box().style.maxHeight).toBe('628px')
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
