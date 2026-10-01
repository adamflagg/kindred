import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMemo, useState } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const downloadSpy = vi.fn()
vi.mock('../../../utils/csvExport', async (importActual) => ({
  ...(await importActual<typeof import('../../../utils/csvExport')>()),
  downloadCsv: (...args: unknown[]) => downloadSpy(...args),
}))

import type { ApiAidGridRow } from '../../../types/api-types'
import { GRID_ROWS, gridRow, roundOut, ROW_LIAM } from './gridFixtures'
import { RequestsGrid } from './RequestsGrid'
import { filterRows, NO_FILTERS, requestView } from './views'

let highlights: Array<string | null> = []
const open = vi.fn()

function Grid({
  slug = 'all',
  showIds = false,
  rows = GRID_ROWS,
}: {
  slug?: string
  showIds?: boolean
  rows?: readonly ApiAidGridRow[]
}) {
  const view = requestView(slug)
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const links = useMemo(
    () => ({
      href: (row: ApiAidGridRow) =>
        `/aid/households/${String(row.household_cm_id)}?from=${view.slug}&year=2027`,
      open,
    }),
    [view.slug]
  )
  return (
    <MemoryRouter>
      <RequestsGrid
        rows={filterRows(rows, view.key, NO_FILTERS)}
        view={view}
        showIds={showIds}
        today="2027-04-01"
        csvFilename="camperships-requests-all-2027.csv"
        highlighted={highlighted}
        onHighlight={(key) => {
          highlights.push(key)
          setHighlighted(key)
        }}
        links={links}
      />
    </MemoryRouter>
  )
}

/** One CSV line into its cells, honouring quoted cells that hold commas or doubled quotes. */
function csvCells(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i)
    if (quoted) {
      if (ch === '"' && line.charAt(i + 1) === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      cells.push(cell)
      cell = ''
    } else cell += ch
  }
  cells.push(cell)
  return cells
}

const rowOf = (camper: string) => {
  const row = screen.getByText(camper).closest('tr')
  if (row === null) throw new Error(`no row for ${camper}`)
  return row
}

beforeEach(() => {
  highlights = []
  open.mockClear()
  downloadSpy.mockClear()
})

describe('RequestsGrid', () => {
  it("shows All's columns in D27's order", () => {
    render(<Grid />)
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Family',
      'Camper',
      'Session',
      'Stage',
      'Tier',
      'Ask',
      'Cost',
      'R1',
      'Appeal ask',
      'R2',
      'R3',
      'Total',
      'Posted',
      'Confirmed by the ledger',
      'Needs attention',
    ])
  })

  it('opens the household from a family name, without highlighting the row (Decision 1)', async () => {
    render(<Grid />)
    const link = screen.getByRole('link', { name: 'The Garcia Family' })
    expect(link).toHaveAttribute('href', '/aid/households/1000003?from=all&year=2027')
    await userEvent.click(link)
    expect(open).toHaveBeenCalledWith(ROW_LIAM, '/aid/households/1000003?from=all&year=2027')
    expect(highlights).toEqual([])
  })

  it('does not highlight the row on a modified click on a name; the new tab opens alone', async () => {
    render(<Grid />)
    const link = screen.getByRole('link', { name: 'The Garcia Family' })
    fireEvent.click(link, { ctrlKey: true })
    fireEvent.click(link, { metaKey: true })
    expect(highlights).toEqual([])
    expect(open).not.toHaveBeenCalled()
  })

  it('gives the camper name the same href shape as the family name', () => {
    render(<Grid />)
    expect(screen.getByRole('link', { name: 'Liam Garcia' })).toHaveAttribute(
      'href',
      '/aid/households/1000003?from=all&year=2027'
    )
  })

  it('highlights a row on a click anywhere else', async () => {
    render(<Grid />)
    await userEvent.click(within(rowOf('Liam Garcia')).getAllByRole('cell')[2] as HTMLElement)
    expect(highlights).toEqual(['reqliam00000002'])
    expect(rowOf('Liam Garcia')).toHaveAttribute('data-highlighted', 'true')
  })

  it('brings the household and person ids back as columns with Show IDs (D27)', () => {
    render(<Grid showIds />)
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent)
    expect(headers.slice(0, 4)).toEqual(['Family', 'Camper', 'Household', 'Person'])
    expect(within(rowOf('Liam Garcia')).getByText('1000004')).toBeInTheDocument()
  })

  it('shows a matched id as a chip under the family name (D27)', async () => {
    render(<Grid />)
    await userEvent.type(screen.getByLabelText('Search'), '1000004')
    expect(screen.getAllByRole('row').filter((r) => r.hasAttribute('data-row-key'))).toHaveLength(1)
    expect(within(rowOf('Liam Garcia')).getByText('1000004')).toBeInTheDocument()
  })

  it("names the stage in the server's words", () => {
    render(<Grid />)
    expect(within(rowOf('Olivia Chen')).getByText('R2 · Needs an offer')).toBeInTheDocument()
    expect(within(rowOf('Riley Sam')).getByText('Cancelled')).toBeInTheDocument()
  })

  it("gives All's needs-attention cell its next step, and a queue view none (§4.4)", () => {
    const { unmount } = render(<Grid />)
    expect(
      within(rowOf('Liam Garcia')).getByRole('link', { name: 'Enter income' })
    ).toBeInTheDocument()
    unmount()
    render(<Grid slug="holds" />)
    expect(screen.queryByRole('link', { name: 'Enter income' })).toBeNull()
    expect(
      screen.getByText('Placeholder income', { selector: '[data-group-heading] span' })
    ).toBeInTheDocument()
  })

  it('shows a Round 3 waiting on finance in amber, outside the total', () => {
    const pending = gridRow({
      request_id: 'reqpending00006',
      camper_name: 'Samuel Johnson',
      person_cm_id: 1000010,
      rounds: [
        roundOut(1, 'posted', { decided: 1420, posted: 1420, accepted: true }),
        roundOut(3, 'pending_approval', { pending_approval: 450 }),
      ],
      total_decided: 1420,
      queues: ['pending_approval'],
    })
    render(<Grid rows={[pending]} />)
    expect(within(rowOf('Samuel Johnson')).getByText('pending $450')).toBeInTheDocument()
    const footer = screen.getAllByRole('row').at(-1) as HTMLElement
    expect(within(footer).getAllByText('$1,420').length).toBeGreaterThan(0)
    expect(within(footer).queryByText('$450')).toBeNull()
  })

  it('writes a pending Round 3 amount to the CSV as its own column (M16)', async () => {
    const pending = gridRow({
      request_id: 'reqpending00006',
      camper_name: 'Samuel Johnson',
      rounds: [roundOut(3, 'pending_approval', { pending_approval: 450 })],
      total_decided: null,
      queues: ['pending_approval'],
    })
    render(<Grid rows={[pending]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    const [content] = downloadSpy.mock.calls.at(-1) as [string, string]
    const [header, row] = content.split('\n')
    expect(csvCells(header ?? '').at(-1)).toBe('R3 pending approval')
    expect(csvCells(row ?? '').at(-1)).toBe('450')
  })

  it('counts requests and families in the footer, and totals Posted', () => {
    render(<Grid />)
    const footer = screen.getAllByRole('row').at(-1) as HTMLElement
    expect(within(footer).getByText('5 requests · 4 families')).toBeInTheDocument()
    expect(within(footer).getByText('$4,720')).toBeInTheDocument()
  })
})
