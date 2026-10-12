import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

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
    expect(within(first).getByText('31 req · 23 fam')).toBeInTheDocument()
    expect(within(first).getByText('Overdue · 12 days')).toHaveAttribute(
      'title',
      "Past this line's 10-day threshold, so it moved to the top."
    )
    expect(within(first).getByRole('link', { name: /Garcia/ })).toHaveAttribute(
      'href',
      '/aid/households/1000002?year=2027'
    )
  })
  it('opens the top walkable line by default, with the five oldest and Start Queue Walk', () => {
    wrap(<TodayTodos lines={top} rest={rest} view={VIEW} empty="" />)
    const drawer = screen.getByTestId('todo-drawer')
    expect(within(drawer).getAllByTestId('drawer-household')).toHaveLength(2)
    expect(within(drawer).getByText('Liam · Session 2 · R1')).toBeInTheDocument()
    expect(within(drawer).getByRole('link', { name: 'Start Queue Walk' })).toHaveAttribute(
      'href',
      expect.stringContaining('/aid/households/1000002?from=needs-offer')
    )
    expect(within(drawer).getByText('31 in the queue')).toBeInTheDocument()
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
      screen.getByText('Commitment not yet in CampMinder 10 · Needs a camper 2')
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
    expect(screen.getByText('1 section')).toBeInTheDocument()
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
          label: 'Garcia',
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
    expect(within(rows[1]!).getByRole('link')).toHaveTextContent('Garcia household')
    const what = within(rows[0]!).getAllByRole('cell')[1]!
    expect(what.textContent.startsWith('·')).toBe(false)
  })
  it('puts the expand caret in the To-do cell, leaving the rank cell as the number alone', () => {
    wrap(<TodayTodos lines={top} rest={rest} view={VIEW} empty="" />)
    const cells = within(row(0)).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent(/^1$/)
    expect(cells[1]!.textContent.startsWith('▾')).toBe(true)
  })
})
