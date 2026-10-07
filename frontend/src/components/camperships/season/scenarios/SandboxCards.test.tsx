import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SandboxEquityCard } from './SandboxEquityCard'
import { SandboxIncomeCard } from './SandboxIncomeCard'
import { SandboxTierCard } from './SandboxTierCard'
import { SANDBOX_DOC } from './sandboxFixtures'
import { bindingOf } from './sandboxModel'

function setup(
  over: { edits?: Record<string, string>; locked?: string[]; byRound?: number | null } = {}
) {
  const type = vi.fn<(key: string, raw: string) => void>()
  const release = vi.fn<() => void>()
  const binding = bindingOf({
    recorded: SANDBOX_DOC,
    source: SANDBOX_DOC,
    edits: new Map(Object.entries(over.edits ?? {})),
    locked: over.locked ?? [],
    byRound: over.byRound ?? null,
    canEdit: true,
    type,
    release,
  })
  return { binding, type, release }
}

const ROUND1 = ['income', 'tiers', 'equity', 'award_tables', 'awards']

describe('Tiers & Round 1 (§S5 F1)', () => {
  it('puts start, band width, tiers, the ceiling and the minimum on one line', () => {
    const { binding } = setup()
    render(
      <SandboxTierCard
        binding={binding}
        fitButton={<button type="button">Fit to Budget</button>}
        fitAnswer={null}
      />
    )
    expect(screen.getByRole('textbox', { name: 'Start' })).toHaveValue('0')
    expect(screen.getByRole('textbox', { name: 'Band width' })).toHaveValue('40000')
    expect(screen.getByRole('textbox', { name: 'Tiers' })).toHaveValue('3')
    expect(screen.getByRole('textbox', { name: 'Income ceiling' })).toHaveAttribute(
      'placeholder',
      'none'
    )
    expect(screen.getByRole('textbox', { name: 'Minimum award' })).toHaveValue('100')
    expect(screen.getByRole('button', { name: 'Fit to Budget' })).toBeInTheDocument()
  })

  it('reports typing live and releases on leaving the box or on Enter', async () => {
    const { binding, type, release } = setup()
    render(<SandboxTierCard binding={binding} fitButton={null} fitAnswer={null} />)
    const width = screen.getByRole('textbox', { name: 'Band width' })
    await userEvent.type(width, '5')
    expect(type).toHaveBeenLastCalledWith('tiers.width', '400005')
    expect(release).not.toHaveBeenCalled()
    await userEvent.keyboard('{Enter}')
    expect(release).toHaveBeenCalledOnce()
  })

  it('edits only a table’s own cells; an inheriting table reads its values, muted', () => {
    const { binding } = setup()
    render(<SandboxTierCard binding={binding} fitButton={null} fitAnswer={null} />)
    const grid = screen.getByTestId('sandbox-grid')
    expect(within(grid).getByRole('textbox', { name: 'Round 1 % · General · tier 2' })).toHaveValue(
      '60'
    )
    expect(within(grid).queryByRole('textbox', { name: 'Round 1 % · Teen · tier 3' })).toBeNull()
    expect(within(grid).getAllByText('25%')[0]).toHaveAttribute('data-inherited')
  })

  it('marks a bad figure red, says to fix it first, and shows "was" for a change', () => {
    const { binding } = setup({ edits: { 'tiers.width': '0', 'awards.minimum': '125' } })
    render(<SandboxTierCard binding={binding} fitButton={null} fitAnswer={null} />)
    expect(screen.getByText('Fix first: Band width (above 0)')).toBeInTheDocument()
    expect(screen.getByText('was $100')).toBeInTheDocument()
  })

  it('shows a fractional "was" in whole dollars (coordinator ruling 2026-10-07)', () => {
    const { type, release } = setup()
    const binding = bindingOf({
      recorded: SANDBOX_DOC,
      source: { ...SANDBOX_DOC, awards: { ...SANDBOX_DOC.awards, minimum: '125.50' } },
      edits: new Map(),
      locked: [],
      byRound: null,
      canEdit: true,
      type,
      release,
    })
    render(<SandboxTierCard binding={binding} fitButton={null} fitAnswer={null} />)
    expect(screen.getByText('was $126')).toBeInTheDocument()
  })

  it('greys after Round 1 posts, says so once, and keeps the cap open', () => {
    const { binding } = setup({ locked: ROUND1, byRound: 1 })
    render(<SandboxTierCard binding={binding} fitButton={null} fitAnswer={null} />)
    expect(
      screen.getByText('Locked: Round 1 is posted · the Round 1 + 2 cap stays open')
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Band width' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Round 1 % · General · tier 1' })).toBeDisabled()
    expect(
      screen.getByRole('textbox', { name: 'Round 1 + 2 cap · General · tier 1' })
    ).toBeEnabled()
  })
})

describe('Equity (§S5 F2)', () => {
  it('checks a criterion and releases at once; an unchecked one greys and keeps its weights', async () => {
    const { binding, type, release } = setup()
    render(<SandboxEquityCard binding={binding} />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Unemployment enabled' }))
    expect(type).toHaveBeenCalledWith('equity.criteria.0.enabled', 'false')
    expect(release).toHaveBeenCalledOnce()
    const row = screen.getByText('Single parent').closest('tr')
    expect(row).not.toHaveAttribute('data-enabled')
    expect(
      within(row as HTMLElement).getByRole('textbox', { name: 'Weight · General · Single parent' })
    ).toHaveValue('1')
  })
})

describe('Income counting (§S5 F3)', () => {
  it('derives the current-year weight live and says when the per-dependent figure is not used', () => {
    const { binding } = setup({
      edits: { 'income.weights.prior_year': '70', 'income.dependents_mode': 'tier_shift' },
    })
    render(<SandboxIncomeCard binding={binding} />)
    expect(screen.getByText('30%')).toBeInTheDocument()
    expect(screen.getByText('not used now')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Dependents' })).toHaveValue('tier_shift')
  })

  it('releases a Dependents choice at once', async () => {
    const { binding, type, release } = setup()
    render(<SandboxIncomeCard binding={binding} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Dependents' }), 'none')
    expect(type).toHaveBeenCalledWith('income.dependents_mode', 'none')
    expect(release).toHaveBeenCalledOnce()
  })
})
