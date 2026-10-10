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

describe('the three cards’ titles (V F7)', () => {
  it('keeps each title in the card face: 13.5px sans, whatever the bare h3 rule says (as the Rules tab’s cards)', () => {
    const { binding } = setup()
    render(
      <>
        <SandboxTierCard binding={binding} fitButton={null} fitAnswer={null} />
        <SandboxEquityCard binding={binding} />
        <SandboxIncomeCard binding={binding} />
      </>
    )
    // fonts.css styles h3 outside any layer (Fraunces, 30px), so only an important class beats it (#2954).
    for (const name of ['Tiers & Round 1', 'Equity', 'Income counting']) {
      expect(screen.getByRole('heading', { name })).toHaveClass(
        '!font-sans',
        '!text-[13.5px]',
        '!leading-normal',
        '!tracking-[inherit]'
      )
    }
  })
})

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
    // The white picker (§3), never a native select; it reads the mode in the rules' words.
    expect(document.querySelector('select')).toBeNull()
    expect(screen.getByRole('button', { name: /^Dependents:/ })).toHaveTextContent(/move the tier/i)
  })

  it('releases a Dependents choice at once', async () => {
    const { binding, type, release } = setup()
    render(<SandboxIncomeCard binding={binding} />)
    await userEvent.click(screen.getByRole('button', { name: /^Dependents:/ }))
    await userEvent.click(screen.getAllByRole('option').at(-1) as HTMLElement)
    expect(type).toHaveBeenCalledWith('income.dependents_mode', 'none')
    expect(release).toHaveBeenCalledOnce()
  })
})

// #3109 moved every CS_FLABEL to 12.5px muted (a toolbar label, design-language §1). The Sandbox cards are card forms:
// their labels keep the 14px foreground they had before the kit.
describe('the Sandbox cards’ labels keep their pre-kit look (kit fallout, #3109)', () => {
  it('sets income and tier labels at 14px foreground, not the toolbar label', () => {
    const { binding } = setup()
    const { container } = render(
      <>
        <SandboxTierCard binding={binding} fitButton={null} fitAnswer={null} />
        <SandboxIncomeCard binding={binding} />
      </>
    )
    const labels = [...container.querySelectorAll('label')]
    expect(labels.length).toBeGreaterThan(3)
    for (const label of labels) {
      expect(label).toHaveClass('text-sm')
      expect(label).not.toHaveClass('text-[12.5px]')
    }
  })
})

describe('the Sandbox grids follow the rules’ pool order (final mock: "pool order is the rules’ order")', () => {
  // Pool B (teen) listed before Pool A (general): the columns follow the pools, not the tables' own order.
  const POOLED = {
    ...SANDBOX_DOC,
    programs: {
      summer: { budget_pool: 'pool_a', equity_class: 'general', session_types: ['main'] },
      weekend: { budget_pool: 'pool_b', equity_class: 'teen', session_types: ['main'] },
    },
    budget: {
      total: '1000000',
      pools: {
        pool_b: { label: 'Pool B', share_pct: '10' },
        pool_a: { label: 'Pool A', share_pct: '90' },
      },
    },
  } as typeof SANDBOX_DOC
  const bound = () =>
    bindingOf({
      recorded: POOLED,
      source: POOLED,
      edits: new Map(),
      locked: [],
      byRound: null,
      canEdit: true,
      type: vi.fn(),
      release: vi.fn(),
    })
  const order = (root: HTMLElement) =>
    within(root)
      .getAllByRole('columnheader')
      .map((th) => th.textContent)
      .filter((text) => /General|Teen/.test(text))
      .map((text) => (text.includes('Teen') ? 'Teen' : 'General'))

  it('orders the tier grid’s columns by pool', () => {
    render(<SandboxTierCard binding={bound()} fitButton={null} fitAnswer={null} />)
    // the heads are the pools' names, as Rules' grid words them (not the classes' own keys)
    const heads = within(screen.getByTestId('sandbox-grid'))
      .getAllByRole('columnheader')
      .map((th) => th.textContent)
      .filter((text) => /Pool [AB]/.test(text))
      .map((text) => (text.includes('Pool B') ? 'Pool B' : 'Pool A'))
    expect([...new Set(heads)]).toEqual(['Pool B', 'Pool A'])
  })

  it('orders the equity weights’ columns by pool', () => {
    const { container } = render(<SandboxEquityCard binding={bound()} />)
    expect(order(container)).toEqual(['Teen', 'General'])
  })
})
