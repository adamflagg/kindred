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
  onTick,
}: {
  slug?: string
  showIds?: boolean
  rows?: readonly ApiAidGridRow[]
  onTick?: (row: ApiAidGridRow, action: 'posted' | 'accepted') => void
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
        onTick={onTick}
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

  describe("Waiting on the family: Posted is the waiting round's own (owner ruling I2)", () => {
    // Round 1 posted and accepted ($1,000); Round 2 posted, not accepted ($500).
    const split = gridRow({
      request_id: 'reqwaiting00007',
      camper_name: 'Samuel Johnson',
      rounds: [
        roundOut(1, 'posted', {
          decided: 1000,
          posted: 1000,
          posted_on: '2027-03-01',
          accepted: true,
        }),
        roundOut(2, 'posted', { decided: 500, posted: 500, posted_on: '2027-03-20' }),
      ],
      total_decided: 1500,
      total_posted: 1500,
      queues: ['waiting_on_family'],
    })

    it("shows the round's $500 and a $500 footer, not the $1,500 across rounds", () => {
      render(<Grid slug="waiting" rows={[split]} />)
      const footer = screen.getAllByRole('row').at(-1) as HTMLElement
      expect(within(footer).getByText('$500')).toBeInTheDocument()
      expect(within(rowOf('Samuel Johnson')).getByText('$500')).toBeInTheDocument()
      expect(screen.queryByText('$1,500')).toBeNull()
    })

    it("writes the round's $500 to the CSV", async () => {
      render(<Grid slug="waiting" rows={[split]} />)
      await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
      const [content] = downloadSpy.mock.calls.at(-1) as [string, string]
      const [header, row] = content.split('\n')
      const at = csvCells(header ?? '').indexOf('Posted')
      expect(csvCells(row ?? '')[at]).toBe('500')
    })

    it('leaves All showing the all-rounds Posted', () => {
      render(<Grid slug="all" rows={[split]} />)
      expect(within(rowOf('Samuel Johnson')).getAllByText('$1,500').length).toBeGreaterThan(0)
    })
  })
})

// Posted and waiting, nothing else wrong: its one attention note is the waiting one.
const WAITING = gridRow({
  request_id: 'reqwaiting00001',
  rounds: [roundOut(1, 'posted', { decided: 900, posted: 900, posted_on: '2027-03-09' })],
  total_decided: 900,
  total_posted: 900,
  queues: ['waiting_on_family'],
})

describe('ticks in the grid (§4.10; Decision 15)', () => {
  beforeEach(() => {
    highlights = []
  })

  it('draws no Tick column without a tick handler', () => {
    render(<Grid slug="needs-offer" />)
    expect(screen.queryByRole('button', { name: /^Posted · locks/ })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Tick' })).toBeNull()
  })

  it('ticks Posted at the decided amount on Needs an offer, without highlighting the row', async () => {
    const onTick = vi.fn()
    render(<Grid slug="needs-offer" onTick={onTick} />)
    await userEvent.click(screen.getByRole('button', { name: 'Posted · locks $780' }))
    expect(onTick).toHaveBeenCalledWith(
      expect.objectContaining({ request_id: 'reqolivia000003' }),
      'posted'
    )
    expect(highlights).toEqual([])
  })

  it('ticks Accepted from Waiting on the family, and from Mark accepted on All', async () => {
    const onTick = vi.fn()
    const { unmount } = render(<Grid slug="waiting" onTick={onTick} />)
    await userEvent.click(screen.getByRole('button', { name: 'Accepted' }))
    expect(onTick).toHaveBeenCalledWith(
      expect.objectContaining({ request_id: 'reqsamuel000005' }),
      'accepted'
    )
    unmount()
    onTick.mockClear()
    render(<Grid slug="all" rows={[WAITING]} onTick={onTick} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mark accepted' }))
    expect(onTick).toHaveBeenCalledWith(
      expect.objectContaining({ request_id: 'reqwaiting00001' }),
      'accepted'
    )
    expect(highlights).toEqual([])
  })

  it('offers no Mark accepted tick on a waiting row cancelled in Kindred: the server refuses it (review M3)', () => {
    const cancelled = gridRow({
      ...WAITING,
      request_id: 'reqcancelled0001',
      cancellation: { by: 'kindred', on: null, reason: 'medical', note: '' },
    })
    render(<Grid slug="all" rows={[cancelled]} onTick={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Mark accepted' })).toBeNull()
  })

  it('leaves Mark accepted a household link when the viewer cannot tick', () => {
    render(<Grid slug="all" rows={[WAITING]} />)
    expect(screen.getByRole('link', { name: 'Mark accepted' })).toBeInTheDocument()
  })
})

describe("Needs an offer's new total column (⚠ Decision 40, ruled)", () => {
  it("shows a Round 2 row's total beside its own amount, and a dash on a Round 1 row", () => {
    render(<Grid slug="needs-offer" />)
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    const at = (name: string) => headers.findIndex((h) => h.startsWith(name))
    const cells = (camper: string) =>
      Array.from((screen.getByText(camper).closest('tr') as HTMLElement).querySelectorAll('td'))
    const olivia = cells('Olivia Chen')
    expect(olivia[at('Decided')]).toHaveTextContent('$780')
    expect(olivia[at('New total')]).toHaveTextContent('$2,200')
    expect(cells('Emma Johnson')[at('New total')]).toHaveTextContent('—')
  })

  // Review I1 (owner call): the ruling covered the per-row cell only, and a sum of whole-season
  // totals over just the appeal rows is a new figure nobody ruled. Decided's total is unchanged.
  it('totals Decided in the footer but shows no total under New total', () => {
    const { container } = render(<Grid slug="needs-offer" />)
    const footer = Array.from(container.querySelectorAll('tfoot td'))
    // The footer ends ... Decided, New total, Needs attention.
    expect(footer.at(-3)).toHaveTextContent('$2,200')
    expect(footer.at(-2)?.textContent).toBe('')
  })
})

describe("Needs an offer's split marker (⚠ Decision 39; #2941's payer_count)", () => {
  it('marks a family cell "split · 2 households" when the request has two payers', () => {
    render(<Grid slug="needs-offer" rows={[gridRow({ payer_count: 2 })]} />)
    const cell = screen.getByText('The Johnson Family').closest('td') as HTMLElement
    // The kit's stone StatusPill, not bare text.
    expect(within(cell).getByText('split · 2 households')).toHaveClass('bg-stone-200')
  })

  it('counts the payers it is given', () => {
    render(<Grid slug="needs-offer" rows={[gridRow({ payer_count: 3 })]} />)
    expect(screen.getByText('split · 3 households')).toBeInTheDocument()
  })

  it('draws no marker for one payer or an unreplayed past read (null)', () => {
    const { rerender } = render(<Grid slug="needs-offer" rows={[gridRow({ payer_count: 1 })]} />)
    expect(screen.queryByText(/^split ·/)).toBeNull()
    rerender(<Grid slug="needs-offer" rows={[gridRow({ payer_count: null })]} />)
    expect(screen.queryByText(/^split ·/)).toBeNull()
    rerender(<Grid slug="needs-offer" rows={[gridRow()]} />)
    expect(screen.queryByText(/^split ·/)).toBeNull()
  })

  it('draws the marker in Needs an offer only', () => {
    render(<Grid slug="all" rows={[gridRow({ payer_count: 2 })]} />)
    expect(screen.queryByText(/^split ·/)).toBeNull()
  })
})
