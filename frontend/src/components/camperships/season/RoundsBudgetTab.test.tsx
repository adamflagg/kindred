/**
 * Season › Rounds & budget on screen (spec §5; budget-v9.html): the Budget card, a card per pool, the No pool card and
 * the fold lines, with the scope and CSV on the tab bar's right. The reads and the notes are mocked; the figures are
 * budgetFixtures' invented season.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiAidBudget, ApiAidRulesDraft } from '../../../types/api-types'
import { BUDGET, pastBudget, pastBudgetUnmasked, poolOverShare } from './budgetFixtures'
import { rulesDraft } from './rules/rulesFixtures'
import { SeasonChromeContext } from './seasonChrome'
import { RoundsBudgetCsv, RoundsBudgetScope, RoundsBudgetTab } from './RoundsBudgetTab'

let read: { data: ApiAidBudget | undefined; isLoading: boolean; error: Error | null }
vi.mock('../../../hooks/camperships/useAidBudget', () => ({ useAidBudget: () => read }))
vi.mock('../../../hooks/camperships/useAidDefinitions', () => ({
  useAidDefinitions: () => ({
    notes: [],
    numberOf: (key: string) =>
      ({
        allocated: 1,
        budget_posted: 2,
        remaining: 6,
        round2_asks: 8,
        round1_unmet: 9,
        unconfirmed: 10,
      })[key] ?? null,
    isPending: false,
    error: null,
  }),
}))
vi.mock('../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
let granted: string[] = []
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
let draft: ApiAidRulesDraft = rulesDraft()
vi.mock('../../../hooks/camperships/useAidRules', () => ({
  useAidRulesDraft: () => ({ data: draft, isLoading: false, error: null }),
}))
vi.mock('../../../hooks/camperships/useAidRulesWrites', () => ({
  useAidApproveRules: () => ({ mutate: vi.fn(), isPending: false }),
  useFreshAidRulesDraft: () => () => Promise.resolve(draft),
  useAidSaveRulesSection: () => ({ mutate: vi.fn(), isPending: false }),
}))
const download = vi.fn<(content: string, name: string) => void>()
vi.mock('../../../utils/csvExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/csvExport')>()),
  downloadCsv: (content: string, name: string) => {
    download(content, name)
  },
}))

const REGISTRAR = ['financial_aid.view', 'financial_aid.casework']
const FINANCE = [...REGISTRAR, 'financial_aid.rules']

function Where() {
  const { search } = useLocation()
  const navigation = useNavigationType()
  return (
    <div data-testid="where" data-nav={navigation}>
      {search}
    </div>
  )
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RoundsBudgetTab />
      <Where />
    </MemoryRouter>
  )
}

const below = (key: string) => {
  const row = document.querySelector(`[data-below-line="${key}"]`)
  if (!(row instanceof HTMLElement)) throw new Error(`no below-the-line ${key}`)
  return row
}

const keys = (attribute: string) =>
  [...document.querySelectorAll(`[${attribute}]`)].map((el) => el.getAttribute(attribute))

beforeEach(() => {
  read = { data: BUDGET, isLoading: false, error: null }
  granted = REGISTRAR
  draft = rulesDraft()
  download.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-10T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('Rounds & budget (spec §5)', () => {
  it('leads with the Budget card, then one card per pool, the No pool card, then the fold lines', () => {
    renderAt('/aid/season/rounds-budget')
    const order = [...document.querySelectorAll('[data-testid]')]
      .map((el) => el.getAttribute('data-testid'))
      .filter((id) =>
        [
          'budget-card',
          'pool-card-pool_a',
          'pool-card-pool_b',
          'no-pool-card',
          'fold-lines',
        ].includes(id ?? '')
      )
    expect(order).toEqual([
      'budget-card',
      'pool-card-pool_a',
      'pool-card-pool_b',
      'no-pool-card',
      'fold-lines',
    ])
  })

  it('opens a card and a fold line into ?open=, replacing the entry; an old ?fold= is ignored and dropped', async () => {
    vi.useRealTimers()
    renderAt('/aid/season/rounds-budget?fold=pool_a')
    await userEvent.click(screen.getByRole('button', { name: /Pool A/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('open=pool_a')
    expect(screen.getByTestId('where')).not.toHaveTextContent('fold=')
    expect(screen.getByTestId('where')).toHaveAttribute('data-nav', 'REPLACE')
  })

  it('folds each of the six lines closed by default, each with its summary', () => {
    renderAt('/aid/season/rounds-budget')
    const lines = screen.getByTestId('fold-lines')
    for (const label of [
      'How rules v3 count',
      'Where each round stands',
      'Shown, not counted against the budget',
      'Demand still to come',
      'In the budget, by decision type',
      'Notes 1–13',
    ]) {
      expect(within(lines).getByRole('button', { name: new RegExp(label) })).toBeInTheDocument()
    }
    expect(within(lines).getByText('what each figure means')).toBeInTheDocument()
  })

  it('on a one-pool page hides the Budget card and says "All pools · the whole season" in the opened strip', () => {
    renderAt('/aid/season/rounds-budget?pool=pool_a&open=lines:stands')
    expect(screen.queryByTestId('budget-card')).toBeNull()
    expect(screen.getByText('All pools · the whole season')).toBeInTheDocument()
  })

  it("keeps today's line for a pool the season does not have", () => {
    renderAt('/aid/season/rounds-budget?pool=nope')
    expect(screen.getByText(/No pool "nope" in 2027's budget\./)).toBeInTheDocument()
  })

  it('Edit Plan… is finance-only, live-only and needs approved rules (Review Focus 5)', () => {
    granted = FINANCE
    renderAt('/aid/season/rounds-budget')
    expect(
      within(screen.getByTestId('budget-card')).getByRole('button', { name: 'Edit Plan…' })
    ).toBeInTheDocument()
    cleanup()
    granted = REGISTRAR
    renderAt('/aid/season/rounds-budget')
    expect(screen.queryByRole('button', { name: 'Edit Plan…' })).toBeNull()
    cleanup()
    granted = FINANCE
    renderAt('/aid/season/rounds-budget?as_of=2027-03-15')
    expect(screen.queryByRole('button', { name: 'Edit Plan…' })).toBeNull()
  })

  // Slice 2: leaving approve mode before editing; Edit Plan… waits while the Approve panel is open.
  it('Edit Plan… waits while the Approve panel is open', () => {
    granted = FINANCE
    render(
      <MemoryRouter initialEntries={['/aid/season/rounds-budget']}>
        <SeasonChromeContext.Provider
          value={{
            notice: null,
            setNotice: () => undefined,
            approving: true,
            canApprove: true,
            editing: false,
            setEditing: () => undefined,
            setApproveBusy: () => undefined,
            openApprove: () => undefined,
            closeApprove: () => undefined,
            section: 'budget',
          }}
        >
          <RoundsBudgetTab />
        </SeasonChromeContext.Provider>
      </MemoryRouter>
    )
    expect(screen.queryByRole('button', { name: 'Edit Plan…' })).toBeNull()
  })

  // Scan of #3042: the editor lives in the Budget card, which a one-pool page or a past date does not show; leaving
  // for either closes the plan, so no card keeps a preview of typing nobody can see, Save, or Cancel.
  it.each([
    ['a one-pool page', '/aid/season/rounds-budget?pool=pool_a'],
    ['a past date', '/aid/season/rounds-budget?as_of=2027-03-15'],
  ])(
    'closes Edit Plan… when Back leads to %s, and does not reopen it on Forward',
    async (_, away) => {
      granted = FINANCE
      function Step() {
        const navigate = useNavigate()
        return (
          <>
            <button type="button" onClick={() => void navigate(-1)}>
              Back
            </button>
            <button type="button" onClick={() => void navigate(1)}>
              Forward
            </button>
          </>
        )
      }
      render(
        <MemoryRouter initialEntries={[away, '/aid/season/rounds-budget']} initialIndex={1}>
          <RoundsBudgetTab />
          <Step />
        </MemoryRouter>
      )
      await userEvent.click(
        within(screen.getByTestId('budget-card')).getByRole('button', { name: 'Edit Plan…' })
      )
      expect(screen.getByLabelText('Total')).toBeInTheDocument()
      expect(screen.getAllByText('preview').length).toBeGreaterThan(0)
      await userEvent.click(screen.getByRole('button', { name: 'Back' }))
      expect(screen.queryByText('preview')).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: 'Forward' }))
      expect(screen.getByTestId('budget-card')).toBeInTheDocument()
      expect(screen.queryByLabelText('Total')).toBeNull()
      expect(screen.queryByText('preview')).toBeNull()
    }
  )

  it("opens Edit Plan… from a one-pool page's nudge on All pools, and keeps it open there", async () => {
    granted = FINANCE
    read = { data: poolOverShare(), isLoading: false, error: null }
    renderAt('/aid/season/rounds-budget?pool=pool_b')
    await userEvent.click(
      within(screen.getByTestId('pool-card-pool_b')).getByRole('button', { name: 'Edit Plan…' })
    )
    expect(screen.getByTestId('where').textContent).toBe('')
    expect(screen.getByLabelText('Total')).toBeInTheDocument()
  })

  it('keeps Edit Plan… enabled after a posted round locks the budget total (owner 10-06 (b))', () => {
    granted = FINANCE
    draft = { ...rulesDraft(), budget_total_locked: true }
    renderAt('/aid/season/rounds-budget')
    expect(
      within(screen.getByTestId('budget-card')).getByRole('button', { name: 'Edit Plan…' })
    ).toBeEnabled()
  })

  it('downloads every pool, round and the total whatever is folded', async () => {
    vi.useRealTimers()
    render(
      <MemoryRouter initialEntries={['/aid/season/rounds-budget']}>
        <RoundsBudgetCsv />
      </MemoryRouter>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    const [content, name] = download.mock.calls[0] ?? ['', '']
    expect(name).toBe('camperships-season-rounds-budget-2027.csv')
    expect(content.split('\n')[0]).toBe(
      'Pool,Round,Share %,Allocated,Committed,Posted,Accepted,Needs an offer,Needs an offer requests,Pending approval,Pending approval requests,Remaining'
    )
  })

  it("names the scope on the tab bar's right with All Pools ›", () => {
    render(
      <MemoryRouter initialEntries={['/aid/season/rounds-budget?pool=pool_b']}>
        <RoundsBudgetScope />
      </MemoryRouter>
    )
    expect(screen.getByText('Pool B')).toHaveProperty('tagName', 'B')
    expect(screen.getByRole('link', { name: 'All Pools ›' })).toHaveAttribute(
      'href',
      '/aid/season/rounds-budget?year=2027'
    )
  })

  it("loading reads QueryGuard's words; a failed refetch keeps the figures", () => {
    read = { data: undefined, isLoading: true, error: null }
    renderAt('/aid/season/rounds-budget')
    expect(screen.getByText(/Loading Rounds & budget/)).toBeInTheDocument()
    cleanup()
    read = { data: BUDGET, isLoading: false, error: new Error('Failed to load Rounds & budget') }
    renderAt('/aid/season/rounds-budget')
    expect(screen.queryByText(/Failed to load/)).toBeNull()
    expect(screen.getByTestId('budget-card')).toBeInTheDocument()
  })
})

describe('the fold lines carry what the table, strip and notes did (spec §5.2 F)', () => {
  it("shows the strip's counts under Where each round stands, each opening its rows (D153)", () => {
    renderAt('/aid/season/rounds-budget?open=lines:stands')
    const lines = screen.getByTestId('fold-lines')
    expect(within(lines).getByRole('link', { name: '340 fam · 367 req' })).toHaveAttribute(
      'href',
      '/aid/requests?posted=1&year=2027'
    )
    expect(within(lines).queryByText(/awaiting sync|not reconciled/)).toBeNull()
  })

  it('on a past date opens no queue view from the strip, and keeps the date on Posted', () => {
    read = { data: pastBudgetUnmasked(), isLoading: false, error: null }
    renderAt('/aid/season/rounds-budget?open=lines:stands&as_of=2027-03-15')
    const round1 = within(screen.getByTestId('fold-lines')).getByText('Round 1').parentElement
    if (round1 === null) throw new Error('no Round 1 line')
    expect(within(round1).getByText('3 fam · 3 req')).toBeInTheDocument()
    expect(within(round1).queryByRole('link', { name: '3 fam · 3 req' })).toBeNull()
    expect(within(round1).getByRole('link', { name: '340 fam · 367 req' })).toBeInTheDocument()
  })

  it('shows below the line: outside grants, decision types outside the budget, held requests', () => {
    renderAt('/aid/season/rounds-budget?open=lines:below')
    expect(keys('data-below-line')).toEqual([
      'grants',
      'grants_off_requests',
      'outside_type:outside',
      'held',
    ])
    expect(below('grants')).toHaveTextContent('Outside grants on requests (14 fam · 16 req)')
    expect(within(below('grants')).getByText('$44,300')).toBeInTheDocument()
    expect(within(below('held')).getByRole('link', { name: '7 fam · 10 req' })).toHaveAttribute(
      'href',
      '/aid/requests?view=holds&year=2027'
    )
  })

  it('scopes below the line to one pool', () => {
    renderAt('/aid/season/rounds-budget?pool=pool_b&open=lines:below')
    expect(keys('data-below-line')).toEqual(['grants', 'held'])
  })

  it("shows each pool's Round 2 asks under Demand still to come, without the old heading", () => {
    renderAt('/aid/season/rounds-budget?open=lines:demand')
    const asks = document.querySelector('[data-demand-line="pool_a:round2_asks"]')
    if (!(asks instanceof HTMLElement)) throw new Error('no Round 2 asks line')
    expect(within(asks).getByRole('link', { name: '30 fam · 31 req' })).toHaveAttribute(
      'href',
      '/aid/requests?lens=appeals&pool=pool_a&live=1&year=2027'
    )
    expect(screen.queryByText(/asks, shown, never counted in Remaining/)).toBeNull()
  })

  it('shows the budget by decision type, and none when the read has no lines', () => {
    renderAt('/aid/season/rounds-budget?open=lines:types')
    expect(keys('data-type-line')).toEqual(['type:standard', 'type:appeal', 'type:none'])
    cleanup()
    read = {
      data: { ...BUDGET, pools: BUDGET.pools.map((p) => ({ ...p, decision_types: [] })) },
      isLoading: false,
      error: null,
    }
    renderAt('/aid/season/rounds-budget?pool=pool_b')
    expect(screen.queryByRole('button', { name: /In the budget, by decision type/ })).toBeNull()
  })

  it('says when no approved rules price the season yet, in a pill, not a banner', () => {
    read = { data: { ...BUDGET, rules_version: null }, isLoading: false, error: null }
    renderAt('/aid/season/rounds-budget')
    expect(screen.getByText('no approved rules: nothing allocated yet')).toBeInTheDocument()
  })

  it('reads "—" for what a past date leaves empty', () => {
    read = { data: pastBudget(), isLoading: false, error: null }
    renderAt('/aid/season/rounds-budget?as_of=2027-03-15')
    expect(screen.getByText(/past date: exact figures only/)).toBeInTheDocument()
  })

  it('keeps a past date on "All Pools ›", from an unknown pool', () => {
    renderAt('/aid/season/rounds-budget?pool=pool_zz&as_of=2027-03-15')
    expect(screen.getByRole('link', { name: 'All Pools ›' })).toHaveAttribute(
      'href',
      '/aid/season/rounds-budget?year=2027&as_of=2027-03-15'
    )
  })
})
