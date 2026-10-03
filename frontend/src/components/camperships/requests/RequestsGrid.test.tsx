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
import { confirmationOut, GRID_ROWS, gridRow, roundOut, ROW_LIAM } from './gridFixtures'
import { RequestsGrid } from './RequestsGrid'
import { CM_PENDING_WORD, filterRows, GRID_COLUMNS, NO_FILTERS, requestView } from './views'

let highlights: Array<string | null> = []
const open = vi.fn()

function Grid({
  slug = 'all',
  showIds = false,
  rows = GRID_ROWS,
  tickedSeason = true,
}: {
  slug?: string
  showIds?: boolean
  rows?: readonly ApiAidGridRow[]
  tickedSeason?: boolean
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
        tickedSeason={tickedSeason}
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
      'CM ✓',
      'Requested by',
      'Needs attention',
    ])
  })

  it('pins the Camper and lets Requested by scroll (grid layout T2, L3 d; T3)', () => {
    render(<Grid />)
    // Every header cell is held at the top in the screen box; only a pinned one is also held at the left.
    const pinnedLeft = (name: string) =>
      screen.getByRole('columnheader', { name }).style.left !== ''
    expect(pinnedLeft('Camper')).toBe(true)
    expect(pinnedLeft('Requested by')).toBe(false)
    expect(pinnedLeft('Session')).toBe(false)
  })

  it('opens the household from a camper name too, without highlighting the row, and not on a modified click', async () => {
    render(<Grid />)
    const link = screen.getByRole('link', { name: 'Liam Garcia' })
    fireEvent.click(link, { ctrlKey: true })
    expect(highlights).toEqual([])
    expect(open).not.toHaveBeenCalled()
    await userEvent.click(link)
    expect(open).toHaveBeenCalledWith(ROW_LIAM, '/aid/households/1000003?from=all&year=2027')
    expect(highlights).toEqual([])
  })

  // T3 + Q-L3: the CSV is the screen, so Requested by (the name) and no Family column.
  it('writes the CSV in the on-screen order: Camper first, Requested by before Needs attention (Q-L3, T3)', async () => {
    render(<Grid />)
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    const [content] = downloadSpy.mock.calls.at(-1) as [string, string]
    const lines = content.split('\n')
    const header = csvCells(lines[0] ?? '')
    expect(header[0]).toBe('Camper')
    const at = header.indexOf('Requested by')
    expect(at).toBe(header.indexOf('Needs attention') - 1)
    expect(header).not.toContain('Family')
    expect(header).not.toContain('Household')
    expect(lines.slice(1, 6).map((l) => csvCells(l)[at])).toEqual([
      'Sarah Johnson',
      'Sarah Johnson',
      'Ana Garcia',
      'David Chen',
      '',
    ])
  })

  // Owner ruling G1 (10-03): "By family" stays gone, but the Flat / By reason switch comes back,
  // so All can be grouped by reason and a queue view can go flat. Replaces "has no grouping
  // control, and finds a row by the family name" (its find-a-row half is the next test).
  it('offers Flat and By reason, never By family, and switches both ways on All and on a queue view', async () => {
    const headings = () => document.querySelectorAll('[data-group-heading]').length
    const { unmount } = render(<Grid slug="all" />)
    expect(screen.queryByRole('button', { name: 'By family' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Flat' })).toBeInTheDocument()
    expect(headings()).toBe(0)
    await userEvent.click(screen.getByRole('button', { name: 'By reason' }))
    expect(headings()).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: 'Flat' }))
    expect(headings()).toBe(0)
    unmount()
    render(<Grid slug="holds" />)
    expect(screen.queryByRole('button', { name: 'By family' })).not.toBeInTheDocument()
    expect(headings()).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: 'Flat' }))
    expect(headings()).toBe(0)
    await userEvent.click(screen.getByRole('button', { name: 'By reason' }))
    expect(headings()).toBeGreaterThan(0)
  })

  it('finds a row by the requester’s name or the family name (T3, Q-L2)', async () => {
    render(<Grid />)
    const shown = () =>
      screen.getAllByRole('row').filter((r) => r.hasAttribute('data-row-key')).length
    await userEvent.type(screen.getByLabelText('Search'), 'ana garcia')
    expect(shown()).toBe(1)
    await userEvent.clear(screen.getByLabelText('Search'))
    await userEvent.type(screen.getByLabelText('Search'), 'garcia family')
    expect(shown()).toBe(1)
  })

  // Q-L2: typing the requester's name finds their rows, though no other column says it.
  it('finds rows by the requester’s name (Q-L2, T3)', async () => {
    render(<Grid />)
    await userEvent.type(screen.getByLabelText('Search'), 'sarah')
    const found = screen.getAllByRole('row').filter((r) => r.hasAttribute('data-row-key'))
    expect(found.map((r) => r.getAttribute('data-row-key'))).toEqual([
      'reqemma00000001',
      'reqsamuel000005',
    ])
  })

  it('sorts Requested by on the last name, with no requester last (T3)', async () => {
    render(<Grid />)
    await userEvent.click(screen.getByRole('button', { name: 'Requested by' }))
    const keys = () =>
      screen
        .getAllByRole('row')
        .filter((r) => r.hasAttribute('data-row-key'))
        .map((r) => r.getAttribute('data-row-key'))
    // Chen, Garcia, Johnson ×2, then the row the server could not name; by first name it would be
    // Ana, David, Sarah.
    expect(keys()).toEqual([
      'reqolivia000003',
      'reqliam00000002',
      'reqemma00000001',
      'reqsamuel000005',
      'reqriley0000004',
    ])
  })

  it('draws "—" with no link when the server could not name a requester (T3)', () => {
    render(<Grid />)
    const row = rowOf('Riley Sam')
    const cells = within(row).getAllByRole('cell')
    const requester = cells.at(-2) as HTMLElement
    expect(requester).toHaveTextContent(/^—$/)
    expect(within(requester).queryByRole('link')).toBeNull()
  })

  it("keeps each view's default grouping: All is flat, a queue view is grouped by reason", () => {
    const { unmount } = render(<Grid slug="all" />)
    expect(document.querySelectorAll('[data-group-heading]')).toHaveLength(0)
    unmount()
    render(<Grid slug="holds" />)
    expect(document.querySelectorAll('[data-group-heading]').length).toBeGreaterThan(0)
  })

  it('opens the household from the requester’s name, without highlighting the row (Decision 1, T3)', async () => {
    render(<Grid />)
    const link = screen.getByRole('link', { name: 'Ana Garcia' })
    expect(link).toHaveAttribute('href', '/aid/households/1000003?from=all&year=2027')
    await userEvent.click(link)
    expect(open).toHaveBeenCalledWith(ROW_LIAM, '/aid/households/1000003?from=all&year=2027')
    expect(highlights).toEqual([])
  })

  it('does not highlight the row on a modified click on a name; the new tab opens alone', async () => {
    render(<Grid />)
    const link = screen.getByRole('link', { name: 'Ana Garcia' })
    fireEvent.click(link, { ctrlKey: true })
    fireEvent.click(link, { metaKey: true })
    expect(highlights).toEqual([])
    expect(open).not.toHaveBeenCalled()
  })

  it('gives the camper name the same href shape as the requester’s name', () => {
    render(<Grid />)
    expect(screen.getByRole('link', { name: 'Liam Garcia' })).toHaveAttribute(
      'href',
      '/aid/households/1000003?from=all&year=2027'
    )
  })

  it('highlights a row on a click anywhere else', async () => {
    render(<Grid />)
    await userEvent.click(within(rowOf('Liam Garcia')).getAllByRole('cell')[1] as HTMLElement)
    expect(highlights).toEqual(['reqliam00000002'])
    expect(rowOf('Liam Garcia')).toHaveAttribute('data-highlighted', 'true')
  })

  it('brings the household and person ids back as columns with Show IDs (D27)', () => {
    render(<Grid showIds />)
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent)
    expect(headers.slice(0, 2)).toEqual(['Camper', 'Person'])
    expect(headers.slice(-3)).toEqual(['Requested by', 'Household', 'Needs attention'])
    expect(within(rowOf('Liam Garcia')).getByText('1000004')).toBeInTheDocument()
  })

  it('shows a matched id as a chip under the requester’s name (D27)', async () => {
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

  // Batch 4 (owner LOCKED): the cell is the chip only; All's next step moved out of the cell into
  // the opened row's detail line ("the detail line" tests below). Was: "gives All's
  // needs-attention cell its next step, and a queue view none (§4.4)".
  it('puts no next step in the needs-attention cell, in All or a queue view', () => {
    const { unmount } = render(<Grid />)
    expect(within(rowOf('Liam Garcia')).queryByRole('link', { name: /income/ })).toBeNull()
    unmount()
    render(<Grid slug="holds" />)
    expect(screen.queryByRole('link', { name: /income/ })).toBeNull()
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

describe('RequestsGrid fits its labels (sitting A, A2)', () => {
  it('lets a column header wrap, so two long headers never print over each other', () => {
    render(<Grid />)
    const header = screen.getByRole('columnheader', { name: 'CM ✓' })
    expect(header.className).not.toContain('whitespace-nowrap')
    expect(header.className).toContain('whitespace-normal')
  })

  it('lets a Stage chip wrap inside its column instead of being cut off', () => {
    render(<Grid />)
    const chip = screen.getAllByText(/^R\d · /)[0]
    expect(chip?.className).not.toContain('whitespace-nowrap')
  })

  it('gives the Stage column room for its commonest chip', () => {
    expect(GRID_COLUMNS.stage.width).toBeGreaterThanOrEqual(140)
  })
})

describe('RequestsGrid in the screen box (grid layout T1)', () => {
  it('sits in the one scrolling box, with the header held', () => {
    render(<Grid />)
    const table = screen.getByRole('table')
    expect(table.parentElement?.className).toContain('overscroll-contain')
    expect(screen.getByRole('columnheader', { name: 'Session' }).className).toContain('top-0')
  })
})

/** A server-owned pending sentence (#2996's cm_pending_message), as the read sends it. */
const V1_SENTENCE = 'Ticked today; the server says tonight’s sync checks it.'

// Owner ruling 2026-10-02: the ledger-confirmation column is "CM ✓", in short words.
describe('RequestsGrid: the CM ✓ column', () => {
  const withConfirmation = (
    id: string,
    camper: string,
    over: Parameters<typeof confirmationOut>[0]
  ) =>
    gridRow({
      request_id: id,
      camper_name: camper,
      confirmation: confirmationOut(over),
    })
  const ROWS = [
    withConfirmation('reqc1', 'Emma Johnson', { status: 'confirmed', on: '2027-03-10' }),
    withConfirmation('reqc2', 'Liam Garcia', {
      status: 'short',
      locked: 1800,
      in_campminder: 1750,
      on: null,
    }),
    withConfirmation('reqc3', 'Olivia Chen', {
      status: 'over',
      locked: 1800,
      in_campminder: 1850,
      on: null,
    }),
    // V1 (#2996): ticked by hand today; the server marks the round pending with its own sentence.
    gridRow({
      request_id: 'reqc4',
      camper_name: 'Riley Sam',
      confirmation: confirmationOut({ status: 'awaiting_sync', on: null }),
      rounds: [
        roundOut(1, 'posted', {
          posted: 900,
          posted_on: '2027-04-01',
          cm_pending: true,
          cm_pending_message: V1_SENTENCE,
        }),
      ],
    }),
  ]
  const cmCell = (camper: string) => {
    const at = screen.getAllByRole('columnheader').findIndex((th) => th.textContent === 'CM ✓')
    return within(rowOf(camper)).getAllByRole('cell')[at]
  }
  const hoverHeader = () =>
    userEvent.hover(
      screen.getByRole('columnheader', { name: 'CM ✓' }).firstElementChild as HTMLElement
    )
  // Owner ruling (A2, batch 4): verbatim, the pending word from its one constant.
  const EXPLAIN = `CampMinder check: did the money posted in CampMinder match what was ticked Posted? ✓ = matched; short/over = CampMinder's ledger differs; missing = nothing in CampMinder for it; reversed = the posting was reversed; ${CM_PENDING_WORD} = waiting for tonight's sync.`

  // Owner ruling (A2, batch 4): chips only, one word each. Was "✓ Mar 10", "short $50",
  // "over $50", "tonight" and the interim "not in CM".
  it('says one word on a chip for each of the six states, with no amount or date', () => {
    const rows = [
      ...ROWS,
      withConfirmation('reqc5', 'Samuel Johnson', { status: 'not_in_campminder', on: null }),
    ]
    const { unmount } = render(<Grid rows={rows} />)
    const word = (camper: string, text: string) => {
      const cell = cmCell(camper) as HTMLElement
      expect(cell).toHaveTextContent(new RegExp(`^${text}$`))
      // The word is a chip, the cell's only child.
      expect(cell.children).toHaveLength(1)
      expect(cell.firstElementChild?.className).toContain('rounded-full')
    }
    word('Emma Johnson', '✓')
    word('Liam Garcia', 'short')
    word('Olivia Chen', 'over')
    word('Riley Sam', CM_PENDING_WORD)
    word('Samuel Johnson', 'missing')
    unmount()
    render(
      <Grid
        rows={[withConfirmation('reqc6', 'Emma Johnson', { status: 'reversed', on: '2027-10-02' })]}
      />
    )
    word('Emma Johnson', 'reversed')
  })

  it('explains itself on hover and on click, and a click does not sort', async () => {
    render(<Grid rows={ROWS} />)
    const header = screen.getByRole('columnheader', { name: 'CM ✓' })
    await hoverHeader()
    expect(screen.getByRole('tooltip')).toHaveTextContent(EXPLAIN)
    await userEvent.unhover(header.firstElementChild as HTMLElement)
    expect(screen.queryByRole('tooltip')).toBeNull()
    await userEvent.click(header.firstElementChild as HTMLElement)
    expect(screen.getByRole('tooltip')).toHaveTextContent(EXPLAIN)
    expect(header).not.toHaveAttribute('aria-sort')
    expect(
      screen
        .getAllByRole('row')
        .filter((r) => r.hasAttribute('data-row-key'))
        .map((r) => r.getAttribute('data-row-key'))
    ).toEqual(['reqc1', 'reqc2', 'reqc3', 'reqc4'])
  })

  // Owner 2026-10-02: no ⓘ; the text itself says it explains itself (the dotted underline the
  // journey rows use for a Tooltip trigger) and the cursor says help.
  it('marks the header text as explained: dotted underline, help cursor, no icon', () => {
    render(<Grid rows={ROWS} />)
    const header = screen.getByRole('columnheader', { name: 'CM ✓' })
    const trigger = header.firstElementChild as HTMLElement
    expect(trigger).toHaveClass(
      'underline',
      'decoration-dotted',
      'underline-offset-2',
      'cursor-help'
    )
    expect(header.querySelector('svg')).toBeNull()
    expect(header).toHaveTextContent(/^CM ✓$/)
  })

  it('is there in a ticked season and gone before it (the read says which, #2994)', () => {
    const { unmount } = render(<Grid rows={ROWS} tickedSeason />)
    expect(screen.getByRole('columnheader', { name: 'CM ✓' })).toBeInTheDocument()
    unmount()
    render(<Grid rows={ROWS} tickedSeason={false} />)
    expect(screen.queryByRole('columnheader', { name: 'CM ✓' })).toBeNull()
  })

  // #2996 C1: no confirmation yet, but the round is pending; the opened row says the server's sentence.
  it("shows pending on a C1 row's chip, and the server's sentence in its opened row", async () => {
    const c1 = gridRow({
      request_id: 'reqc7',
      camper_name: 'Emma Johnson',
      confirmation: null,
      rounds: [
        roundOut(1, 'needs_offer', {
          decided: 900,
          cm_pending: true,
          cm_pending_message: 'A C1 sentence from the server.',
        }),
      ],
    })
    render(<Grid rows={[c1]} />)
    expect(cmCell('Emma Johnson')).toHaveTextContent(new RegExp(`^${CM_PENDING_WORD}$`))
    await userEvent.click(within(rowOf('Emma Johnson')).getAllByRole('cell')[1] as HTMLElement)
    const line = document.querySelector('[data-aid-detail]') as HTMLElement
    expect(within(line).getByText('A C1 sentence from the server.')).toBeInTheDocument()
  })

  // Owner ruling (A2, batch 4): the CSV keeps the full detail, not the one-word chip. Was "the
  // screen's words".
  it('writes the CSV with the full header name and the full detail, and drops the column in a season not ticked', async () => {
    const { unmount } = render(<Grid rows={ROWS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    const [content] = downloadSpy.mock.calls.at(-1) as [string, string]
    const lines = content.split('\n')
    const at = csvCells(lines[0] ?? '').indexOf('Confirmed by CampMinder')
    expect(at).toBeGreaterThan(-1)
    expect(csvCells(lines[0] ?? '')).not.toContain('CM ✓')
    expect(lines.slice(1, 5).map((l) => csvCells(l)[at])).toEqual([
      '✓ confirmed Mar 10',
      'CampMinder shows $1,750; short $50',
      'CampMinder shows $1,850; over $50',
      V1_SENTENCE,
    ])
    unmount()
    render(<Grid rows={ROWS} tickedSeason={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    const [older] = downloadSpy.mock.calls.at(-1) as [string, string]
    expect(csvCells(older.split('\n')[0] ?? '')).not.toContain('Confirmed by CampMinder')
  })
})

// Batch 4 (owner LOCKED, grid-layout-options.html#or=i, round 6). The next-step labels are the
// mock's, INTERIM. #2943 has no writers: every next step is a link or plain words, never a button.
describe('RequestsGrid: Needs attention frozen right, and the detail line (batch 4)', () => {
  const BASE = '/aid/households/1000003?from=all&year=2027'
  const LIAM_FACT =
    'Income was entered as $1, so no tier can be set. Call for the real figure and enter it as a correction.'
  const attentionCell = (camper: string) =>
    within(rowOf(camper)).getAllByRole('cell').at(-1) as HTMLElement
  const detail = () => {
    const row = document.querySelector('[data-aid-detail]')
    if (row === null) throw new Error('no detail line')
    return row as HTMLElement
  }
  const openRow = (camper: string) =>
    userEvent.click(within(rowOf(camper)).getAllByRole('cell')[1] as HTMLElement)

  it('shows only the chip in the Needs attention cell', () => {
    render(<Grid />)
    expect(attentionCell('Liam Garcia')).toHaveTextContent(/^Placeholder income$/)
    expect(within(rowOf('Liam Garcia')).queryByText(LIAM_FACT)).toBeNull()
  })

  it('freezes Needs attention on the right edge, and fits it to the chips on screen', () => {
    render(<Grid />)
    expect(screen.getByRole('columnheader', { name: 'Needs attention' }).style.right).toBe('0px')
    expect(attentionCell('Liam Garcia').style.right).toBe('0px')
    // jsdom has no layout, so every chip measures 0: the column sits on its 84px floor.
    const cols = screen.getByRole('table').querySelectorAll('col')
    expect((cols[cols.length - 1] as HTMLElement).style.width).toBe('84px')
  })

  it('opens a detail line under the clicked row, and Esc closes it', async () => {
    render(<Grid />)
    expect(document.querySelector('[data-aid-detail]')).toBeNull()
    await openRow('Liam Garcia')
    expect(detail().previousElementSibling).toBe(rowOf('Liam Garcia'))
    await userEvent.keyboard('{Escape}')
    expect(document.querySelector('[data-aid-detail]')).toBeNull()
    expect(highlights.at(-1)).toBeNull()
  })

  it('opens it with ↓ as well', async () => {
    render(<Grid />)
    await userEvent.keyboard('{ArrowDown}')
    expect(detail().previousElementSibling).toHaveAttribute('data-highlighted', 'true')
  })

  it('holds the chip, the full text, Requested by, the household link and the next step, with no button', async () => {
    render(<Grid />)
    await openRow('Liam Garcia')
    const line = within(detail())
    expect(line.getByText('Placeholder income')).toHaveClass('rounded-full')
    expect(line.getByText(LIAM_FACT)).toBeInTheDocument()
    expect(line.getByText('Requested by')).toBeInTheDocument()
    expect(line.getByText('Ana Garcia')).toBeInTheDocument()
    expect(line.queryByText('Family')).toBeNull()
    expect(line.queryByText('The Garcia Family')).toBeNull()
    expect(line.getByRole('link', { name: 'Household 1000003 ›' })).toHaveAttribute('href', BASE)
    const next = line.getByRole('link', { name: 'Enter the Income ›' })
    expect(next).toHaveAttribute('href', `${BASE}#income`)
    expect(line.queryAllByRole('button')).toHaveLength(0)
    await userEvent.click(next)
    expect(open).toHaveBeenCalledWith(ROW_LIAM, `${BASE}#income`)
    expect(highlights).toEqual(['reqliam00000002'])
  })

  it("links a request-level step to the request's card", async () => {
    const row = gridRow({
      request_id: 'reqliam00000002',
      household_cm_id: 1000003,
      camper_name: 'Liam Garcia',
      holds: [{ code: 'manual_hold', severity: 'hold', message: 'Waiting on a document.' }],
      queues: ['holds'],
    })
    render(<Grid rows={[row]} />)
    await openRow('Liam Garcia')
    expect(within(detail()).getByRole('link', { name: 'Release the Hold… ›' })).toHaveAttribute(
      'href',
      `${BASE}#request-reqliam00000002`
    )
  })

  it('says so in plain words where Kindred has nothing to do', async () => {
    render(<Grid />)
    await openRow('Riley Sam')
    const line = within(detail())
    expect(line.getByText('Reverse it in CampMinder; nothing to do here')).toBeInTheDocument()
    expect(line.getAllByRole('link').map((a) => a.textContent)).toEqual(['Household 1000007 ›'])
  })

  it('draws no next step where the mock has a tick or editor button (#2951, #2948 add them)', async () => {
    render(<Grid slug="waiting" />)
    await openRow('Samuel Johnson')
    const line = within(detail())
    expect(line.getByText('Waiting 23 days')).toBeInTheDocument()
    expect(line.getAllByRole('link').map((a) => a.textContent)).toEqual(['Household 1000001 ›'])
    expect(line.queryAllByRole('button')).toHaveLength(0)
  })

  it('says a row that needs nothing needs nothing, and still opens the request', async () => {
    render(<Grid />)
    await openRow('Emma Johnson')
    const line = within(detail())
    expect(line.getByText('Nothing needs attention on this request.')).toBeInTheDocument()
    expect(line.getByRole('link', { name: 'Open the Request ›' })).toHaveAttribute(
      'href',
      '/aid/households/1000001?from=all&year=2027#request-reqemma00000001'
    )
  })

  it('shows the CM ✓ detail in the detail line only in a ticked season', async () => {
    const { unmount } = render(<Grid />)
    await openRow('Samuel Johnson')
    expect(within(detail()).getByText('CampMinder shows $1,590; short $210')).toBeInTheDocument()
    unmount()
    render(<Grid tickedSeason={false} />)
    await openRow('Samuel Johnson')
    // (The needs-attention text itself may still say what CampMinder shows; the CM ✓ part is gone.)
    expect(within(detail()).queryByText('CampMinder shows $1,590; short $210')).toBeNull()
    expect(within(detail()).queryByText('CM ✓')).toBeNull()
  })

  it('no longer grows the opened row tall: no full text in it, and names stay on one line', async () => {
    render(<Grid />)
    await openRow('Liam Garcia')
    const row = rowOf('Liam Garcia')
    expect(row).toHaveAttribute('data-highlighted', 'true')
    expect(within(row).queryByText(LIAM_FACT)).toBeNull()
    expect(attentionCell('Liam Garcia')).not.toHaveClass('whitespace-normal')
    const requester = within(row).getByRole('link', { name: 'Ana Garcia' })
    expect(requester.parentElement).toHaveClass('truncate')
  })

  it('spans every column, and keeps Person beside the pinned Camper with Show IDs (D25)', async () => {
    render(<Grid showIds />)
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent)
    expect(headers.slice(0, 2)).toEqual(['Camper', 'Person'])
    expect(headers.at(-1)).toBe('Needs attention')
    await openRow('Liam Garcia')
    expect((detail().firstElementChild as HTMLTableCellElement).colSpan).toBe(headers.length)
  })
})
