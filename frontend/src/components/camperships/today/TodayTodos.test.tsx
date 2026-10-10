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
})
