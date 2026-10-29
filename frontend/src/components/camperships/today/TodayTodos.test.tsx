import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { CELL_BG, DETAIL_ROW, HIGHLIGHT_EDGE, ROW_HIGHLIGHT, TD } from '../kit/kitStyles'
import { line, REGISTRAR_TODAY } from './todayFixtures'
import { rankLines, REGISTRAR_ORDER } from './todayModel'
import { TodayTodos } from './TodayTodos'

const VIEW = { year: 2027, asOf: { kind: 'live' } } as const
const { top, rest } = rankLines(REGISTRAR_TODAY.casework ?? [], REGISTRAR_ORDER)
const row = (i: number): HTMLElement => {
  const r = screen.getAllByTestId('todo-row')[i]
  if (!r) throw new Error(`no row ${String(i)}`)
  return r
}
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('TodayTodos', () => {
  it('ranks, counts, chips and marks overdue', () => {
    wrap(<TodayTodos lines={top} rest={rest} view={VIEW} empty="" />)
    const rows = screen.getAllByTestId('todo-row')
    const first = row(0)
    expect(rows.map((r) => within(r).getByTestId('todo-label').textContent)).toEqual([
      'Needs an offer',
      'Waiting on the family',
      'Grants needing attention',
      'Holds',
      'Not reconciled',
    ])
    // Audit R4 (spec §5): bold figures, muted units, no "·".
    const count = within(first).getAllByRole('cell')[2]!
    expect(count).toHaveTextContent(/^31 req 23 fam$/)
    expect([...count.querySelectorAll('b')].map((b) => b.textContent)).toEqual(['31', '23'])
    expect(within(first).getByText('Overdue · 12 days')).toHaveAttribute(
      'title',
      "Past this line's 10-day threshold, so it moved to the top."
    )
    expect(within(first).getByRole('link', { name: /Liam Garcia/ })).toHaveAttribute(
      'href',
      '/aid/households/1000002?year=2027'
    )
  })
  it('opens the top walkable line by default, with the five oldest and Start Queue Walk', () => {
    wrap(<TodayTodos lines={top} rest={rest} view={VIEW} empty="" />)
    const drawer = screen.getByTestId('todo-drawer')
    expect(within(drawer).getAllByTestId('drawer-household')).toHaveLength(2)
    // Ruling 18: the link is the camper's full name, as the grid names it, so the what drops the first name.
    const first = within(drawer).getAllByTestId('drawer-household')[0]!
    expect(within(first).getByRole('link')).toHaveTextContent(/^Liam Garcia$/)
    expect(within(first).getByRole('link')).toHaveAttribute('title', "Open Liam Garcia's household")
    expect(within(drawer).getByText('Session 2 · R1')).toBeInTheDocument()
    expect(within(drawer).getByRole('link', { name: 'Start Queue Walk' })).toHaveAttribute(
      'href',
      expect.stringContaining('/aid/households/1000002?from=needs-offer')
    )
    // Audit R9 (spec §5.6): the queue walks oldest first, and says so.
    expect(within(drawer).getByText('oldest first · 31 in the queue')).toBeInTheDocument()
    expect(within(drawer).getByRole('link', { name: 'Start Queue Walk' })).toHaveAttribute(
      'title',
      'Walk this queue one household at a time, oldest first'
    )
  })
  it('toggles another walkable line open on a row click, but not on a link click', () => {
    wrap(<TodayTodos lines={top} rest={rest} view={VIEW} empty="" />)
    const waiting = row(1)
    fireEvent.click(within(waiting).getByRole('link', { name: 'Open ›' }))
    expect(screen.getAllByTestId('todo-drawer')).toHaveLength(1)
    fireEvent.click(waiting)
    expect(screen.getAllByTestId('todo-drawer')).toHaveLength(2)
  })
  it('folds the rest under Everything else with its meta', () => {
    wrap(<TodayTodos lines={top} rest={rest} view={VIEW} empty="" />)
    expect(screen.getByText('Everything else')).toBeInTheDocument()
    expect(screen.getByText('4 more waiting · 1 at zero')).toBeInTheDocument()
  })
  it('Concerns: no rank, no drawer, no Start Queue Walk', () => {
    wrap(
      <TodayTodos
        lines={[line('intake', 3)]}
        rest={[]}
        view={VIEW}
        ranked={false}
        nextHead="Why"
        empty=""
      />
    )
    expect(screen.queryByTestId('todo-drawer')).toBeNull()
    expect(screen.queryByText('Start Queue Walk')).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Concern' })).toBeInTheDocument()
  })
  it('says nothing is waiting when the list is empty', () => {
    wrap(<TodayTodos lines={[]} rest={[]} view={VIEW} empty="Every casework queue is empty." />)
    expect(screen.getByText('Nothing is waiting on you.').parentElement).toHaveTextContent(
      'Nothing is waiting on you. Every casework queue is empty.'
    )
  })
  it('development lines chip their names and open Funders', () => {
    wrap(
      <TodayTodos
        lines={[
          line('no_contact', 1, {
            item_kind: 'funders',
            families: null,
            names: ['Riverbend Community Foundation'],
          }),
        ]}
        rest={[]}
        view={VIEW}
        nextHead="Which"
        empty=""
      />
    )
    expect(screen.getByRole('link', { name: 'Riverbend Community Foundation' })).toHaveAttribute(
      'href',
      expect.stringContaining('/aid/money/funders')
    )
  })
  it("shows a reason that carries no count as its words alone (finance's synthetic Over budget line)", () => {
    const over = line('intake', 1, {
      key: 'over_budget' as never,
      item_kind: 'lines',
      reasons: [{ code: 'tbm', label: 'TBM $1,300 over', families: null, items: 0 }],
    })
    wrap(<TodayTodos lines={[over]} rest={[]} view={VIEW} ranked={false} nextHead="Why" empty="" />)
    expect(screen.getByText('Over budget')).toBeInTheDocument()
    expect(screen.getByText('TBM $1,300 over')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Open/ })).toBeNull()
  })
  it("a to-do row's reasons wrap in Next up rather than cut (owner 2a: readable without a hover)", () => {
    const sources = line('sources', 4, {
      item_kind: 'descriptions',
      families: null,
      reasons: [
        { code: 'no_grantor', families: null, items: 2 },
        { code: 'needs_group', families: null, items: 1 },
        { code: 'unclassified', families: null, items: 1 },
      ],
    })
    wrap(<TodayTodos lines={[sources]} rest={[]} view={VIEW} empty="" />)
    const why = within(row(0)).getAllByRole('cell')[3]!.firstElementChild as HTMLElement
    expect(why.className).toContain('whitespace-normal')
    expect(why.className).not.toMatch(/truncate|text-ellipsis/)
    expect(why).toHaveAttribute('title')
  })
  it('draws no empty card when it has no words for one (the registrar fold)', () => {
    wrap(
      <TodayTodos lines={[]} rest={top} view={VIEW} empty="" restTitle="The registrar's queue" />
    )
    expect(screen.queryByText('Nothing is waiting on you.')).toBeNull()
    expect(screen.getByText("The registrar's queue")).toBeInTheDocument()
  })
  it('words every reason code, with no count on a named item', () => {
    wrap(
      <TodayTodos
        lines={[
          line('grants', 13, {
            item_kind: 'grants',
            reasons: [
              { code: 'not_posted', families: null, items: 10 },
              { code: 'needs_camper', families: null, items: 2 },
            ],
          }),
          line('rules_sections', 1, {
            item_kind: 'sections',
            reasons: [{ code: 'award_tables', families: null, items: 1 }],
          }),
          line('intake', 1, {
            reasons: [{ code: 'awaiting_approved_rules', families: null, items: 1 }],
          }),
        ]}
        rest={[]}
        view={VIEW}
        ranked={false}
        nextHead="Why"
        empty=""
      />
    )
    expect(
      // Audit R13: one sentence, capitalised once.
      screen.getByText('Not yet in CM 10 · needs a camper 2') // audit N13: the mock's words
    ).toBeInTheDocument()
    expect(screen.getByText('Round 1 award table')).toBeInTheDocument()
    expect(screen.getByText('Awaiting rules 1')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/[a-z]+_[a-z]+/)
  })
  it('shows a count of one in the singular', () => {
    wrap(
      <TodayTodos
        lines={[line('rules_sections', 1, { item_kind: 'sections' })]}
        rest={[]}
        view={VIEW}
        ranked={false}
        empty=""
      />
    )
    expect(within(row(0)).getAllByRole('cell')[2]).toHaveTextContent(/^1 section$/)
  })
  it('drawer: household-level rows join only the parts they have, and name the household once', () => {
    const l = line('needs_offer', 2, {
      next_up: [
        {
          household_cm_id: 9100124,
          label: 'Household 9100124',
          tiebreak: '',
          days: 3,
          camper_name: '',
          session_name: 'Family Camp 1',
          session_type: 'family',
          round: 1,
          ask: 500,
        },
        {
          household_cm_id: 1000002,
          label: 'Liam Garcia',
          tiebreak: '',
          days: 2,
          camper_name: 'Liam Garcia',
          session_name: 'Session 2',
          session_type: 'main',
          round: 1,
          ask: 900,
        },
      ],
    })
    wrap(<TodayTodos lines={[l]} rest={[]} view={VIEW} empty="" />)
    const drawer = screen.getByTestId('todo-drawer')
    const rows = within(drawer).getAllByTestId('drawer-household')
    expect(rows[0]).not.toHaveTextContent('· ·')
    expect(rows[0]!.textContent.startsWith('Household 9100124')).toBe(true)
    expect(within(rows[0]!).getByRole('link')).toHaveTextContent(/^Household 9100124$/)
    expect(within(rows[1]!).getByRole('link')).toHaveTextContent(/^Liam Garcia$/)
    const what = within(rows[0]!).getAllByRole('cell')[3]!
    expect(what.textContent.startsWith('·')).toBe(false)
  })
  it("names a drawer's session with the kit's central short form (owner 3b): a TBM cohort reads BM2 EB", () => {
    const l = line('needs_offer', 1, {
      next_up: [
        {
          household_cm_id: 1000002,
          label: 'Liam Garcia',
          tiebreak: '',
          days: 2,
          camper_name: 'Liam Garcia',
          session_name: 'B*Mitzvah Program Year 2 - East Bay',
          session_type: 'bmitzvah',
          round: 1,
          ask: 900,
        },
      ],
    })
    wrap(<TodayTodos lines={[l]} rest={[]} view={VIEW} empty="" />)
    const r = within(screen.getByTestId('todo-drawer')).getByTestId('drawer-household')
    const what = within(r).getAllByRole('cell')[3]!
    expect(what).toHaveTextContent(/^BM2 EB · R1$/)
    expect(what).toHaveAttribute(
      'title',
      expect.stringContaining('B*Mitzvah Program Year 2 - East Bay')
    )
  })
  it('puts the expand caret in the To-do cell, leaving the rank cell as the number alone', () => {
    wrap(<TodayTodos lines={top} rest={rest} view={VIEW} empty="" />)
    const cells = within(row(0)).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent(/^1$/)
    expect(cells[1]!.textContent.startsWith('▾')).toBe(true)
  })
  it("reads each line's overdue threshold from the server, for the chip's day colour and the pill's title", () => {
    const tight = line('needs_offer', 2, {
      oldest_days: 8,
      overdue: true,
      overdue_after_days: 7,
      next_up: [
        {
          household_cm_id: 1000002,
          label: 'Garcia',
          tiebreak: '',
          days: 8,
          camper_name: 'Liam Garcia',
          session_name: 'Session 2',
          session_type: 'main',
          round: 1,
          ask: 1850,
        },
      ],
    })
    wrap(<TodayTodos lines={[tight]} rest={[]} view={VIEW} empty="" />)
    const first = row(0)
    expect(within(first).getByText('Overdue · 8 days')).toHaveAttribute(
      'title',
      "Past this line's 7-day threshold, so it moved to the top."
    )
    expect(within(first).getAllByText('8d')[0]?.className).toMatch(/amber/)
  })

  it('the opened row carries the amber edge; its drawer is rows of the same grid, white kit cells in its columns (ruling 19)', () => {
    // Owner ruling 19 reverses V1: the pop-out is a grid, styled as the development grid (white TD cells with the
    // column rules), and its columns are the to-do table's own, so every boundary lines up with the table above.
    wrap(<TodayTodos lines={top} rest={rest} view={VIEW} empty="" />)
    expect(within(row(0)).getAllByRole('cell')[0]!.className).toContain(HIGHLIGHT_EDGE)
    const drawer = screen.getByTestId('todo-drawer')
    expect(drawer.closest('table')).toBe(row(0).closest('table'))
    expect(drawer.querySelector('table')).toBeNull()
    const households = within(drawer).getAllByTestId('drawer-household')
    for (const r of households) {
      const cells = within(r).getAllByRole('cell')
      expect(cells).toHaveLength(6)
      for (const c of cells) {
        expect(c.className).toContain(TD)
        expect(c.className).toContain(CELL_BG)
        expect(c.className).not.toContain(DETAIL_ROW)
        expect(c.className).not.toContain(ROW_HIGHLIGHT)
        expect(c.className).not.toMatch(/dashed/)
      }
    }
    // Name under To-do, the ask under Count, the session and round under Next up, the days under the overdue pill.
    const cells = within(households[0]!).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent(/^$/)
    expect(within(cells[1]!).getByRole('link')).toHaveTextContent(/^Liam Garcia$/)
    expect(cells[2]).toHaveTextContent(/^\$\d[\d,]* ask$/)
    expect(cells[3]).toHaveTextContent(/^Session 2 · R1$/)
    expect(cells[4]).toHaveTextContent(/^\d+ days$/)
    expect(cells[5]).toHaveTextContent(/^$/)
    // A name is never cut (owner 10-10), nor the session words: a long one wraps in its column.
    expect(cells[1]!.className).not.toContain('whitespace-nowrap')
    expect(cells[3]!.className).not.toContain('whitespace-nowrap')
    // The walk row: Start Queue Walk from the To-do column, Open › in the Open column.
    const walk = within(drawer).getByRole('link', { name: 'Start Queue Walk' }).closest('tr')!
    const walkCells = within(walk).getAllByRole('cell')
    expect(walkCells.map((c) => (c as HTMLTableCellElement).colSpan)).toEqual([1, 4, 1])
    expect(within(walkCells[2]!).getByRole('link')).toHaveTextContent('Open ›')
    for (const c of walkCells) expect(c.className).toContain(CELL_BG)
  })
  it("Everything else is the same grid: the to-do table's columns, white kit cells (ruling 19)", () => {
    const { container } = wrap(<TodayTodos lines={top} rest={rest} view={VIEW} empty="" />)
    fireEvent.click(screen.getByRole('button', { name: /Everything else/ }))
    const tables = container.querySelectorAll('table')
    const widths = (t: Element) =>
      [...t.querySelectorAll(':scope > colgroup > col')].map((c) => (c as HTMLElement).style.width)
    expect(widths(tables[1]!)).toEqual(widths(tables[0]!))
    const head = [...tables[1]!.querySelectorAll('thead th')] as HTMLTableCellElement[]
    expect(head.map((th) => [th.textContent, th.colSpan])).toEqual([
      ['', 1],
      ['Queue', 1],
      ['Count', 1],
      ['Why', 2],
      ['', 1],
    ])
    const first = tables[1]!.querySelector('tbody tr')!
    const cells = [...first.querySelectorAll('td')]
    expect(cells[0]).toHaveTextContent(/^$/)
    for (const c of cells) {
      expect(c.className).toContain(TD)
      expect(c.className).toContain(CELL_BG)
    }
  })
  it('Everything else says "none" at zero and offers no Open › (audit R16)', () => {
    wrap(<TodayTodos lines={[]} rest={[line('duplicates', 0)]} view={VIEW} empty="" />)
    fireEvent.click(screen.getByRole('button', { name: /Everything else/ }))
    const zero = screen.getByText('Duplicates').closest('tr')!
    // Ruling 19: the fold keeps the grid's empty rank column, so Count is the third cell.
    expect(within(zero).getAllByRole('cell')[2]).toHaveTextContent(/^none$/)
    expect(within(zero).queryByRole('link')).toBeNull()
  })
  it("Everything else shows To place's money in Why (audit R17)", () => {
    const toPlace = line('to_place', 3, { item_kind: 'lines', families: 2, amount: 2150 })
    wrap(<TodayTodos lines={[]} rest={[toPlace]} view={VIEW} empty="" />)
    fireEvent.click(screen.getByRole('button', { name: /Everything else/ }))
    const r = screen.getByText('To place').closest('tr')!
    expect(r).toHaveTextContent('$2,150')
  })
  it('chips on a line without a drawer still show the days the server sends (audit R11)', () => {
    const holds = line('holds', 1, {
      next_up: [
        {
          household_cm_id: 1000005,
          label: 'Moreau',
          tiebreak: '',
          days: 6,
          camper_name: '',
          session_name: '',
          session_type: '',
          round: null,
          ask: null,
        },
      ],
    })
    wrap(<TodayTodos lines={[holds]} rest={[]} view={VIEW} empty="" />)
    expect(screen.getByRole('link', { name: /Moreau/ })).toHaveTextContent('Moreau6d')
  })
  it("restores the mock's column widths, now that a chip is a short name (ruling 18)", () => {
    const { container } = wrap(<TodayTodos lines={top} rest={rest} view={VIEW} empty="" />)
    const widths = [
      ...container.querySelectorAll('table')[0]!.querySelectorAll(':scope > colgroup > col'),
    ].map((c) => (c as HTMLElement).style.width)
    expect(widths).toEqual(['34px', '230px', '130px', '', '150px', '64px'])
  })
  it("development: the mock's 230 / 130, and no status column, since its lines are never overdue (ruling 19)", () => {
    const dev = [
      line('needs_group', 1, {
        item_kind: 'descriptions',
        families: null,
        names: ['Harbor Family Services emergency fund 2027'],
      }),
    ]
    const { container } = wrap(
      <TodayTodos
        lines={dev}
        rest={[
          line('no_eligibility', 1, {
            item_kind: 'funders',
            families: null,
            names: ['Lakeside Partners'],
          }),
        ]}
        view={VIEW}
        nextHead="Which"
        statusColumn={false}
        empty=""
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Everything else/ }))
    const tables = container.querySelectorAll('table')
    const widths = (t: Element) =>
      [...t.querySelectorAll(':scope > colgroup > col')].map((c) => (c as HTMLElement).style.width)
    expect(widths(tables[0]!)).toEqual(['34px', '230px', '130px', '', '64px'])
    expect(widths(tables[1]!)).toEqual(widths(tables[0]!))
    expect(within(row(0)).getAllByRole('cell')).toHaveLength(5)
    const why = [...tables[1]!.querySelectorAll('thead th')].find((th) => th.textContent === 'Why')!
    expect((why as HTMLTableCellElement).colSpan).toBe(1)
  })
  it("each chip's title says what its days count, per line (audit N6)", () => {
    const chip = (key: Parameters<typeof line>[0], camper: string) =>
      line(key, 1, {
        next_up: [
          {
            household_cm_id: 1000009,
            label: camper || 'Ada & Ben Moreau',
            tiebreak: '',
            days: 6,
            camper_name: camper,
            session_name: '',
            session_type: '',
            round: null,
            ask: null,
          },
        ],
      })
    const lines = [
      chip('needs_offer', 'Ivy Moreau'),
      chip('waiting_on_family', 'Ivy Moreau'),
      chip('holds', ''),
      chip('not_reconciled', 'Ivy Moreau'),
      chip('grants', ''),
    ]
    wrap(<TodayTodos lines={lines} rest={[]} view={VIEW} empty="" ranked={false} />)
    const titles = screen
      .getAllByTestId('todo-row')
      .map((r) => within(r).getAllByRole('link')[0]!.getAttribute('title'))
    expect(titles).toEqual([
      "Open Ivy Moreau's household · asked 6 days ago",
      "Open Ivy Moreau's household · offer posted 6 days ago",
      'Open the Ada & Ben Moreau household · on hold 6 days',
      "Open Ivy Moreau's household · posted 6 days ago",
      'Open the Ada & Ben Moreau household · 6 days old',
    ])
  })
  it('the Concerns table keeps an empty rank column, so its columns line up with the table above (audit F10)', () => {
    wrap(
      <TodayTodos
        lines={[line('intake', 3)]}
        rest={[]}
        view={VIEW}
        ranked={false}
        nextHead="Why"
        empty=""
      />
    )
    expect(screen.getAllByRole('columnheader')).toHaveLength(6)
    expect(within(row(0)).getAllByRole('cell')[0]).toHaveTextContent(/^$/)
  })
  it('development chips open their own Funders row, and quote a description (audit D8, X5)', () => {
    wrap(
      <TodayTodos
        lines={[
          line('no_contact', 1, {
            item_kind: 'funders',
            families: null,
            names: ['Riverbend Community Foundation'],
            links: ['funder:riverbend'],
          }),
          line('no_grantor', 1, {
            item_kind: 'descriptions',
            families: null,
            names: ['Outside Award – Spring'],
            links: ['row:src1'],
          }),
        ]}
        rest={[]}
        view={VIEW}
        nextHead="Which"
        empty=""
      />
    )
    expect(screen.getByRole('link', { name: 'Riverbend Community Foundation' })).toHaveAttribute(
      'href',
      '/aid/money/funders?funder=riverbend&year=2027'
    )
    expect(screen.getByRole('link', { name: '"Outside Award – Spring"' })).toHaveAttribute(
      'href',
      '/aid/money/funders?row=src1&year=2027'
    )
  })

  it('draws the Form intake line, counted in people (owner Q4, 10-29), opening Requests › Form intake (PR 3)', () => {
    const intake = line('form_intake', 5, {
      item_kind: 'campers',
      families: 4,
      next_up: [{ household_cm_id: 1000001, label: 'Emma Johnson', camper_name: 'Emma Johnson' }],
    })
    wrap(<TodayTodos lines={[intake]} rest={[]} view={VIEW} empty="" />)
    const r = row(0)
    expect(within(r).getByTestId('todo-label')).toHaveTextContent('Form intake: needs a look')
    expect(within(r).getAllByRole('cell')[2]).toHaveTextContent(/^5 people$/)
    expect(within(r).getByRole('link', { name: 'Open ›' })).toHaveAttribute(
      'href',
      '/aid/requests/intake?year=2027'
    )
  })
})
