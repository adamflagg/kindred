/**
 * The Reports table (spec §9; RPT-33; §11): the server's rows and totals as sent, Copy as displayed,
 * the CSV, the find box and the sort.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { countValue, moneyValue, textValue, type ReportColumn, type ReportRow } from './report'
import { ReportTable } from './ReportTable'

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

  it('finds body rows only: the totals row stays, and says it is the whole table', async () => {
    renderTable({ find: true })
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find in Every camper' }), '00012')
    expect(bodyTexts()).toEqual(['00012', 'All · 2 ZIPs'])
    expect(
      screen.getByText(/1 of 3 rows match\. The totals row is the whole table's/)
    ).toBeInTheDocument()
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
    expect(screen.getByRole('columnheader', { name: 'Campers' }).className).toContain('border-l')
    expect(screen.getByText('9').closest('td')?.className).toContain('border-l')
    expect(screen.getByRole('columnheader', { name: /Dollars/ }).className).not.toContain(
      'border-l'
    )
    expect(screen.getByText('$1,200').closest('td')?.className).not.toContain('border-l')
  })

  describe('the mock layout (description, one toolbar, default sort, mono)', () => {
    it('draws the description right under the title, above the toolbar and the table', () => {
      renderTable({ find: true, description: 'Who it counts.' })
      const words = screen.getByText('Who it counts.')
      const title = screen.getByRole('heading', { name: 'Every camper' })
      const find = screen.getByRole('searchbox', { name: 'Find in Every camper' })
      const table = screen.getByRole('table', { name: 'Every camper' })
      expect(title.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(words.compareDocumentPosition(find) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(words.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('keeps the find box, Copy and Download CSV in one toolbar row, in that order, apart from the title', () => {
      renderTable({ find: true })
      const find = screen.getByRole('searchbox', { name: 'Find in Every camper' })
      const copy = screen.getByRole('button', { name: /Copy/ })
      const csv = screen.getByRole('button', { name: /Download CSV/ })
      const bar = find.closest('div')
      expect(bar).not.toBeNull()
      expect(bar?.contains(copy)).toBe(true)
      expect(bar?.contains(csv)).toBe(true)
      expect(bar?.contains(screen.getByRole('heading', { name: 'Every camper' }))).toBe(false)
      expect(find.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(copy.compareDocumentPosition(csv) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

    it('right-aligns a sortable number header over its numbers', () => {
      renderTable({ sortable: true })
      expect(screen.getByRole('button', { name: 'Campers' }).className).toContain('justify-end')
      expect(screen.getByRole('button', { name: 'ZIP' }).className).not.toContain('justify-end')
    })
  })
})
