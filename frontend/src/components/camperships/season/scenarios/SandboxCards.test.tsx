import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SandboxEquityCard } from './SandboxEquityCard'
import { SandboxIncomeCard } from './SandboxIncomeCard'
import { SandboxTierCard } from './SandboxTierCard'
import { SANDBOX_DOC } from './sandboxFixtures'
import { bindingOf } from './sandboxModel'

function setup(over: { edits?: Record<string, string>; canEdit?: boolean } = {}) {
  const type = vi.fn<(key: string, raw: string) => void>()
  const release = vi.fn<() => void>()
  const binding = bindingOf({
    recorded: SANDBOX_DOC,
    source: SANDBOX_DOC,
    edits: new Map(Object.entries(over.edits ?? {})),
    canEdit: over.canEdit ?? true,
    type,
    release,
  })
  return { binding, type, release }
}

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
    expect(screen.getByRole('textbox', { name: 'Band width' })).toHaveValue('40,000')
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
    // the mock keeps a changed box's old value in its title (note 6), not beside the box
    expect(screen.getByRole('textbox', { name: 'Minimum award' })).toHaveAttribute(
      'title',
      'was $100'
    )
    expect(screen.queryByText('was $100')).toBeNull()
  })

  it('shows a fractional "was" in whole dollars (coordinator ruling 2026-10-07)', () => {
    const { type, release } = setup()
    const binding = bindingOf({
      recorded: SANDBOX_DOC,
      source: { ...SANDBOX_DOC, awards: { ...SANDBOX_DOC.awards, minimum: '125.50' } },
      edits: new Map(),
      canEdit: true,
      type,
      release,
    })
    render(<SandboxTierCard binding={binding} fitButton={null} fitAnswer={null} />)
    expect(screen.getByRole('textbox', { name: 'Minimum award' })).toHaveAttribute(
      'title',
      'was $126'
    )
  })

  it('greys its boxes only for someone who cannot edit (owner, 2026-10-10: the sandbox never locks)', () => {
    const { binding } = setup({ canEdit: false })
    const { container } = render(
      <SandboxTierCard binding={binding} fitButton={null} fitAnswer={null} />
    )
    expect(container.querySelector('[class*="bg-stone"]')).toBeNull()
    const box = screen.getByRole('textbox', { name: 'Band width' })
    expect(box).toBeDisabled()
    // the kit's .cf-input:disabled: a muted fill and muted ink, no shadow
    expect(box.className).toContain('disabled:bg-[color-mix(in_oklab,var(--color-muted)_70%')
    expect(box).toHaveClass('disabled:text-muted-foreground', 'disabled:shadow-none')
  })
})

describe('the Sandbox boxes are the kit’s small input (scenarios-6)', () => {
  it('is 24px, 12.5px, right-aligned, tabular, radius 8, with the widths 84 · 48 · 64', () => {
    const { binding } = setup()
    render(<SandboxTierCard binding={binding} fitButton={null} fitAnswer={null} />)
    const start = screen.getByRole('textbox', { name: 'Start' })
    expect(start).toHaveClass(
      'h-6',
      'text-[12.5px]',
      'text-right',
      'tabular-nums',
      'rounded-lg',
      'px-1.5'
    )
    const width = (name: string) => screen.getByRole('textbox', { name }).style.width
    expect([width('Start'), width('Band width'), width('Income ceiling')]).toEqual([
      '84px',
      '84px',
      '84px',
    ])
    expect(width('Tiers')).toBe('48px')
    expect(width('Minimum award')).toBe('64px')
    expect(width('Round 1 % · General · tier 2')).toBe('64px')
  })

  it('shows whole dollars with thousands separators, raw while editing, and strips commas on input', async () => {
    const { binding, type } = setup()
    render(<SandboxTierCard binding={binding} fitButton={null} fitAnswer={null} />)
    const width = screen.getByRole('textbox', { name: 'Band width' })
    expect(width).toHaveValue('40,000')
    await userEvent.click(width)
    expect(width).toHaveValue('40000')
    fireEvent.change(width, { target: { value: '1,234,567' } })
    expect(type).toHaveBeenLastCalledWith('tiers.width', '1234567')
  })

  it('labels the settings 13px/600 with a muted unit, and draws no divider before Minimum award', () => {
    const { binding } = setup()
    const { container } = render(
      <SandboxTierCard binding={binding} fitButton={null} fitAnswer={null} />
    )
    const labels = [...container.querySelectorAll('label')]
    expect(labels.map((label) => label.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      'Start $',
      'Band width $',
      'Tiers',
      'Income ceiling $',
      'Minimum award $',
    ])
    for (const label of labels) expect(label).toHaveClass('text-[13px]', 'font-semibold')
    expect(within(labels[0] as HTMLElement).getByText('$')).toHaveClass(
      'text-muted-foreground',
      'font-normal'
    )
    expect(container.querySelector('.w-px')).toBeNull()
  })

  it('puts the Tier and Income ceiling words in titles, not numbered notes', () => {
    const { binding } = setup()
    render(<SandboxTierCard binding={binding} fitButton={null} fitAnswer={null} />)
    expect(screen.getByRole('columnheader', { name: 'Tier' })).toHaveAttribute(
      'title',
      expect.stringMatching(/^Tier: tier 1 is the lowest income/)
    )
    expect(screen.getByText('Income ceiling').closest('label')).toHaveAttribute(
      'title',
      expect.stringMatching(/^Income ceiling: above it, no camp money in any round/)
    )
    expect(screen.queryByText('6')).toBeNull()
    expect(screen.queryByText('7')).toBeNull()
  })
})

describe('the Tiers grid is the Rules grid (scenarios-4)', () => {
  it('sits in the Rules card shell, with the grid in its own fitted table card, a rule on every column', () => {
    const { binding } = setup()
    render(<SandboxTierCard binding={binding} fitButton={null} fitAnswer={null} />)
    const card = screen.getByRole('heading', { name: 'Tiers & Round 1' }).closest('section')
    expect(card).toHaveClass('rounded-[10px]', 'px-3', 'pb-2.5')
    const grid = screen.getByTestId('sandbox-grid')
    expect(grid.parentElement).toHaveClass('inline-block', 'rounded-xl', 'border')
    const cells = within(grid).getAllByRole('cell')
    // tier names bold; the first column of each block takes the group rule, the others the light rule
    expect(cells[0]).toHaveClass('font-bold')
    expect(cells[2]?.className).toContain(
      'color-mix(in_oklab,var(--color-border),var(--color-foreground)_10%)'
    )
    expect(cells[1]?.className).toContain('color-mix(in_oklab,var(--color-border)_75%')
  })

  it('heads the blocks from a group row over an empty two-column cell, the group in foreground ink', () => {
    const { binding } = setup()
    render(<SandboxTierCard binding={binding} fitButton={null} fitAnswer={null} />)
    const rows = within(screen.getByTestId('sandbox-grid')).getAllByRole('row')
    const group = within(rows[0] as HTMLElement).getAllByRole('columnheader')
    expect(group.map((th) => th.textContent)).toEqual([
      '',
      'Round 1 % of the cost',
      'Round 1 + 2 cap, % of the cost',
    ])
    expect(group[0]).toHaveAttribute('colspan', '2')
    expect(group[1]).not.toHaveClass('text-muted-foreground')
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

  it('draws the group row ABOVE Criterion · Enabled · the pools, its equity-class words in its title, no note mark', () => {
    const { binding } = setup()
    render(<SandboxEquityCard binding={binding} />)
    const rows = screen.getAllByRole('row')
    const top = within(rows[0] as HTMLElement).getAllByRole('columnheader')
    expect(top.map((th) => th.textContent)).toEqual(['', 'Weight, by equity class'])
    expect(top[1]).toHaveAttribute(
      'title',
      expect.stringMatching(/^Equity class: picks a program's equity weights/)
    )
    expect(top[1]?.querySelector('sup')).toBeNull()
    expect(
      within(rows[1] as HTMLElement)
        .getAllByRole('columnheader')
        .slice(0, 2)
        .map((th) => th.textContent)
    ).toEqual(['Criterion', 'Enabled'])
  })

  it('is the Rules grid: bold criterion names, weights right-aligned, accent checkboxes 13px', () => {
    const { binding } = setup()
    render(<SandboxEquityCard binding={binding} />)
    const row = screen.getByText('Single parent').closest('tr') as HTMLElement
    const cells = within(row).getAllByRole('cell')
    expect(cells[0]).toHaveClass('font-bold')
    expect(cells[2]).toHaveClass('text-right')
    const check = within(row).getByRole('checkbox')
    expect(check).toHaveClass('accent-primary', 'size-[13px]')
    expect(screen.getByRole('heading', { name: 'Equity' }).closest('section')).toHaveClass(
      'rounded-[10px]'
    )
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

  it('puts the current year beside the prior-year box, titled, and drops the Read-only line (scenarios-14)', () => {
    const { binding } = setup()
    render(<SandboxIncomeCard binding={binding} />)
    const current = screen.getByText('50%')
    expect(current.tagName).toBe('B')
    expect(current.parentElement).toHaveAttribute('title', '100% less the prior-year weight')
    expect(current.parentElement).toHaveTextContent('current year 50%')
    expect(screen.queryByText(/Read-only/)).toBeNull()
    expect(screen.queryByText(/Current-year weight/)).toBeNull()
  })

  it('lays the settings out as kit key–value rows: key 13px/600, a hairline per row, 12px/700 muted group labels', () => {
    const { binding } = setup()
    const { container } = render(<SandboxIncomeCard binding={binding} />)
    const rows = [...container.querySelectorAll('label')]
    expect(rows.length).toBeGreaterThanOrEqual(6)
    for (const row of rows) {
      expect(row).toHaveClass('border-b', 'last:border-b-0')
      expect(row.firstElementChild).toHaveClass('text-[13px]', 'font-semibold')
    }
    for (const name of ['Which years count', 'Expenses, savings and dependents']) {
      expect(screen.getByText(name)).toHaveClass('text-xs', 'font-bold', 'text-muted-foreground')
    }
    expect(container.querySelector('section')).toHaveClass('rounded-[10px]')
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
      canEdit: true,
      type: vi.fn(),
      release: vi.fn(),
    })
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

  it('orders the equity weights’ columns by pool, named as the pools (owner B34)', () => {
    render(<SandboxEquityCard binding={bound()} />)
    const heads = screen
      .getAllByRole('columnheader')
      .map((th) => th.textContent)
      .filter((text) => /Pool [AB]/.test(text))
    expect(heads).toEqual(['Pool B', 'Pool A'])
  })

  it('falls back to the class label when no pool uses the class', () => {
    const lone = {
      ...POOLED,
      programs: {},
      budget: { total: '1000000', pools: {} },
    } as typeof POOLED
    render(
      <SandboxEquityCard
        binding={bindingOf({
          recorded: lone,
          source: lone,
          edits: new Map(),
          canEdit: true,
          type: vi.fn(),
          release: vi.fn(),
        })}
      />
    )
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toContain('General')
  })
})
