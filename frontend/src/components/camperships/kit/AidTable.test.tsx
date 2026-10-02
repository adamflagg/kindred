/**
 * The table primitive (§4.3; D18, D20, D24, D25, D28, D29, D31; mockups/round7.html).
 * Fictional rows (tests/CLAUDE.md); figures invented.
 */
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AidTable, type AidColumn, type AidGrouping } from './AidTable'
import { moneyCsv } from './money'
import { Money } from './MoneyText'
import { NeedsAttentionCell } from './NeedsAttentionCell'
import { IdChip } from './Pills'
import { matchedId } from './table'

const downloadSpy = vi.fn()
const parseSortSpy = vi.fn()
vi.mock('./table', async (importActual) => {
  const actual = await importActual<typeof import('./table')>()
  return {
    ...actual,
    parseSort: (...args: Parameters<typeof actual.parseSort>) => {
      parseSortSpy(...args)
      return actual.parseSort(...args)
    },
  }
})
vi.mock('../../../utils/csvExport', async (importActual) => ({
  ...(await importActual<typeof import('../../../utils/csvExport')>()),
  downloadCsv: (...args: unknown[]) => downloadSpy(...args),
}))

interface Row {
  id: string
  family: string
  camper: string
  householdCmId: number
  personCmId: number
  decided: number | null
  change: number | null
  reason: string
  fact: string
}

const ROWS: Row[] = [
  {
    id: 'r1',
    family: 'Johnson',
    camper: 'Emma Johnson',
    householdCmId: 1000001,
    personCmId: 1000002,
    decided: 1800,
    change: -800,
    reason: 'Income conflict',
    fact: 'Two forms disagree on income. Call the family and enter one figure.',
  },
  {
    id: 'r2',
    family: 'Garcia',
    camper: 'Liam Garcia',
    householdCmId: 1000003,
    personCmId: 1000004,
    decided: null,
    change: null,
    reason: 'Placeholder income',
    fact: 'Income was entered as $1, so no tier can be set.',
  },
  {
    id: 'r3',
    family: 'Chen',
    camper: 'Olivia Chen',
    householdCmId: 1000005,
    personCmId: 1000006,
    decided: 950,
    change: 300,
    reason: 'Income conflict',
    fact: 'The two forms report different incomes.',
  },
  {
    id: 'r4',
    family: 'Johnson',
    camper: 'Samuel Johnson',
    householdCmId: 1000001,
    personCmId: 1000008,
    decided: 1200,
    change: 0,
    reason: 'Placeholder income',
    fact: 'Income was entered as $1.',
  },
]

const COLUMNS: Array<AidColumn<Row>> = [
  {
    key: 'family',
    header: 'Family',
    width: 110,
    pinned: true,
    value: (r) => r.family,
    searchable: true,
  },
  {
    key: 'camper',
    header: 'Camper',
    width: 130,
    pinned: true,
    value: (r) => r.camper,
    searchable: true,
  },
  {
    key: 'decided',
    header: 'Decided',
    width: 90,
    align: 'right',
    value: (r) => r.decided,
    render: (r) => <Money value={r.decided} />,
    csv: (r) => moneyCsv(r.decided),
    total: (rows) => rows.reduce((sum, r) => sum + (r.decided ?? 0), 0),
  },
  {
    key: 'change',
    header: 'Would change by',
    width: 110,
    align: 'right',
    value: (r) => r.change,
    render: (r) => <Money value={r.change} />,
    csv: (r) => moneyCsv(r.change),
  },
  {
    key: 'attention',
    header: 'Needs attention',
    flex: true,
    value: (r) => r.fact,
    render: (r, { highlighted }) => (
      <NeedsAttentionCell
        item={{ level: 'hold', pill: r.reason, fact: r.fact }}
        highlighted={highlighted}
      />
    ),
  },
]

const GROUPINGS: Array<AidGrouping<Row>> = [
  {
    key: 'family',
    label: 'By family',
    groupOf: (r) => ({ id: String(r.householdCmId), heading: r.family }),
  },
  { key: 'reason', label: 'By reason', groupOf: (r) => ({ id: r.reason, heading: r.reason }) },
]

function Where() {
  const { search } = useLocation()
  return <div data-testid="where">{search}</div>
}

function renderTable(
  path = '/aid/requests',
  extra: Partial<Parameters<typeof AidTable<Row>>[0]> = {}
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AidTable<Row>
        rows={ROWS}
        columns={COLUMNS}
        rowKey={(r) => r.id}
        searchExtra={(r) => [r.householdCmId, r.personCmId]}
        groupings={GROUPINGS}
        csvFilename="camperships-requests-all-2027.csv"
        footerLabel={(rows) => `${String(rows.length)} requests`}
        arrowKeys
        {...extra}
      />
      <Where />
    </MemoryRouter>
  )
}

const bodyCampers = () =>
  screen
    .getAllByRole('row')
    .filter((row) => row.hasAttribute('data-row-key'))
    .map((row) => within(row).getAllByRole('cell')[1]?.textContent)

beforeEach(() => downloadSpy.mockClear())

describe('AidTable', () => {
  it('keeps the row you are on through a search that does not match it (uncontrolled)', async () => {
    renderTable('/aid/requests', { renderBelowHighlighted: (r) => <div>Editing {r.camper}</div> })
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'garcia')
    expect(bodyCampers()).toEqual(['Emma Johnson', 'Liam Garcia'])
    expect(screen.getByText('Editing Emma Johnson')).toBeInTheDocument()
  })

  it('sorts on a header click, ascending then descending, keeping "—" last, and keeps it in the URL', async () => {
    renderTable()
    await userEvent.click(screen.getByRole('button', { name: 'Decided' }))
    expect(bodyCampers()).toEqual(['Olivia Chen', 'Samuel Johnson', 'Emma Johnson', 'Liam Garcia'])
    expect(screen.getByTestId('where')).toHaveTextContent('sort=decided%3Aasc')

    await userEvent.click(screen.getByRole('button', { name: 'Decided' }))
    expect(bodyCampers()).toEqual(['Emma Johnson', 'Samuel Johnson', 'Olivia Chen', 'Liam Garcia'])
  })

  it('reads its sort from a pasted link (D15)', () => {
    renderTable('/aid/requests?sort=camper%3Adesc')
    expect(bodyCampers()).toEqual(['Samuel Johnson', 'Olivia Chen', 'Liam Garcia', 'Emma Johnson'])
  })

  it('searches names and CampMinder ids the columns do not show (D27)', async () => {
    renderTable()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), '1000004')
    expect(bodyCampers()).toEqual(['Liam Garcia'])
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'johnson')
    expect(bodyCampers()).toEqual(['Emma Johnson', 'Samuel Johnson'])
  })

  it('groups by reason with the sentence once as the heading, and goes flat again (D24)', async () => {
    renderTable()
    await userEvent.click(screen.getByRole('button', { name: 'By reason' }))
    expect(screen.getByTestId('where')).toHaveTextContent('group=reason')
    expect(
      screen.getAllByText('Income conflict', { selector: 'td[data-group-heading] > span' })
    ).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'Flat' }))
    expect(
      screen.queryByText('Income conflict', { selector: 'td[data-group-heading] > span' })
    ).toBeNull()
  })

  it('opens a queue view grouped by default, and remembers "flat" in the URL', async () => {
    renderTable('/aid/requests', { defaultGrouping: 'reason' })
    expect(
      screen.getByText('Placeholder income', { selector: 'td[data-group-heading] > span' })
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Flat' }))
    expect(screen.getByTestId('where')).toHaveTextContent('group=flat')
  })

  it('highlights a row on click and shows its full needs-attention text (D31)', async () => {
    renderTable()
    const fact = 'Two forms disagree on income. Call the family and enter one figure.'
    expect(screen.getByText(fact)).toHaveClass('truncate')
    await userEvent.click(screen.getByText('Emma Johnson'))
    expect(screen.getByText('Emma Johnson').closest('tr')).toHaveAttribute(
      'data-highlighted',
      'true'
    )
    expect(screen.getByText(fact)).not.toHaveClass('truncate')
  })

  it('moves the highlight with ↓ and ↑, but not while you type in the search box', async () => {
    renderTable()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByText('Liam Garcia').closest('tr')).toHaveAttribute(
      'data-highlighted',
      'true'
    )
    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getByText('Emma Johnson').closest('tr')).toHaveAttribute(
      'data-highlighted',
      'true'
    )

    await userEvent.click(screen.getByRole('searchbox', { name: 'Search' }))
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByText('Emma Johnson').closest('tr')).toHaveAttribute(
      'data-highlighted',
      'true'
    )
  })

  it('opens the editor row under the highlighted row only (D22)', async () => {
    renderTable('/aid/requests', { renderBelowHighlighted: (r) => <div>Editing {r.camper}</div> })
    expect(screen.queryByText(/^Editing/)).toBeNull()
    await userEvent.click(screen.getByText('Olivia Chen'))
    expect(screen.getByText('Editing Olivia Chen')).toBeInTheDocument()
    expect(screen.getAllByText(/^Editing/)).toHaveLength(1)
  })

  // Ruling 2026-10-01 (plan review): the editor row moves the highlight itself (Task 14 walks it).
  it('hands the editor row next, previous and close', async () => {
    renderTable('/aid/requests', {
      renderBelowHighlighted: (r, nav) => (
        <div>
          <span>Editing {r.camper}</span>
          <button type="button" onClick={nav.next}>
            Next row
          </button>
          <button type="button" onClick={nav.previous}>
            Previous row
          </button>
          <button type="button" onClick={nav.close}>
            Close
          </button>
        </div>
      ),
    })
    await userEvent.click(screen.getByText('Olivia Chen'))
    await userEvent.click(screen.getByRole('button', { name: 'Next row' }))
    expect(screen.getByText('Editing Samuel Johnson')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Previous row' }))
    expect(screen.getByText('Editing Olivia Chen')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText(/^Editing/)).toBeNull()
  })

  it('hands each cell the search, so a matched CampMinder id can show as a chip (D27)', async () => {
    const withChip = COLUMNS.map((c) =>
      c.key === 'camper'
        ? {
            ...c,
            render: (r: Row, { query }: { query: string }) => {
              const id = matchedId([r.householdCmId, r.personCmId], query)
              return (
                <>
                  {r.camper}
                  {id !== null && <IdChip id={id} />}
                </>
              )
            },
          }
        : c
    )
    renderTable('/aid/requests', { columns: withChip })
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), '1000004')
    expect(screen.getByText('1000004')).toHaveClass('font-mono')
  })

  it('wraps only the highlighted flexible cell, with one white-space class per cell', async () => {
    renderTable()
    await userEvent.click(screen.getByText('Emma Johnson'))
    const cell = screen
      .getByText('Two forms disagree on income. Call the family and enter one figure.')
      .closest('td')
    expect(cell).toHaveClass('whitespace-normal')
    expect(cell).not.toHaveClass('whitespace-nowrap')
    expect(screen.getByText('Liam Garcia').closest('td')).toHaveClass('whitespace-nowrap')
  })

  it('gives a highlighted first cell that is also the last pinned one a single combined shadow', async () => {
    renderTable('/aid/requests', {
      columns: COLUMNS.map((c) => (c.key === 'camper' ? { ...c, pinned: false } : c)),
    })
    await userEvent.click(screen.getByText('Emma Johnson'))
    const first = screen.getByText('Emma Johnson').closest('tr')?.querySelector('td')
    const shadows = (first?.className ?? '').split(' ').filter((c) => c.startsWith('shadow-'))
    expect(shadows).toEqual([
      'shadow-[inset_3px_0_0_var(--color-amber-500),6px_0_6px_-6px_rgb(0_0_0/0.25)]',
    ])
  })

  it('totals a money column in the footer over the rows on screen, and the total opens them (D20)', async () => {
    const onOpenTotal = vi.fn()
    renderTable('/aid/requests', { onOpenTotal })
    await userEvent.click(screen.getByRole('button', { name: '$3,950' }))
    expect(onOpenTotal).toHaveBeenCalledWith('decided', expect.arrayContaining([ROWS[0], ROWS[2]]))
    expect(screen.getByText('4 requests')).toBeInTheDocument()

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'chen')
    expect(screen.getByRole('button', { name: '$950' })).toBeInTheDocument()
  })

  // Needs PR 0 on main: before it, `-800` came out as `'-800`.
  it('downloads exactly the rows and columns on screen, numbers plain, with the link last (§11)', async () => {
    renderTable()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'johnson')
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))

    expect(downloadSpy).toHaveBeenCalledTimes(1)
    const [content, filename] = downloadSpy.mock.calls[0] as [string, string]
    expect(filename).toBe('camperships-requests-all-2027.csv')
    const lines = content.split('\n')
    expect(lines[0]).toBe('Family,Camper,Decided,Would change by,Needs attention')
    expect(lines[1]).toBe(
      'Johnson,Emma Johnson,1800,-800,Two forms disagree on income. Call the family and enter one figure.'
    )
    expect(lines[2]).toBe('Johnson,Samuel Johnson,1200,0,Income was entered as $1.')
    expect(lines[3]).toBe('')
    expect(lines[4]).toMatch(/^Link,http/)
  })

  it('pins the identity columns, each at its left offset, with the edge shadow on the last (D25)', () => {
    renderTable()
    const family = screen.getByRole('columnheader', { name: 'Family' })
    const camper = screen.getByRole('columnheader', { name: 'Camper' })
    expect(family).toHaveClass('sticky')
    expect(family).toHaveStyle({ left: '0px' })
    expect(camper).toHaveStyle({ left: '110px' })
    expect(camper.className).toContain('shadow-[6px_0_6px_-6px')
  })

  it('says so when a search matches nothing', async () => {
    renderTable()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'nobody')
    expect(screen.getByText('No rows match.')).toBeInTheDocument()
  })

  it('walks rows with ↑/↓ while the editor is open, and ↓ in the editor saves and moves on', async () => {
    const saved = vi.fn()
    renderTable('/aid/requests', {
      renderBelowHighlighted: (r, nav) => (
        <input
          aria-label={`Note for ${r.camper}`}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              saved(r.id)
              nav.next()
            } else if (event.key === 'ArrowUp') nav.previous()
          }}
        />
      ),
    })
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.click(screen.getByLabelText('Note for Emma Johnson'))
    await userEvent.keyboard('{ArrowDown}')
    expect(saved).toHaveBeenCalledWith('r1')
    expect(screen.getByText('Liam Garcia').closest('tr')).toHaveAttribute(
      'data-highlighted',
      'true'
    )
    expect(screen.getAllByLabelText(/^Note for/)).toHaveLength(1)
    // The table's own listener stands aside while the editor's field has the key: one step, not two.
    // Walk from Olivia (index 2) so a double step could not land on the same row.
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByText('Olivia Chen').closest('tr')).toHaveAttribute(
      'data-highlighted',
      'true'
    )
    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getByText('Liam Garcia').closest('tr')).toHaveAttribute(
      'data-highlighted',
      'true'
    )
    expect(screen.getAllByLabelText(/^Note for/)).toHaveLength(1)
  })

  it('ignores a key already handled, held down, or part of a composition', async () => {
    renderTable()
    const row = (name: string) => screen.getByText(name).closest('tr')
    const press = (init: KeyboardEventInit) =>
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            bubbles: true,
            cancelable: true,
            ...init,
          })
        )
      })
    press({ repeat: true })
    press({ isComposing: true })
    expect(row('Emma Johnson')).not.toHaveAttribute('data-highlighted')
    const handled = (event: KeyboardEvent) => event.preventDefault()
    window.addEventListener('keydown', handled, true)
    press({})
    window.removeEventListener('keydown', handled, true)
    expect(row('Emma Johnson')).not.toHaveAttribute('data-highlighted')
    press({})
    expect(row('Emma Johnson')).toHaveAttribute('data-highlighted', 'true')
  })

  it('stands aside for a button inside the editor row too (I1)', async () => {
    renderTable('/aid/requests', {
      renderBelowHighlighted: () => <button type="button">Save</button>,
    })
    await userEvent.click(screen.getByText('Emma Johnson'))
    screen.getByRole('button', { name: 'Save' }).focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByText('Emma Johnson').closest('tr')).toHaveAttribute(
      'data-highlighted',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('parses the sort once while the URL is unchanged (I2)', async () => {
    renderTable('/aid/requests?sort=camper%3Aasc')
    parseSortSpy.mockClear()
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.click(screen.getByText('Liam Garcia'))
    await userEvent.keyboard('{ArrowDown}')
    expect(parseSortSpy).not.toHaveBeenCalled()
  })

  it('gives a right-aligned header one text-align class (I3)', () => {
    renderTable()
    const cls = screen.getByRole('columnheader', { name: 'Decided' }).className.split(' ')
    expect(cls.filter((c) => c === 'text-left' || c === 'text-right').length).toBeLessThanOrEqual(1)
  })

  it('writes a money column without its own csv through moneyCsv (M5)', async () => {
    renderTable('/aid/requests', {
      columns: COLUMNS.map((c) => {
        if (c.key !== 'decided') return c
        return { ...c, csv: undefined, value: (r: Row) => (r.id === 'r1' ? 0.1 + 0.2 : r.decided) }
      }),
    })
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    const [content] = downloadSpy.mock.calls[0] as [string, string]
    expect(content.split('\n')[1]).toMatch(/^Johnson,Emma Johnson,0\.30,/)
  })
})

// Slice 1 (owner rulings A and B, 2026-10-01): a surface owns the highlight, so it can save what
// is typed before a row changes, and put the highlight back on a row whose save failed.
let asked: Array<string | null> = []

function Controlled({
  agree,
  extra = {},
}: {
  agree: boolean
  extra?: Partial<Parameters<typeof AidTable<Row>>[0]>
}) {
  const [highlighted, setHighlighted] = useState<string | null>(null)
  return (
    <MemoryRouter initialEntries={['/aid/requests']}>
      <AidTable<Row>
        rows={ROWS}
        columns={COLUMNS}
        rowKey={rowKeyOf}
        csvFilename="camperships-requests-all-2027.csv"
        arrowKeys
        highlighted={highlighted}
        onHighlight={(key) => {
          asked.push(key)
          if (agree) setHighlighted(key)
        }}
        renderBelowHighlighted={(r) => <div>Editing {r.camper}</div>}
        {...extra}
      />
    </MemoryRouter>
  )
}

const rowKeyOf = (r: Row) => r.id
const highlightedCamper = () =>
  screen
    .getAllByRole('row')
    .find((row) => row.getAttribute('data-highlighted') === 'true')
    ?.querySelectorAll('td')[1]?.textContent ?? null

describe('AidTable with a controlled highlight', () => {
  beforeEach(() => {
    asked = []
  })

  it('keeps the highlighted row through a search that does not match it, so its editor stays', async () => {
    render(<Controlled agree />)
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'chen')
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.getByText('Editing Emma Johnson')).toBeInTheDocument()
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.queryByText('Liam Garcia')).toBeNull()
  })

  it('asks the surface before a click moves the highlight, and moves only when it agrees', async () => {
    render(<Controlled agree={false} />)
    await userEvent.click(screen.getByText('Olivia Chen'))
    expect(asked).toEqual(['r3'])
    expect(highlightedCamper()).toBeNull()
  })

  it('shows the highlight the surface keeps, and sends the table’s ↓ through it too', async () => {
    render(<Controlled agree />)
    await userEvent.click(screen.getByText('Olivia Chen'))
    expect(highlightedCamper()).toBe('Olivia Chen')
    await userEvent.keyboard('{ArrowDown}')
    expect(asked).toEqual(['r3', 'r4'])
    expect(screen.getByText('Editing Samuel Johnson')).toBeInTheDocument()
  })

  it('asks nothing for a click on the row already highlighted', async () => {
    render(<Controlled agree />)
    await userEvent.click(screen.getByText('Olivia Chen'))
    await userEvent.click(screen.getByText('Olivia Chen'))
    expect(asked).toEqual(['r3'])
  })

  it('lets the editor row put the highlight on any row (ruling A jumps back with it)', async () => {
    renderTable('/aid/requests', {
      renderBelowHighlighted: (r, nav) => (
        <div>
          <span>Editing {r.camper}</span>
          <button type="button" onClick={() => nav.highlight('r1')}>
            Back to Emma
          </button>
        </div>
      ),
    })
    await userEvent.click(screen.getByText('Olivia Chen'))
    await userEvent.click(screen.getByRole('button', { name: 'Back to Emma' }))
    expect(screen.getByText('Editing Emma Johnson')).toBeInTheDocument()
  })

  // The editor row's nav in a controlled table: every method goes through `onHighlight` and moves
  // nothing by itself (the surface keeps the highlight, here fixed on r3). Regression guards.
  it.each([
    ['highlight(key)', 'Jump to Emma', 'r1'],
    ['next', 'Next', 'r4'],
    ['previous', 'Previous', 'r2'],
    ['close', 'Close', null],
  ])(
    'sends nav.%s through onHighlight and moves nothing itself',
    async (_name, label, expected) => {
      render(
        <MemoryRouter initialEntries={['/aid/requests']}>
          <AidTable<Row>
            rows={ROWS}
            columns={COLUMNS}
            rowKey={rowKeyOf}
            csvFilename="camperships-requests-all-2027.csv"
            highlighted="r3"
            onHighlight={(key) => asked.push(key)}
            renderBelowHighlighted={(r, nav) => (
              <div>
                <span>Editing {r.camper}</span>
                <button type="button" onClick={() => nav.highlight('r1')}>
                  Jump to Emma
                </button>
                <button type="button" onClick={nav.next}>
                  Next
                </button>
                <button type="button" onClick={nav.previous}>
                  Previous
                </button>
                <button type="button" onClick={nav.close}>
                  Close
                </button>
              </div>
            )}
          />
        </MemoryRouter>
      )
      await userEvent.click(screen.getByRole('button', { name: label }))
      expect(asked).toEqual([expected])
      expect(highlightedCamper()).toBe('Olivia Chen')
      expect(screen.getByText('Editing Olivia Chen')).toBeInTheDocument()
    }
  )
})

describe('the footer label', () => {
  it('spans the pinned columns, so the sticky Camper cell cannot cover it (I1)', () => {
    renderTable()
    const label = screen.getByText('4 requests').closest('td')
    expect(label).not.toBeNull()
    expect(label).toHaveAttribute('colspan', '2')
    // The two pinned footer cells are one cell now: label, then Decided, Would change by, attention.
    expect(label?.closest('tr')?.querySelectorAll('td')).toHaveLength(4)
  })
})

// Owner ruling R1 (2026-10-01): the row you are on stays on screen under a search that hides it,
// but totals, group counts and the CSV always mean the rows matching the search.
describe('a row kept on screen under a search', () => {
  const COUNTED = {
    groupings: GROUPINGS,
    defaultGrouping: 'family',
    groupCount: (rows: readonly Row[]) => `${String(rows.length)} in group`,
    footerLabel: (rows: readonly Row[]) => `${String(rows.length)} requests`,
  }
  const groupHeading = (name: string) =>
    [...document.querySelectorAll('[data-group-heading]')].find((td) =>
      td.textContent.startsWith(name)
    )
  const search = (text: string) =>
    userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), text)

  async function check() {
    await userEvent.click(screen.getByText('Olivia Chen'))
    await search('johnson')
    // (1) still rendered
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    // (2) the footer excludes it: 2 requests, $1,800 + $1,200, not $950 more
    expect(screen.getByText('2 requests')).toBeInTheDocument()
    expect(screen.getByText('$3,000')).toBeInTheDocument()
    expect(screen.queryByText('$3,950')).toBeNull()
    // (3) its group counts nothing
    expect(groupHeading('Chen')).toHaveTextContent('0 in group')
    expect(groupHeading('Johnson')).toHaveTextContent('2 in group')
    // (4) the CSV excludes it
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    const [content] = downloadSpy.mock.calls[0] as [string, string]
    expect(content).not.toContain('Olivia Chen')
    expect(content).toContain('Samuel Johnson')
  }

  it('is drawn but not counted (uncontrolled)', async () => {
    renderTable('/aid/requests', COUNTED)
    await check()
  })

  it('is drawn but not counted (controlled)', async () => {
    render(<Controlled agree extra={COUNTED} />)
    await check()
  })

  it('changes nothing when the highlighted row matches the search anyway', async () => {
    renderTable('/aid/requests', COUNTED)
    await userEvent.click(screen.getByText('Samuel Johnson'))
    await search('johnson')
    expect(screen.getByText('2 requests')).toBeInTheDocument()
    expect(groupHeading('Johnson')).toHaveTextContent('2 in group')
  })
})

describe('AidTable CSV columns (§11; M16)', () => {
  it('leaves an action column out of the file, and adds the columns only the file carries', async () => {
    const columns: Array<AidColumn<Row>> = [
      ...COLUMNS.slice(0, 2),
      { key: 'act', header: 'Act', width: 60, value: () => null, inCsv: false },
    ]
    render(
      <MemoryRouter initialEntries={['/aid/requests']}>
        <AidTable<Row>
          rows={ROWS.slice(0, 1)}
          columns={columns}
          rowKey={(r) => r.id}
          csvFilename="camperships-requests-all-2027.csv"
          csvExtra={[{ header: 'Household id', value: (r) => String(r.householdCmId) }]}
        />
      </MemoryRouter>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    const [content] = downloadSpy.mock.calls[0] as [string, string]
    expect(content.split('\n').slice(0, 2)).toEqual([
      'Family,Camper,Household id',
      'Johnson,Emma Johnson,1000001',
    ])
  })
})

describe('marked rows (Decision 3: a save that failed)', () => {
  const rowOf = (camper: string) => screen.getByText(camper).closest('tr')

  it('marks only the rows named, and the mark follows a changed set without new columns', () => {
    const table = (marked: ReadonlySet<string>) => (
      <MemoryRouter initialEntries={['/aid/requests']}>
        <AidTable<Row>
          rows={ROWS}
          columns={COLUMNS}
          rowKey={(r) => r.id}
          csvFilename="camperships-requests-all-2027.csv"
          markedKeys={marked}
        />
      </MemoryRouter>
    )
    const { rerender } = render(table(new Set(['r2'])))
    expect(rowOf('Liam Garcia')).toHaveAttribute('data-marked', 'true')
    expect(rowOf('Emma Johnson')).not.toHaveAttribute('data-marked')
    // Same COLUMNS object both times: the mark is read at row render, not built into the columns.
    rerender(table(new Set(['r1'])))
    expect(rowOf('Emma Johnson')).toHaveAttribute('data-marked', 'true')
    expect(rowOf('Liam Garcia')).not.toHaveAttribute('data-marked')
  })
})

let selections: Array<ReadonlySet<string>> = []
let matchings: Array<ReadonlySet<string>> = []

const MARKED_R1: ReadonlySet<string> = new Set(['r1'])

function Selectable({
  highlightedKey = null,
  withLabel = true,
  marked,
}: {
  highlightedKey?: string | null
  withLabel?: boolean
  marked?: ReadonlySet<string>
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [highlighted, setHighlighted] = useState<string | null>(highlightedKey)
  return (
    <MemoryRouter initialEntries={['/aid/requests']}>
      <AidTable<Row>
        rows={ROWS}
        columns={COLUMNS}
        rowKey={(r) => r.id}
        searchExtra={(r) => [r.householdCmId, r.personCmId]}
        csvFilename="camperships-requests-all-2027.csv"
        footerLabel={withLabel ? (rows) => `${String(rows.length)} requests` : undefined}
        markedKeys={marked}
        arrowKeys
        highlighted={highlighted}
        onHighlight={setHighlighted}
        onMatchingChange={(keys) => matchings.push(keys)}
        selected={selected}
        onSelectedChange={(next) => {
          selections.push(next)
          setSelected(next)
        }}
      />
    </MemoryRouter>
  )
}

describe('AidTable with a selection (§4.10)', () => {
  beforeEach(() => {
    selections = []
    matchings = []
  })

  it('leads with a checkbox; ticking one selects it without highlighting the row', async () => {
    render(<Selectable />)
    const row = screen.getByText('Olivia Chen').closest('tr') as HTMLElement
    const box = within(row).getByRole('checkbox', { name: 'Select' })
    await userEvent.click(box)
    expect(box).toBeChecked()
    expect([...(selections.at(-1) ?? [])]).toEqual(['r3'])
    expect(row).not.toHaveAttribute('data-highlighted')
  })

  it('selects every row the search matches with Select all, and clears them with it again', async () => {
    render(<Selectable />)
    await userEvent.type(screen.getByLabelText('Search'), 'johnson')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect([...(selections.at(-1) ?? [])].sort()).toEqual(['r1', 'r4'])
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(selections.at(-1)?.size).toBe(0)
  })

  it('leaves the row kept only by the highlight out of Select all, as it is out of the totals', async () => {
    render(<Selectable highlightedKey="r3" />)
    await userEvent.type(screen.getByLabelText('Search'), 'johnson')
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect([...(selections.at(-1) ?? [])].sort()).toEqual(['r1', 'r4'])
  })

  it('spans the footer label over the checkbox and the pinned columns (PR 2 I1)', () => {
    const { container } = render(<Selectable />)
    const label = container.querySelector('tfoot td') as HTMLElement
    expect(label).toHaveAttribute('colspan', '3')
    expect(label).toHaveStyle({ left: '0px' })
  })

  it('pins the identity columns after the checkbox column', () => {
    render(<Selectable />)
    const [, family, camper] = screen.getAllByRole('columnheader')
    expect(family).toHaveStyle({ left: '32px' })
    expect(camper).toHaveStyle({ left: '142px' })
  })

  it('moves the highlight edge to the checkbox cell', () => {
    render(<Selectable highlightedKey="r3" />)
    const cells = (screen.getByText('Olivia Chen').closest('tr') as HTMLElement).querySelectorAll(
      'td'
    )
    expect(cells[0]?.className).toContain('shadow-[inset_3px_0_0')
    expect(cells[1]?.className).not.toContain('shadow-[inset_3px_0_0')
  })
  // Owner ruling 2026-10-02 (Task 16 fix round): ticks persist across searches. This replaces the
  // three tests that pinned the earlier untick-on-search default (a spec change, not a fit).
  it('keeps the ticks a search hides: someone ticks a few families at a time, then ticks them all', async () => {
    render(<Selectable />)
    for (const name of ['Emma Johnson', 'Liam Garcia']) {
      const row = screen.getByText(name).closest('tr') as HTMLElement
      await userEvent.click(within(row).getByRole('checkbox', { name: 'Select' }))
    }
    const before = selections.length
    await userEvent.type(screen.getByLabelText('Search'), 'johnson')
    expect(selections.length).toBe(before)
    await userEvent.clear(screen.getByLabelText('Search'))
    expect(
      within(screen.getByText('Liam Garcia').closest('tr') as HTMLElement).getByRole('checkbox', {
        name: 'Select',
      })
    ).toBeChecked()
  })

  it('clears only the matching rows with the second Select all, and leaves a hidden tick alone', async () => {
    render(<Selectable />)
    const row = screen.getByText('Liam Garcia').closest('tr') as HTMLElement
    await userEvent.click(within(row).getByRole('checkbox', { name: 'Select' }))
    await userEvent.type(screen.getByLabelText('Search'), 'johnson')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect([...(selections.at(-1) ?? [])]).toEqual(['r2'])
  })

  it('tells the page which keys the search matches, again whenever they change', async () => {
    render(<Selectable highlightedKey="r3" />)
    expect([...(matchings.at(-1) ?? [])].sort()).toEqual(['r1', 'r2', 'r3', 'r4'])
    await userEvent.type(screen.getByLabelText('Search'), 'johnson')
    // The kept row (Olivia, shown only for the highlight) is not a match.
    expect([...(matchings.at(-1) ?? [])].sort()).toEqual(['r1', 'r4'])
  })

  it('gives the row kept only by the highlight no checkbox: it cannot be ticked (R1; review I3)', async () => {
    render(<Selectable highlightedKey="r3" />)
    await userEvent.type(screen.getByLabelText('Search'), 'johnson')
    const kept = screen.getByText('Olivia Chen').closest('tr') as HTMLElement
    expect(within(kept).queryByRole('checkbox')).toBeNull()
    const matching = screen.getByText('Emma Johnson').closest('tr') as HTMLElement
    expect(within(matching).getByRole('checkbox', { name: 'Select' })).toBeInTheDocument()
  })

  it('does not call onSelectedChange when a search drops nothing', async () => {
    render(<Selectable />)
    const row = screen.getByText('Emma Johnson').closest('tr') as HTMLElement
    await userEvent.click(within(row).getByRole('checkbox', { name: 'Select' }))
    const before = selections.length
    await userEvent.type(screen.getByLabelText('Search'), 'johnson')
    expect(selections.length).toBe(before)
  })

  it('spans only the checkbox column when there is no footer label (colspan 2, never 1)', () => {
    const { container } = render(<Selectable withLabel={false} />)
    expect(container.querySelector('tfoot td')).toHaveAttribute('colspan', '2')
  })

  it('sets no colspan on a footer without a selection', () => {
    const { container } = renderTable('/aid/requests', { footerLabel: undefined })
    expect(container.querySelector('tfoot td')).not.toHaveAttribute('colspan')
  })

  it('puts the amber edge of a marked row on its checkbox cell', () => {
    render(<Selectable marked={MARKED_R1} />)
    const cells = (screen.getByText('Emma Johnson').closest('tr') as HTMLElement).querySelectorAll(
      'td'
    )
    expect(cells[0]?.className).toContain('shadow-[inset_3px_0_0')
    expect(cells[1]?.className).not.toContain('shadow-[inset_3px_0_0')
  })

  it('does not highlight the row on a click in the checkbox cell beside the box', async () => {
    render(<Selectable />)
    const row = screen.getByText('Olivia Chen').closest('tr') as HTMLElement
    await userEvent.click(row.querySelectorAll('td')[0] as HTMLElement)
    expect(row).not.toHaveAttribute('data-highlighted')
  })
})
