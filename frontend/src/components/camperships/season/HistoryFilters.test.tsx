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
      onClear={vi.fn()}
      {...over}
    />
  )
  return onChange
}

describe('the History toolbar (history-1)', () => {
  it('is ONE kit toolbar row: a segmented switcher with counts inside, no strip, no dots', () => {
    renderFilters()
    const bar = screen.getByTestId('aid-toolbar')
    expect(screen.queryByTestId('history-strip')).toBeNull()
    const seg = within(bar).getByRole('group', { name: 'Kind' })
    expect(within(seg).getByRole('button', { name: /^All\s*112$/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(within(seg).getByRole('button', { name: /^Rules\s*15$/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(within(seg).getByRole('button', { name: /^Grants\s*13$/ })).toBeInTheDocument()
    expect(seg.querySelector('.rounded-full')).toBeNull()
  })

  it('has no Rules choice without rules (D76)', () => {
    renderFilters({ canSeeRules: false, kindCounts: COUNTS.slice(1) })
    expect(screen.queryByRole('button', { name: /^Rules/ })).toBeNull()
  })

  it('says "—" for every count while the first read loads, and dims the switcher while a filter re-reads', () => {
    renderFilters({ kindCounts: undefined, total: null })
    expect(screen.getByRole('button', { name: /^All\s*—$/ })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Kind' })).not.toHaveClass('opacity-60')
    cleanup()
    renderFilters({ counting: true })
    expect(screen.getByRole('group', { name: 'Kind' })).toHaveClass('opacity-60')
  })

  it('picks one kind at a time; clicking it again, or All, clears it', async () => {
    const onChange = renderFilters({ filters: { ...NONE, kind: 'holds' } })
    await userEvent.click(screen.getByRole('button', { name: /^On hold/ }))
    expect(onChange).toHaveBeenLastCalledWith('kind', null)
    await userEvent.click(screen.getByRole('button', { name: /^Money edits/ }))
    expect(onChange).toHaveBeenLastCalledWith('kind', 'money')
    await userEvent.click(screen.getByRole('button', { name: /^All/ }))
    expect(onChange).toHaveBeenLastCalledWith('kind', null)
  })

  it('labels Who and Dates, offers Anyone then each actor, system runs by name', async () => {
    renderFilters()
    expect(screen.getByText('Who').closest('label')).toHaveClass('text-[12.5px]')
    expect(screen.getByText('Dates').closest('span.inline-flex')).toHaveClass('text-[12.5px]')
    await userEvent.click(screen.getByRole('button', { name: 'Who: Anyone' }))
    expect(screen.getAllByRole('option').map((o) => o.textContent.replace(/^✓/, ''))).toEqual([
      'Anyone',
      'finance@example.com',
      'Intake',
    ])
  })

  it('reads "Any date" when empty, and a short range when set', () => {
    renderFilters()
    expect(screen.getByRole('button', { name: 'Dates: Any date' })).toBeInTheDocument()
    cleanup()
    renderFilters({ filters: { ...NONE, since: '2027-06-01' } })
    expect(screen.getByRole('button', { name: 'Dates: Jun 1 – today' })).toBeInTheDocument()
    cleanup()
    renderFilters({ filters: { ...NONE, until: '2027-07-04' } })
    expect(screen.getByRole('button', { name: 'Dates: Start – Jul 4' })).toBeInTheDocument()
  })

  it('keeps From and Through in the Dates popover, and Any date clears both in one call', async () => {
    const onClear = vi.fn()
    renderFilters({ filters: { ...NONE, since: '2027-06-01' }, onClear })
    expect(screen.queryByLabelText('From')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Dates:/ }))
    expect(screen.getByLabelText('From')).toHaveValue('2027-06-01')
    expect(screen.getByLabelText('Through')).toHaveValue('')
    await userEvent.click(screen.getByRole('button', { name: 'Any date' }))
    expect(onClear).toHaveBeenCalledWith(['since', 'until'])
  })

  it('shows the intake runs check in ink with its title, and writes it', async () => {
    const onChange = renderFilters()
    const check = screen.getByRole('checkbox', { name: 'Intake runs' })
    expect(check.closest('label')).toHaveAttribute(
      'title',
      'Show the nightly intake runs from CampMinder (hidden by default)'
    )
    expect(check.closest('label')).toHaveClass('text-foreground')
    await userEvent.click(check)
    expect(onChange).toHaveBeenLastCalledWith('intake', '1')
  })

  it('searches on Enter, never per keystroke, in a 220px kit search with the SVG icon', async () => {
    const onChange = renderFilters()
    const search = screen.getByPlaceholderText('Reason, person or record id')
    expect(search).toHaveClass('h-[26px]', 'pl-[26px]')
    expect(search).toHaveAttribute('maxLength', '200')
    expect(search.closest('form')).toHaveStyle({ width: '220px' })
    expect(search.closest('form')?.querySelector('svg')).not.toBeNull()
    expect(screen.queryByText('⌕')).toBeNull()
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
