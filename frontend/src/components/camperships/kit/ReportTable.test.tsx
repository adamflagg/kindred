/**
 * The Reports table (spec §9; RPT-33; §11): the server's rows and totals as sent, Copy as displayed,
 * the CSV, the find box and the sort.
 */
import { act, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  countValue,
  moneyValue,
  pctValue,
  textValue,
  type ReportColumn,
  type ReportRow,
} from './report'
import { CS_BAND, CS_CARD_HEADING } from './csType'
import { CS_RULE_GROUP } from './kitStyles'
import { ReportTable } from './ReportTable'
import { useReportExport } from './useReportExport'

const downloadCsv = vi.fn<(content: string, name: string) => void>()
vi.mock('../../../utils/csvExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/csvExport')>()),
  downloadCsv: (content: string, name: string) => downloadCsv(content, name),
}))

const HEADING = {
  title: 'Every camper',
  season: 2027,
  figuresOn: '2027-06-03',
  live: true,
  basis: null,
}
const COLUMNS: ReportColumn[] = [
  { key: 'zip', header: 'ZIP' },
  { key: 'campers', header: 'Campers' },
  { key: 'dollars', header: 'Dollars', note: 1 },
]
const ROWS: ReportRow[] = [
  { key: '00010', kind: 'body', cells: [textValue('00010'), countValue(4), moneyValue(1200)] },
  { key: '00012', kind: 'body', cells: [textValue('00012'), countValue(9), moneyValue(300)] },
  {
    key: 'outside',
    kind: 'end',
    cells: [textValue('Outside the US'), countValue(20), moneyValue(0)],
  },
  {
    key: 'total',
    kind: 'total',
    cells: [textValue('All · 2 ZIPs'), countValue(31), moneyValue(1500)],
  },
]

let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>

beforeEach(() => {
  writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  downloadCsv.mockClear()
})
afterEach(() => vi.restoreAllMocks())

function renderTable(extra: Partial<Parameters<typeof ReportTable>[0]> = {}, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ReportTable
        heading={HEADING}
        columns={COLUMNS}
        rows={ROWS}
        csvFilename="camperships-reports-zip-2027.csv"
        link="/aid/reports/development/zip?year=2027"
        {...extra}
      />
    </MemoryRouter>
  )
}

const bodyTexts = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent)

describe('ReportTable', () => {
  it("draws the server's rows and its total as sent, never a sum (D21)", () => {
    renderTable()
    expect(bodyTexts()).toEqual(['00010', '00012', 'Outside the US', 'All · 2 ZIPs'])
    expect(screen.getByText('$1,500')).toBeInTheDocument()
  })

  it('copies the whole table as displayed, headed by its season and as-of (RPT-33)', async () => {
    renderTable()
    await userEvent.click(screen.getByRole('button', { name: /Copy/ }))
    const copied = writeText.mock.calls[0]?.[0] ?? ''
    expect(copied.split('\n')).toEqual([
      'Every camper',
      'Season 2027 · As of Jun 3, 2027 (live)',
      '',
      'ZIP\tCampers\tDollars',
      '00010\t4\t$1,200',
      '00012\t9\t$300',
      'Outside the US\t20\t$0',
      'All · 2 ZIPs\t31\t$1,500',
    ])
    expect(screen.getByText(/Copied, with its as-of date and basis/)).toBeInTheDocument()
  })

  it('downloads the CSV with plain numbers, its heading and the link (§11)', async () => {
    renderTable()
    await userEvent.click(screen.getByRole('button', { name: /Download CSV/ }))
    const [content, name] = downloadCsv.mock.calls[0] ?? ['', '']
    expect(name).toBe('camperships-reports-zip-2027.csv')
    expect(content.split('\n')).toEqual([
      'Every camper',
      // RFC 4180: a line with a comma is quoted.
      '"Season 2027 · As of Jun 3, 2027 (live)"',
      '',
      'ZIP,Campers,Dollars',
      '00010,4,1200',
      '00012,9,300',
      'Outside the US,20,0',
      'All · 2 ZIPs,31,1500',
      '',
      'Link,/aid/reports/development/zip?year=2027',
    ])
  })

  it('finds body rows only: the totals row stays, and the toolbar says it is the whole table', async () => {
    renderTable({ find: true })
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find in Every camper' }), '00012')
    expect(bodyTexts()).toEqual(['00012', 'All · 2 ZIPs'])
    expect(screen.getByTestId('find-status')).toHaveTextContent('1 of 2')
    await userEvent.click(screen.getByRole('button', { name: /Copy/ }))
    expect(writeText.mock.calls[0]?.[0]).toContain('00010')
  })

  it('sorts the body rows, keeping "Outside the US" and the totals last', async () => {
    renderTable({ sortable: true })
    await userEvent.click(screen.getByRole('button', { name: 'Campers' }))
    await userEvent.click(screen.getByRole('button', { name: 'Campers' }))
    expect(bodyTexts()).toEqual(['00012', '00010', 'Outside the US', 'All · 2 ZIPs'])
  })

  it("opens a count's requests from its cell, never a zero, and copies the words alone (D20)", async () => {
    const linked: ReportRow[] = [
      {
        key: '00010',
        kind: 'body',
        cells: [textValue('00010'), countValue(4), moneyValue(1200)],
        links: { 1: '/aid/requests?report=x', 2: '/aid/requests?report=y' },
      },
      {
        key: '00012',
        kind: 'body',
        cells: [textValue('00012'), countValue(0), moneyValue(300)],
        links: { 1: '/aid/requests?report=z' },
      },
    ]
    renderTable({ rows: linked })
    expect(screen.getByRole('link', { name: '4' })).toHaveAttribute(
      'href',
      '/aid/requests?report=x'
    )
    expect(screen.queryByRole('link', { name: '0' })).toBeNull()
    // money never links: the requests behind a count are counted, not dollars
    expect(screen.queryByRole('link', { name: '$1,200' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Copy/ }))
    expect(writeText.mock.calls[0]?.[0]).toContain('00010\t4\t$1,200')
  })

  it("links a name cell the row gives an href (Development's funder lines), copying the words alone", async () => {
    renderTable({
      rows: [
        {
          key: 'grantor-a',
          kind: 'body',
          cells: [textValue('Grantor A'), countValue(2), moneyValue(500)],
          links: { 0: '/aid/money/funders?funder=grantor_a' },
        },
      ],
    })
    expect(screen.getByRole('link', { name: 'Grantor A' })).toHaveAttribute(
      'href',
      '/aid/money/funders?funder=grantor_a'
    )
    await userEvent.click(screen.getByRole('button', { name: /Copy/ }))
    expect(writeText.mock.calls[0]?.[0]).toContain('Grantor A\t2\t$500')
  })

  it("keeps a column's note marker and width when the table sorts (ZIP codes' Campers note)", () => {
    renderTable({
      sortable: true,
      columns: [...COLUMNS.slice(0, 2), { key: 'dollars', header: 'Dollars', note: 1, width: 120 }],
    })
    const th = screen.getByRole('columnheader', { name: /Dollars/ })
    expect(th.querySelector('sup')?.textContent).toBe('1')
    expect(th.style.width).toBe('120px')
    expect(screen.getByRole('button', { name: 'Dollars' })).toBeInTheDocument()
  })

  it('tints a decided column amber, its header and every cell (slice 4 K; D130)', () => {
    renderTable({
      columns: [...COLUMNS.slice(0, 2), { key: 'dollars', header: 'Dollars', tone: 'decided' }],
    })
    expect(screen.getByRole('columnheader', { name: 'Dollars' }).className).toContain('bg-amber-50')
    expect(screen.getByText('$1,200').closest('td')?.className).toContain('bg-amber-50')
    expect(screen.getByText('9').closest('td')?.className).not.toContain('bg-amber-50')
  })

  it('aligns a column of words left, as the mocks draw it, and figures right', () => {
    renderTable({
      columns: [COLUMNS[0]!, { key: 'campers', header: 'Campers', align: 'left' }, COLUMNS[2]!],
    })
    expect(screen.getByRole('columnheader', { name: 'Campers' }).className).toContain('text-left')
    expect(screen.getByText('9').closest('td')?.className).toContain('text-left')
    expect(screen.getByText('$1,200').closest('td')?.className).toContain('text-right')
  })

  it('says when copying is not possible here', async () => {
    writeText.mockImplementation(() => Promise.reject(new Error('denied')))
    renderTable()
    await userEvent.click(screen.getByRole('button', { name: /Copy/ }))
    expect(screen.getByText("Couldn't copy here: use Download CSV.")).toBeInTheDocument()
  })
  it("draws a count link as the mock's .lnk: primary, semibold, a dotted underline, no wrapping", () => {
    renderTable({
      rows: [
        {
          key: '00010',
          kind: 'body',
          cells: [textValue('00010'), countValue(4), moneyValue(1200)],
          links: { 1: '/aid/requests?report=x' },
        },
      ],
    })
    const cls = screen.getByRole('link', { name: '4' }).className
    for (const token of [
      'text-primary',
      'font-semibold',
      'border-b',
      'border-dotted',
      'border-primary',
      'whitespace-nowrap',
    ]) {
      expect(cls).toContain(token)
    }
  })

  it('draws a divider before a column flagged for one, header and cells, and no other', () => {
    renderTable({
      columns: [COLUMNS[0]!, { key: 'campers', header: 'Campers', divider: 'before' }, COLUMNS[2]!],
    })
    // Every column carries the light rule (§8); a flagged one swaps it for the firmer group rule.
    expect(screen.getByRole('columnheader', { name: 'Campers' }).className).toContain(CS_RULE_GROUP)
    expect(screen.getByText('9').closest('td')?.className).toContain(CS_RULE_GROUP)
    expect(screen.getByRole('columnheader', { name: /Dollars/ }).className).not.toContain(
      CS_RULE_GROUP
    )
    expect(screen.getByText('$1,200').closest('td')?.className).not.toContain(CS_RULE_GROUP)
  })

  it("draws a cell's note as a muted second line under the figure, and keeps it out of the CSV", async () => {
    renderTable({
      rows: [
        {
          key: 'n',
          kind: 'body',
          cells: [textValue('00010'), { ...pctValue(60), note: '51–55%: above' }, moneyValue(5)],
        },
      ],
    })
    const note = screen.getByText('51–55%: above')
    expect(note.className).toContain('text-xs')
    expect(note.className).toContain('text-muted-foreground')
    expect(note.parentElement).toHaveTextContent('60.0%')
    await userEvent.click(screen.getByRole('button', { name: /Download CSV/ }))
    expect(downloadCsv.mock.calls[0]?.[0]).not.toContain('51–55%')
  })

  it("draws a group's note mark on its group header, and its divider on the group's first column (Development's As reported⁶)", () => {
    renderTable({
      columns: [
        { key: 'm', header: 'Metric' },
        { key: 'a', header: '2025', group: 'As reported', groupNote: 6 },
        { key: 'b', header: '2026', group: 'As reported' },
        { key: 'c', header: '2027', group: 'The dashboard', divider: 'before' },
      ],
      rows: [
        {
          key: 'r',
          kind: 'body',
          cells: [textValue('x'), moneyValue(1), moneyValue(2), moneyValue(3)],
        },
      ],
    })
    const group = screen.getByRole('columnheader', { name: /As reported/ })
    expect(group.querySelector('sup')?.textContent).toBe('6')
    expect(screen.getAllByRole('columnheader', { name: /The dashboard/ })[0]?.className).toContain(
      CS_RULE_GROUP
    )
    expect(group.className).not.toContain(CS_RULE_GROUP)
    expect(screen.getByRole('columnheader', { name: '2026' }).querySelector('sup')).toBeNull()
  })

  it("draws a column's sub-line small and muted under its header, and Copy and the CSV read it after the header", async () => {
    renderTable({
      columns: [
        { key: 'm', header: 'Metric' },
        { key: 'a', header: '2026', sub: 'closed' },
      ],
      rows: [{ key: 'r', kind: 'body', cells: [textValue('x'), moneyValue(1)] }],
    })
    const sub = screen.getByText('closed')
    expect(sub.className).toContain('text-muted-foreground')
    expect(sub.closest('th')).toHaveTextContent('2026closed')
    await userEvent.click(screen.getByRole('button', { name: /Download CSV/ }))
    expect(downloadCsv.mock.calls[0]?.[0]).toContain('Metric,2026 closed')
  })

  it("keeps a fixed table's note mark on its label's line, after the cut words", () => {
    renderTable({
      fixed: true,
      columns: [
        { key: 'm', header: 'Metric' },
        { key: 'a', header: '2026' },
      ],
      rows: [{ key: 'r', kind: 'body', ref: 3, cells: [textValue('A long label'), moneyValue(1)] }],
    })
    const cell = screen.getByText('A long label').closest('td') as HTMLElement
    const sup = cell.querySelector('sup') as HTMLElement
    // inside the same flex line as the label, not a block after it
    expect(sup.parentElement?.parentElement).toBe(screen.getByText('A long label').parentElement)
  })

  it('sets its heading in the sans card heading, not the display serif', () => {
    renderTable()
    const h = screen.getByRole('heading', { name: 'Every camper' })
    expect(h.className).toContain(CS_CARD_HEADING)
    expect(h.className).not.toContain('font-display')
  })

  describe('the mock layout (description, one toolbar, default sort, mono)', () => {
    // Design language §5: a Reports table's heading row holds the title on the left and Find · Copy ·
    // Download CSV on the right, on that SAME row (it was a second row under the description).
    // Approved final mock reports-statistics.html (CF.thead): the muted description sits right after the
    // title on the SAME row, truncating with a title; it was a second line under the heading row.
    it('draws the description inline on the heading row after the title, truncated with a title', () => {
      renderTable({ find: true, description: 'Who it counts.' })
      const words = screen.getByText('Who it counts.')
      const title = screen.getByRole('heading', { name: 'Every camper' })
      const find = screen.getByRole('searchbox', { name: 'Find in Every camper' })
      const table = screen.getByRole('table', { name: 'Every camper' })
      expect(screen.getByTestId('report-heading-row').contains(words)).toBe(true)
      expect(title.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(words.compareDocumentPosition(find) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(words.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(words).toHaveClass('truncate')
      expect(words).toHaveAttribute('title', 'Who it counts.')
    })

    it('keeps the title, the find box, Copy and Download CSV on one row that never wraps, in that order', () => {
      renderTable({ find: true })
      const title = screen.getByRole('heading', { name: 'Every camper' })
      const find = screen.getByRole('searchbox', { name: 'Find in Every camper' })
      const copy = screen.getByRole('button', { name: /Copy/ })
      const csv = screen.getByRole('button', { name: /Download CSV/ })
      const row = screen.getByTestId('report-heading-row')
      for (const element of [title, find, copy, csv]) expect(row.contains(element)).toBe(true)
      expect(row).toHaveClass('flex-nowrap')
      expect(title.compareDocumentPosition(find) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(find.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(copy.compareDocumentPosition(csv) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    // §2, §4: Copy and Download CSV are the small 26px button; the find box is the 26px kit search,
    // not the audit pages' 38px muted field.
    it('draws Copy, Download CSV and the find box as 26px controls', () => {
      renderTable({ find: true })
      expect(screen.getByRole('button', { name: /Copy/ })).toHaveClass('h-[26px]')
      expect(screen.getByRole('button', { name: /Download CSV/ })).toHaveClass('h-[26px]')
      const find = screen.getByRole('searchbox', { name: 'Find in Every camper' })
      expect(find).toHaveClass('h-[26px]', 'bg-card')
      expect(find).not.toHaveClass('py-2')
    })

    it('opens sorted by defaultSort with the end row and totals last, and the arrow shows', () => {
      renderTable({ sortable: true, defaultSort: { key: 'campers', dir: 'desc' } })
      expect(bodyTexts()).toEqual(['00012', '00010', 'Outside the US', 'All · 2 ZIPs'])
      expect(screen.getByRole('columnheader', { name: /Campers/ })).toHaveTextContent('↓')
    })

    it('lets the URL sort win over defaultSort', () => {
      renderTable(
        { sortable: true, defaultSort: { key: 'campers', dir: 'desc' } },
        '/?sort=campers'
      )
      expect(bodyTexts()).toEqual(['00010', '00012', 'Outside the US', 'All · 2 ZIPs'])
    })

    it('draws a mono column in the monospace font, body cells only', () => {
      renderTable({
        columns: [{ key: 'zip', header: 'ZIP', mono: true }, COLUMNS[1]!, COLUMNS[2]!],
      })
      expect(screen.getByText('00010').closest('td')?.className).toContain('font-mono')
      expect(screen.getByText('9').closest('td')?.className).not.toContain('font-mono')
    })

    it('draws a table without the new props as before: no description, defaults unsorted', () => {
      renderTable({ sortable: true })
      expect(bodyTexts()).toEqual(['00010', '00012', 'Outside the US', 'All · 2 ZIPs'])
      expect(screen.getByText('00010').closest('td')?.className).not.toContain('font-mono')
    })

    it('draws the totals row first, under the header, sorted or not, and so copies it (ZIP codes)', async () => {
      renderTable({ sortable: true, totalsFirst: true })
      expect(bodyTexts()).toEqual(['All · 2 ZIPs', '00010', '00012', 'Outside the US'])
      await userEvent.click(screen.getByRole('button', { name: 'Campers' }))
      await userEvent.click(screen.getByRole('button', { name: 'Campers' }))
      expect(bodyTexts()).toEqual(['All · 2 ZIPs', '00012', '00010', 'Outside the US'])
      await userEvent.click(screen.getByRole('button', { name: /Copy/ }))
      expect((writeText.mock.calls[0]?.[0] ?? '').split('\n')[4]).toBe('All · 2 ZIPs\t31\t$1,500')
    })

    it("draws a row's note number as a superscript after its label, kept out of Copy", async () => {
      renderTable({
        rows: [{ ...ROWS[0]!, ref: 3 }, ...ROWS.slice(1)],
      })
      const label = screen.getByText('00010').closest('td') as HTMLElement
      expect(label.querySelector('sup')?.textContent).toBe('3')
      await userEvent.click(screen.getByRole('button', { name: /Copy/ }))
      expect((writeText.mock.calls[0]?.[0] ?? '').split('\n')[4]).toBe('00010\t4\t$1,200')
    })

    // reports-zip.html `.cf-sort`: the note mark sits on the label ("Campers¹↓"), the arrow primary and bold, 2px off.
    it("sets a sortable header's note mark against its label and its arrow in the primary tone", async () => {
      renderTable({ sortable: true })
      const button = screen.getByRole('button', { name: 'Campers' })
      expect(button.className).toContain('items-baseline')
      expect(button.className).not.toMatch(/\bgap-1\b/)
      await userEvent.click(button)
      expect(screen.getByText('↑')).toHaveClass('text-primary', 'ml-0.5', 'font-bold')
    })

    it('right-aligns a sortable number header over its numbers', () => {
      renderTable({ sortable: true })
      expect(screen.getByRole('button', { name: 'Campers' }).className).toContain('justify-end')
      expect(screen.getByRole('button', { name: 'ZIP' }).className).not.toContain('justify-end')
    })
  })

  describe('the final grid (design-language §6, §9, §10)', () => {
    it('puts the total row in the green band and the end rows in muted italic', () => {
      renderTable()
      const total = screen.getByText('All · 2 ZIPs').closest('tr') as HTMLElement
      expect(total.className).toContain(CS_BAND)
      expect(total.className).toContain('font-bold')
      const end = screen.getByText('Outside the US').closest('tr') as HTMLElement
      expect(end).toHaveClass('italic', 'text-muted-foreground')
    })

    // Scan #3109: a separated-borders table draws no border on a <tr>, so the band's edge rule sits
    // on the total row's cells.
    it("draws the total row's edge rule on its cells", () => {
      renderTable()
      const total = screen.getByText('All · 2 ZIPs').closest('tr') as HTMLElement
      expect(total.className).toContain('*:border-t')
    })

    // Scan #3109: in a grouped header the second row's first cell is not the table's first column,
    // so it keeps its column rule.
    it("keeps the rule on the first cell of a grouped header's second row", () => {
      renderTable({
        columns: [
          { key: 'zip', header: 'ZIP' },
          { key: 'campers', header: 'Campers', group: 'Round 1' },
          { key: 'dollars', header: 'Dollars', group: 'Round 1' },
        ],
      })
      const sub = screen.getByRole('columnheader', { name: 'Campers' })
      expect(sub.className).not.toContain('first:border-l-0')
      expect(screen.getByRole('columnheader', { name: 'ZIP' }).className).toContain(
        'first:border-l-0'
      )
    })

    it('puts a heading row in the green band', () => {
      renderTable({
        rows: [{ key: 'h', kind: 'heading', cells: [{ kind: 'text', value: 'Money' }] }, ...ROWS],
      })
      expect(screen.getByText('Money').closest('td')?.className).toContain(CS_BAND)
    })

    it('reports Copy in the heading row, truncated with a title, never as a line that pushes the table down', async () => {
      renderTable()
      await userEvent.click(screen.getByRole('button', { name: /Copy/ }))
      const status = screen.getByText(/Copied, with its as-of date and basis/)
      expect(screen.getByTestId('report-heading-row').contains(status)).toBe(true)
      expect(status).toHaveClass('truncate')
      expect(status).toHaveAttribute('title', status.textContent)
    })
  })

  describe('the Statistics screen extensions (approved final mock reports-statistics.html)', () => {
    it("titles a header with its column's full words, and keeps every header on one line unless it wraps", () => {
      renderTable({
        columns: [
          { key: 'zip', header: 'ZIP' },
          { key: 'campers', header: 'Campers', title: 'Every camper, counted once' },
          { key: 'dollars', header: 'Avg award', wrap: true },
        ],
      })
      const campers = screen.getByRole('columnheader', { name: 'Campers' })
      expect(campers).toHaveAttribute('title', 'Every camper, counted once')
      expect(campers).toHaveClass('whitespace-nowrap')
      expect(screen.getByRole('columnheader', { name: 'ZIP' })).toHaveClass('whitespace-nowrap')
      const wrapped = screen.getByRole('columnheader', { name: 'Avg award' })
      expect(wrapped).toHaveClass('whitespace-normal')
      expect(wrapped).not.toHaveClass('whitespace-nowrap')
    })

    it('titles a sortable header too', () => {
      renderTable({
        sortable: true,
        columns: [
          { key: 'zip', header: 'ZIP' },
          { key: 'campers', header: 'Campers', title: 'Every camper, counted once' },
          { key: 'dollars', header: 'Dollars' },
        ],
      })
      expect(screen.getByRole('columnheader', { name: 'Campers' })).toHaveAttribute(
        'title',
        'Every camper, counted once'
      )
    })

    it('gives a text cell a native title with its full words, and lets a cell carry its own', () => {
      renderTable({
        rows: [
          {
            key: 'a',
            kind: 'body',
            cells: [
              textValue('A long reason that may be cut'),
              countValue(4),
              { ...textValue('varies'), title: 'Each table sets its own', muted: true },
            ],
          },
        ],
      })
      expect(screen.getByText('A long reason that may be cut').closest('td')).toHaveAttribute(
        'title',
        'A long reason that may be cut'
      )
      const varies = screen.getByText('varies').closest('td') as HTMLElement
      expect(varies).toHaveAttribute('title', 'Each table sets its own')
      // whole class tokens: a muted cell keeps its own last class and gains the muted ink
      expect(varies).toHaveClass('text-muted-foreground', 'whitespace-nowrap')
      // a figure has no title of its own to add
      expect(screen.getByText('4').closest('td')).not.toHaveAttribute('title')
    })

    it("draws a decided-ink column in amber ink alone, header and cells, with no fill (the mock's .cf-dec)", () => {
      renderTable({
        columns: [
          ...COLUMNS.slice(0, 2),
          { key: 'dollars', header: 'Dollars', tone: 'decided-ink' },
        ],
      })
      const head = screen.getByRole('columnheader', { name: 'Dollars' })
      expect(head.className).toContain('text-amber-700')
      expect(head.className).not.toContain('bg-amber-50')
      expect(head.className).not.toContain('text-muted-foreground')
      const cell = screen.getByText('$1,200').closest('td') as HTMLElement
      expect(cell.className).toContain('text-amber-700')
      expect(cell.className).not.toContain('bg-amber-50')
    })

    it("draws a cell's own display in place of its words, and Copy and the CSV keep the words", async () => {
      renderTable({
        rows: [
          {
            key: 'a',
            kind: 'body',
            cells: [
              { ...textValue('00010'), display: <b data-testid="shown">ten</b> },
              countValue(4),
              moneyValue(1200),
            ],
          },
        ],
      })
      expect(screen.getByTestId('shown')).toBeInTheDocument()
      expect(screen.queryByText('00010')).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: /Copy/ }))
      expect(writeText.mock.calls[0]?.[0]).toContain('00010\t4\t$1,200')
    })

    it("draws a heading row's meta muted after its name, and keeps it out of Copy", async () => {
      renderTable({
        rows: [
          { key: 'h', kind: 'heading', meta: '3 sessions', cells: [textValue('Camp')] },
          ROWS[0]!,
        ],
      })
      const cell = screen.getByText('Camp').closest('td') as HTMLElement
      const meta = within(cell).getByText('3 sessions')
      expect(meta).toHaveClass('text-muted-foreground')
      await userEvent.click(screen.getByRole('button', { name: /Copy/ }))
      expect(writeText.mock.calls[0]?.[0]).not.toContain('3 sessions')
    })

    it('sizes every column of a fixed table through a colgroup, the unsized first taking the rest', () => {
      renderTable({
        fixed: true,
        columns: [
          { key: 'zip', header: 'ZIP' },
          { key: 'campers', header: 'Campers', group: 'Round 1', width: 84 },
          { key: 'dollars', header: 'Dollars', group: 'Round 1', width: 70 },
        ],
      })
      const cols = Array.from(screen.getByRole('table').querySelectorAll('col'))
      expect(cols.map((c) => c.style.width)).toEqual(['', '84px', '70px'])
    })

    it("cuts a fixed table's row label on one line, its title carrying the full words", () => {
      renderTable({ fixed: true })
      const label = screen.getByText('Outside the US')
      expect(label).toHaveClass('truncate')
      expect(label.closest('td')).toHaveAttribute('title', 'Outside the US')
    })

    it('hides the heading row for a headless table, which keeps its name and rows', () => {
      renderTable({ showHeading: false, description: 'Hidden with it.' })
      expect(screen.queryByTestId('report-heading-row')).toBeNull()
      expect(screen.queryByRole('button', { name: /Copy/ })).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Every camper' })).toBeNull()
      expect(screen.getByRole('table', { name: 'Every camper' })).toBeInTheDocument()
      expect(bodyTexts()).toEqual(['00010', '00012', 'Outside the US', 'All · 2 ZIPs'])
    })

    it('spans a total row’s label over its first columns, and ends it with the basis badge', () => {
      renderTable({
        showHeading: false,
        rows: [
          ...ROWS.slice(0, 2),
          {
            key: 'total',
            kind: 'total',
            span: 2,
            badge: 'P',
            cells: [
              { ...textValue('All pools · Round 1'), title: 'All pools · Round 1 · pooled ratios' },
              textValue(''),
              moneyValue(1500),
            ],
          },
        ],
      })
      const total = screen.getByText('All pools · Round 1').closest('tr') as HTMLElement
      const cells = within(total).getAllByRole('cell')
      expect(cells).toHaveLength(2)
      expect(cells[0]).toHaveAttribute('colspan', '2')
      expect(cells[0]).toHaveAttribute('title', 'All pools · Round 1 · pooled ratios')
      const label = within(cells[0]!).getByText('All pools · Round 1')
      expect(label).toHaveClass('truncate')
      const badge = within(cells[0]!).getByText('P')
      expect(label.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('copies and downloads a spanned total as full-width rows, like any other', async () => {
      const rows: ReportRow[] = [
        ROWS[0]!,
        {
          key: 'total',
          kind: 'total',
          span: 2,
          cells: [textValue('Everything'), textValue(''), moneyValue(1500)],
        },
      ]
      const { result } = renderHook(() =>
        useReportExport({
          heading: HEADING,
          columns: COLUMNS,
          rows,
          csvFilename: 'x.csv',
          link: '/l',
        })
      )
      await act(async () => {
        await result.current.copy()
      })
      expect((writeText.mock.calls[0]?.[0] ?? '').split('\n').slice(4)).toEqual([
        '00010\t4\t$1,200',
        'Everything\t\t$1,500',
      ])
      expect(result.current.copied).toMatch(/^Copied/)
      act(() => result.current.download())
      expect(downloadCsv.mock.calls[0]?.[1]).toBe('x.csv')
      expect(downloadCsv.mock.calls[0]?.[0]).toContain('Everything,,1500')
    })

    it('says why a copy failed, in words that point at Download CSV', async () => {
      writeText.mockRejectedValueOnce(new Error('no clipboard'))
      const { result } = renderHook(() =>
        useReportExport({
          heading: HEADING,
          columns: COLUMNS,
          rows: ROWS,
          csvFilename: 'x.csv',
          link: '/l',
          copiedWords: '✓ Copied',
        })
      )
      await act(async () => {
        await result.current.copy()
      })
      expect(result.current.copied).toBe("Couldn't copy here: use Download CSV.")
      await act(async () => {
        await result.current.copy()
      })
      expect(result.current.copied).toBe('✓ Copied')
    })

    it('clears its status once the table it copied changes (a new choice is a new table)', async () => {
      const { result, rerender } = renderHook(
        ({ rows }: { rows: typeof ROWS }) =>
          useReportExport({
            heading: HEADING,
            columns: COLUMNS,
            rows,
            csvFilename: 'x.csv',
            link: '/l',
            copiedWords: '✓ Copied',
          }),
        { initialProps: { rows: ROWS } }
      )
      await act(async () => {
        await result.current.copy()
      })
      expect(result.current.copied).toBe('✓ Copied')
      rerender({ rows: [...ROWS] })
      expect(result.current.copied).toBe('✓ Copied')
      rerender({ rows: ROWS.slice(1) })
      expect(result.current.copied).toBeNull()
    })
  })

  describe('the ZIP codes screen extensions (approved final mock reports-zip.html)', () => {
    it("puts the table's description in the title's hover, not in a line under it", () => {
      renderTable({ hint: 'Who this table counts.' })
      expect(screen.getByRole('heading', { name: 'Every camper' })).toHaveAttribute(
        'title',
        'Who this table counts.'
      )
      expect(screen.queryByText('Who this table counts.')).toBeNull()
    })

    it("keeps the heading's own words as its title without a hint", () => {
      renderTable()
      expect(screen.getByRole('heading', { name: 'Every camper' })).toHaveAttribute(
        'title',
        'Every camper'
      )
    })

    it('names its find box and sizes it as asked: "Find a ZIP", 104px', () => {
      renderTable({ find: true, findPlaceholder: 'Find a ZIP', findWidth: 104 })
      const find = screen.getByRole('searchbox', { name: 'Find in Every camper' })
      expect(find).toHaveAttribute('placeholder', 'Find a ZIP')
      expect((find.closest('label') as HTMLElement).style.width).toBe('104px')
    })

    it('keeps the 140px "Find" box when asked for nothing else', () => {
      renderTable({ find: true })
      const find = screen.getByRole('searchbox', { name: 'Find in Every camper' })
      expect(find).toHaveAttribute('placeholder', 'Find')
      expect(find.closest('label')).toHaveClass('w-[140px]')
    })

    it('names the counted rows "rows" in the find title unless told what they are', async () => {
      renderTable({ find: true })
      await userEvent.type(screen.getByRole('searchbox', { name: 'Find in Every camper' }), '00012')
      expect(screen.getByTestId('find-status')).toHaveAttribute(
        'title',
        "1 of 2 rows match “00012”; the totals row stays the whole table's"
      )
    })

    it('says "N of M" in the toolbar while finding, with the whole-table words in its title, and no sentence row', async () => {
      renderTable({ find: true, findNoun: 'ZIPs' })
      expect(screen.queryByTestId('find-status')).toBeNull()
      await userEvent.type(screen.getByRole('searchbox', { name: 'Find in Every camper' }), '00012')
      const status = screen.getByTestId('find-status')
      expect(status).toHaveTextContent('1 of 2')
      expect(status).toHaveAttribute(
        'title',
        "1 of 2 ZIPs match “00012”; the totals row stays the whole table's"
      )
      expect(screen.getByTestId('report-heading-row').contains(status)).toBe(true)
      expect(screen.queryByText(/rows match\./)).toBeNull()
    })

    it('titles Copy with what it copies', () => {
      renderTable()
      expect(screen.getByRole('button', { name: /Copy/ })).toHaveAttribute(
        'title',
        'Copy the whole table, with its season, as-of date and basis, for a spreadsheet'
      )
    })

    it('draws no find, Copy or CSV when it has no tools (a table with nothing to find)', () => {
      renderTable({ find: true, tools: false })
      expect(screen.queryByRole('searchbox')).toBeNull()
      expect(screen.queryByRole('button', { name: /Copy/ })).toBeNull()
      expect(screen.queryByRole('button', { name: /Download CSV/ })).toBeNull()
      expect(screen.getByRole('heading', { name: 'Every camper' })).toBeInTheDocument()
    })

    it('says its own words in an empty row when it has no rows', () => {
      renderTable({ rows: [], emptyText: 'No aid table for 2027: it starts with 2027.' })
      expect(
        screen.getByText('No aid table for 2027: it starts with 2027.').closest('td')
      ).toHaveAttribute('colspan', '3')
    })

    it('bounds the card (it scrolls inside, in the page flow) and pins the header and the totals row under it', () => {
      renderTable({ bounded: true, totalsFirst: true })
      const card = screen.getByRole('table', { name: 'Every camper' }).parentElement as HTMLElement
      expect(card).toHaveClass('max-h-[420px]', 'overflow-auto')
      expect(card.className).not.toContain('overflow-x-auto')
      for (const th of within(screen.getByRole('table')).getAllByRole('columnheader')) {
        expect(th).toHaveClass('sticky', 'top-0')
      }
      const totals = within(screen.getAllByRole('row')[1]!).getAllByRole('cell')
      expect(totals[0]!.textContent).toBe('All · 2 ZIPs')
      // The totals pin at the app's header height, 27px (5 + 16 + 5 + 1: text-xs is 16px tall here, measured on
      // the branch's own CSS), so its top rule stays in view; the mock's 26px is its own 15px-line header.
      for (const td of totals) expect(td).toHaveClass('sticky', 'top-[27px]')
      // a body row pins nothing
      expect(within(screen.getAllByRole('row')[2]!).getAllByRole('cell')[0]).not.toHaveClass(
        'sticky'
      )
    })

    it('pins a sortable table’s headers too, and draws an unbounded table as before', () => {
      renderTable({ bounded: true, sortable: true })
      expect(screen.getByRole('columnheader', { name: 'Campers' })).toHaveClass('sticky', 'top-0')
      document.body.innerHTML = ''
      renderTable({ sortable: true })
      expect(screen.getByRole('columnheader', { name: 'Campers' })).not.toHaveClass('sticky')
      expect(screen.getByRole('table', { name: 'Every camper' }).parentElement).not.toHaveClass(
        'max-h-[420px]'
      )
    })
  })
})

describe('columns kept in the CSV only, and a note on a group (approved final mock reports-yoy.html)', () => {
  const COLS: ReportColumn[] = [
    { key: 'season', header: 'Season' },
    { key: 'apps', header: 'Apps', group: 'At the cutoff', groupNote: 3 },
    { key: 'avg', header: 'Avg ask', group: 'At the cutoff', csvOnly: true },
    { key: 'asked', header: 'Asked', group: 'At the cutoff' },
  ]
  const ROWS2: ReportRow[] = [
    {
      key: 'a',
      kind: 'body',
      cells: [textValue('2027'), countValue(4), moneyValue(250), moneyValue(1000)],
    },
  ]
  const table = () =>
    render(
      <MemoryRouter>
        <ReportTable heading={HEADING} columns={COLS} rows={ROWS2} csvFilename="x.csv" link="/l" />
      </MemoryRouter>
    )

  it('does not draw a csvOnly column, header or cell, and the group spans only what is drawn', () => {
    table()
    const grid = screen.getByRole('table', { name: 'Every camper' })
    expect(within(grid).queryByText('Avg ask')).toBeNull()
    expect(within(grid).queryByText('$250')).toBeNull()
    expect(within(grid).getByText('$1,000')).toBeInTheDocument()
    const group = within(grid).getByText('At the cutoff').closest('th')
    expect(group).toHaveAttribute('colspan', '2')
    expect(group?.querySelector('sup')?.textContent).toBe('3')
  })

  it('leaves a csvOnly column out of Copy and keeps it in the CSV', async () => {
    table()
    await userEvent.click(screen.getByRole('button', { name: /copy/i }))
    expect(writeText.mock.calls[0]?.[0]).not.toContain('Avg ask')
    expect(writeText.mock.calls[0]?.[0]).not.toContain('250')
    await userEvent.click(screen.getByRole('button', { name: /download csv/i }))
    const csv = downloadCsv.mock.calls[0]?.[0] ?? ''
    expect(csv).toContain('At the cutoff · Avg ask')
    expect(csv).toContain('2027,4,250,1000')
  })
})

describe('an empty body in place of the grid (approved final mock reports-yoy.html, the refused cutoff table)', () => {
  const table = () =>
    render(
      <MemoryRouter>
        <ReportTable
          heading={HEADING}
          description="Received through Dec 1, 2026"
          columns={[{ key: 'season', header: 'Season' }]}
          rows={[]}
          csvFilename="x.csv"
          link="/l"
          emptyBody="Nothing to count at Dec 1, 2026."
        />
      </MemoryRouter>
    )

  it('keeps the heading and description but draws no Copy or Download CSV: nothing to export (the mock is bare)', () => {
    table()
    const row = screen.getByTestId('report-heading-row')
    expect(within(row).getByText('Received through Dec 1, 2026')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /copy/i })).toBeNull()
    expect(within(row).queryByRole('button', { name: /download csv/i })).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it("draws the body as the mock's dashed empty box", () => {
    table()
    const body = screen.getByText('Nothing to count at Dec 1, 2026.')
    expect(body.className).toContain('border-dashed')
    expect(body.className).toContain('text-muted-foreground')
  })
})
