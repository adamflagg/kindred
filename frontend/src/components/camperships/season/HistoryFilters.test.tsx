import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { HistoryFilters } from './HistoryFilters'
import type { HistoryFilters as Filters } from './historyModel'

const NONE: Filters = {
  kind: null,
  actor: null,
  since: null,
  until: null,
  q: '',
  intake: false,
  page: 1,
}
const COUNTS = [
  { kind: 'rules' as const, operations: 15 },
  { kind: 'offers' as const, operations: 73 },
  { kind: 'money' as const, operations: 7 },
  { kind: 'holds' as const, operations: 4 },
  { kind: 'grants' as const, operations: 13 },
]

function renderFilters(over: Partial<Parameters<typeof HistoryFilters>[0]> = {}) {
  const onChange = vi.fn()
  render(
    <HistoryFilters
      filters={NONE}
      actors={['finance@example.com', 'system:intake']}
      kindCounts={COUNTS}
      total={112}
      canSeeRules
      counting={false}
      onChange={onChange}
      {...over}
    />
  )
  return onChange
}

describe('the History strip (spec §7.2 A)', () => {
  it('reads All 112, then each kind with its count, in the Requests strip', () => {
    renderFilters()
    const strip = screen.getByTestId('history-strip')
    expect(within(strip).getByRole('button', { name: /^All\s*112$/ })).toHaveClass('bg-primary')
    expect(within(strip).getByRole('button', { name: /^Rules\s*15$/ })).not.toHaveClass(
      'bg-primary'
    )
    expect(within(strip).getByRole('button', { name: /^Grants\s*13$/ })).toBeInTheDocument()
  })

  it('has no Rules chip without rules (D76)', () => {
    renderFilters({ canSeeRules: false, kindCounts: COUNTS.slice(1) })
    expect(screen.queryByRole('button', { name: /^Rules/ })).toBeNull()
  })

  it('says "—" for every count while the first read loads, and dims them while a filter re-reads', () => {
    renderFilters({ kindCounts: undefined, total: null })
    expect(screen.getByRole('button', { name: /^All\s*—$/ })).toBeInTheDocument()
    expect(screen.getAllByTestId('history-count')[0]).not.toHaveClass('opacity-35')
    // Two renders in one test: unmount the first, or getAll… would find its counts first.
    cleanup()
    renderFilters({ counting: true })
    const counts = screen.getAllByTestId('history-count')
    expect(counts).toHaveLength(6) // All + five kinds
    for (const count of counts) expect(count).toHaveClass('opacity-35')
  })

  it('picks one kind at a time; clicking it again, or All, clears it', async () => {
    const onChange = renderFilters({ filters: { ...NONE, kind: 'holds' } })
    await userEvent.click(screen.getByRole('button', { name: /^Holds/ }))
    expect(onChange).toHaveBeenLastCalledWith('kind', null)
    await userEvent.click(screen.getByRole('button', { name: /^Money edits/ }))
    expect(onChange).toHaveBeenLastCalledWith('kind', 'money')
  })
})

describe('the filter bar (spec §7.2 B)', () => {
  it('labels Person, From and Through at 14px, offers Anyone then each actor, system runs by name', () => {
    renderFilters()
    // The words sit in a bare <span>; the 14px role (CS_FLABEL) is on the <label> around it.
    expect(screen.getByText('Person').closest('label')).toHaveClass('text-sm')
    expect(screen.getByText('From').closest('span.inline-flex')).toHaveClass('text-sm')
    const person = screen.getByRole('combobox', { name: 'Person' })
    expect(
      within(person)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Anyone', 'finance@example.com', 'Intake'])
  })

  it('searches on Enter, never per keystroke, in the grid search shape with ⌕ at the left', async () => {
    const onChange = renderFilters()
    const search = screen.getByPlaceholderText('Reason, person or record id')
    expect(search).toHaveClass('pl-9')
    expect(search).toHaveAttribute('maxLength', '200')
    await userEvent.type(search, 'tier')
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.type(search, '{Enter}')
    expect(onChange).toHaveBeenCalledWith('q', 'tier')
  })

  it('has no Clear button', () => {
    renderFilters()
    expect(screen.queryByRole('button', { name: /Clear/ })).toBeNull()
  })
})
