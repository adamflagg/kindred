/**
 * Season › Rounds & budget on screen (spec §5; final design, layout C): the Budget heading, a strip of compact cards
 * (a pool each, the season in the band), ONE ruled table, four folding sections, with the CSV on the tab bar's right. The reads and the notes are mocked; the figures are
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
import { RoundsBudgetCsv, RoundsBudgetTab } from './RoundsBudgetTab'

let read: { data: ApiAidBudget | undefined; isLoading: boolean; error: Error | null }
vi.mock('../../../hooks/camperships/useAidBudget', () => ({ useAidBudget: () => read }))
let notes: Array<{ n: number; term?: string; text: string }> = []
vi.mock('../../../hooks/camperships/useAidDefinitions', () => ({
  useAidDefinitions: () => ({
    notes,
    numberOf: (key: string) =>
      ({
        rounds_allocated: 1,
        rounds_committed: 2,
        rounds_posted: 3,
        rounds_needs_offer: 4,
        rounds_remaining: 5,
        rounds_below_the_line: 6,
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

/** The chrome's done-season fields (spec §11.3), open by default: a literal context spreads these in. */
const DONE_FIELDS = {
  done: false,
  locked: false,
  unreadable: null,
  unlocked: null,
  unlocking: false,
  openUnlock: () => undefined,
  closeUnlock: () => undefined,
  unlock: () => undefined,
  lockAgain: () => undefined,
  pastSeasonReason: null,
  relocks: 0,
}

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
  notes = []
  download.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-10T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('Rounds & budget (spec §5)', () => {
  it('leads with the Budget heading, the strip of cards (pools, then the Season), ONE ruled table, then the sections', () => {
    renderAt('/aid/season/rounds-budget')
    const order = [...document.querySelectorAll('[data-testid]')]
      .map((el) => el.getAttribute('data-testid'))
      .filter((id) =>
        [
          'budget-head',
          'pool-card-pool_a',
          'pool-card-pool_b',
          'season-card',
          'rounds-table',
          'fold-lines',
        ].includes(id ?? '')
      )
    expect(order).toEqual([
      'budget-head',
      'pool-card-pool_a',
      'pool-card-pool_b',
      'season-card',
      'rounds-table',
      'fold-lines',
    ])
    // Pool cards open nothing and No pool is a muted table row, never a card (rounds-1, -18)
    expect(screen.queryByTestId('no-pool-card')).toBeNull()
    expect(document.querySelector('[data-ledger="nopool"]')).not.toBeNull()
  })

  it('draws the ruled table with five What-is-committed columns, rounds under each open pool, the season in the band (rounds-1, -2, -3)', () => {
    renderAt('/aid/season/rounds-budget')
    const table = screen.getByTestId('rounds-table')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent)
    ).toEqual([
      '',
      'What is committed2',
      'Pool · round',
      'Committed2',
      'Posted3',
      'Accepted',
      'Needs an offer4',
      'Pending approval4',
      'Not yet confirmed3',
    ])
    // pools open by default: each pool, its three rounds, No pool, the Season total
    expect(
      [...table.querySelectorAll('tbody tr')].map((tr) => tr.getAttribute('data-ledger'))
    ).toEqual([
      'pool',
      'round',
      'round',
      'round',
      'pool',
      'round',
      'round',
      'round',
      'nopool',
      'foot',
    ])
    expect(within(table).getByText('Season total')).toBeInTheDocument()
  })

  it('folds a pool with its caret and still has the season row (never an empty table)', async () => {
    vi.useRealTimers()
    renderAt('/aid/season/rounds-budget')
    await userEvent.click(screen.getByRole('button', { name: /Pool A/ }))
    expect(document.querySelectorAll('[data-pool="pool_a"]')).toHaveLength(1)
    expect(document.querySelectorAll('tr[data-round]')).toHaveLength(3)
    expect(within(screen.getByTestId('rounds-table')).getByText('Season total')).toBeInTheDocument()
  })

  it('writes the whole fold state to ?open=, replacing the entry; an old ?fold= is ignored and dropped', async () => {
    vi.useRealTimers()
    renderAt('/aid/season/rounds-budget?fold=pool_a')
    await userEvent.click(screen.getByRole('button', { name: /Pool A/ }))
    const where = screen.getByTestId('where')
    expect(new URLSearchParams(where.textContent).get('open')).toBe('pool_b,lines:stands')
    expect(where).not.toHaveTextContent('fold=')
    expect(where).toHaveAttribute('data-nav', 'REPLACE')
  })

  it('puts the four sections under the table: Where each round stands OPEN, the other three closed, each with its summary', () => {
    renderAt('/aid/season/rounds-budget')
    const lines = screen.getByTestId('fold-lines')
    const state = (label: string) =>
      within(lines)
        .getByRole('button', { name: new RegExp(label) })
        .getAttribute('aria-expanded')
    expect(state('Where each round stands')).toBe('true')
    expect(state('Shown, not counted')).toBe('false')
    expect(state('Demand still to come')).toBe('false')
    expect(state('In the budget, by decision type')).toBe('false')
    expect(
      within(lines).getByText(/^needs an offer 13 req · pending approval 1 req/)
    ).toBeInTheDocument()
    // How the rules count and the Notes are not fold lines any more (rounds-5)
    expect(within(lines).queryByRole('button', { name: /How rules/ })).toBeNull()
    expect(within(lines).queryByRole('button', { name: /Notes/ })).toBeNull()
  })

  it('shows where each round stands as a ruled Round × stage table, Pending approval only on Round 3 (rounds-6)', () => {
    renderAt('/aid/season/rounds-budget')
    const lines = screen.getByTestId('fold-lines')
    const table = within(lines).getAllByRole('table')[0]!
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent)
    ).toEqual(['Round', 'Needs an offer', 'Posted', 'Accepted', 'Held', 'Pending approval'])
    expect(within(table).getAllByRole('row')).toHaveLength(4)
  })

  it('gives the Budget heading the rules version and how the rules count (rounds-5)', () => {
    renderAt('/aid/season/rounds-budget')
    expect(
      within(screen.getByTestId('budget-head')).getByText(
        'rules v3 · counts when offered · each pool keeps its own Remaining · only the total is a cap'
      )
    ).toBeInTheDocument()
  })

  it('on a one-pool page keeps the Budget heading with a removable chip, no Season card, and says "All pools · the whole season"', async () => {
    vi.useRealTimers()
    renderAt('/aid/season/rounds-budget?pool=pool_a')
    expect(screen.getByTestId('budget-head')).toBeInTheDocument()
    expect(screen.queryByTestId('season-card')).toBeNull()
    expect(screen.getByText(/^All pools · the whole season · needs an offer/)).toBeInTheDocument()
    expect(within(screen.getByTestId('rounds-table')).getByText('Pool A only')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear Pool A only' }))
    expect(screen.getByTestId('where').textContent).toBe('')
    expect(screen.getByTestId('season-card')).toBeInTheDocument()
  })

  it("keeps today's line for a pool the season does not have", () => {
    renderAt('/aid/season/rounds-budget?pool=nope')
    expect(screen.getByText(/No pool "nope" in 2027's budget\./)).toBeInTheDocument()
  })

  it('Edit Plan… is finance-only and live-only, and also serves a season with no approved rules yet (it sets the first budget)', () => {
    granted = FINANCE
    renderAt('/aid/season/rounds-budget')
    expect(
      within(screen.getByTestId('budget-head')).getByRole('button', { name: 'Edit Plan…' })
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
            ...DONE_FIELDS,
          }}
        >
          <RoundsBudgetTab />
        </SeasonChromeContext.Provider>
      </MemoryRouter>
    )
    expect(screen.queryByRole('button', { name: 'Edit Plan…' })).toBeNull()
  })

  it('Edit Plan… waits on a locked season (a done one not unlocked)', () => {
    granted = FINANCE
    render(
      <MemoryRouter initialEntries={['/aid/season/rounds-budget']}>
        <SeasonChromeContext.Provider
          value={{
            notice: null,
            setNotice: () => undefined,
            approving: false,
            canApprove: false,
            editing: false,
            setEditing: () => undefined,
            setApproveBusy: () => undefined,
            openApprove: () => undefined,
            closeApprove: () => undefined,
            section: 'budget',
            ...DONE_FIELDS,
            done: true,
            locked: true,
          }}
        >
          <RoundsBudgetTab />
        </SeasonChromeContext.Provider>
      </MemoryRouter>
    )
    expect(screen.queryByRole('button', { name: 'Edit Plan…' })).toBeNull()
  })

  // Coordinator ruling: Lock Again closes Edit Plan…; the chrome counts each Lock Again in `relocks`.
  it('closes Edit Plan… when Lock Again counts a relock', async () => {
    granted = FINANCE
    const chromeAt = (relocks: number) => (
      <MemoryRouter initialEntries={['/aid/season/rounds-budget']}>
        <SeasonChromeContext.Provider
          value={{
            notice: null,
            setNotice: () => undefined,
            approving: false,
            canApprove: false,
            editing: false,
            setEditing: () => undefined,
            setApproveBusy: () => undefined,
            openApprove: () => undefined,
            closeApprove: () => undefined,
            section: 'budget',
            ...DONE_FIELDS,
            done: true,
            unlocked: { year: 2027, reason: 'Late fix', at: 0 },
            pastSeasonReason: 'Late fix',
            relocks,
          }}
        >
          <RoundsBudgetTab />
        </SeasonChromeContext.Provider>
      </MemoryRouter>
    )
    const view = render(chromeAt(0))
    await userEvent.click(
      within(screen.getByTestId('budget-head')).getByRole('button', { name: 'Edit Plan…' })
    )
    expect(screen.getByLabelText('Total')).toBeInTheDocument()
    view.rerender(chromeAt(1))
    expect(screen.queryByLabelText('Total')).toBeNull()
  })

  // Scan of #3042: a past date shows no editor; leaving for one closes the plan, so no card keeps a preview of typing
  // nobody can save or cancel. (A one-pool page keeps the editor: the Budget heading stays there, rounds-15.)
  it('closes Edit Plan… when Back leads to a past date, and does not reopen it on Forward', async () => {
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
      <MemoryRouter
        initialEntries={['/aid/season/rounds-budget?as_of=2027-03-15', '/aid/season/rounds-budget']}
        initialIndex={1}
      >
        <RoundsBudgetTab />
        <Step />
      </MemoryRouter>
    )
    await userEvent.click(
      within(screen.getByTestId('budget-head')).getByRole('button', { name: 'Edit Plan…' })
    )
    expect(screen.getByLabelText('Total')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.queryByLabelText('Total')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Forward' }))
    expect(screen.getByTestId('budget-head')).toBeInTheDocument()
    expect(screen.queryByLabelText('Total')).toBeNull()
    expect(screen.queryByText('preview')).toBeNull()
  })

  it('shows ONE amber preview pill once typing moves a figure, and marks the moved figures (rounds-13)', async () => {
    vi.useRealTimers()
    granted = FINANCE
    draft = { ...rulesDraft(), budget_total_locked: false }
    renderAt('/aid/season/rounds-budget')
    await userEvent.click(
      within(screen.getByTestId('budget-head')).getByRole('button', { name: 'Edit Plan…' })
    )
    // opened as the draft stands: nothing moved, so no pill and no amber mark yet
    expect(screen.queryByText('preview')).toBeNull()
    const total = screen.getByLabelText('Total')
    await userEvent.clear(total)
    await userEvent.type(total, '1010000')
    expect(screen.getAllByText('preview')).toHaveLength(1)
    expect(within(screen.getByTestId('budget-head')).getByText('preview')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-moved]').length).toBeGreaterThan(0)
  })

  it('Edit Plan… on a one-pool page edits in place and keeps the page on that pool', async () => {
    granted = FINANCE
    read = { data: poolOverShare(), isLoading: false, error: null }
    renderAt('/aid/season/rounds-budget?pool=pool_b')
    await userEvent.click(
      within(screen.getByTestId('budget-head')).getByRole('button', { name: 'Edit Plan…' })
    )
    expect(screen.getByTestId('where')).toHaveTextContent('pool=pool_b')
    expect(screen.getByLabelText('Total')).toBeInTheDocument()
    expect(screen.getByTestId('pool-card-pool_b')).toBeInTheDocument()
  })

  it('draws a pool past its share as an amber pill on its card, with no Edit Plan… of its own', () => {
    granted = FINANCE
    read = { data: poolOverShare(), isLoading: false, error: null }
    renderAt('/aid/season/rounds-budget')
    const card = screen.getByTestId('pool-card-pool_b')
    expect(within(card).getByText('over its share')).toBeInTheDocument()
    expect(within(card).queryByRole('button')).toBeNull()
  })

  it('keeps Edit Plan… enabled after a posted round locks the budget total (owner 10-06 (b))', () => {
    granted = FINANCE
    draft = { ...rulesDraft(), budget_total_locked: true }
    renderAt('/aid/season/rounds-budget')
    expect(
      within(screen.getByTestId('budget-head')).getByRole('button', { name: 'Edit Plan…' })
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
    const lines = content.split('\n')
    // the Reports CSVs' heading block: its name, then season and as-of, then a blank line, then the header
    expect(lines[0]).toBe('Rounds & budget')
    expect(lines[1]).toMatch(/^"Season 2027 · As of .+ \(live\)"$/)
    expect(lines[2]).toBe('')
    expect(lines[3]).toBe(
      'Pool,Round,Share %,Allocated,Committed,Posted,Accepted,Needs an offer,Needs an offer requests,Pending approval,Pending approval requests,Remaining'
    )
    // and an absolute Link line, like every other CSV
    expect(lines.at(-1)).toMatch(/^Link,http/)
  })

  it("loading reads QueryGuard's words; a failed refetch keeps the figures", () => {
    read = { data: undefined, isLoading: true, error: null }
    renderAt('/aid/season/rounds-budget')
    expect(screen.getByText(/Loading Rounds & budget/)).toBeInTheDocument()
    cleanup()
    read = { data: BUDGET, isLoading: false, error: new Error('Failed to load Rounds & budget') }
    renderAt('/aid/season/rounds-budget')
    expect(screen.queryByText(/Failed to load/)).toBeNull()
    expect(screen.getByTestId('budget-head')).toBeInTheDocument()
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
    const round1 = document.querySelector('[data-stands-round="1"]')
    if (!(round1 instanceof HTMLElement)) throw new Error('no Round 1 line')
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
    expect(below('grants')).toHaveTextContent('Outside grants on requests')
    expect(within(below('grants')).getByText('14 fam · 16 req')).toBeInTheDocument()
    expect(within(below('grants')).getByText('$44,300')).toBeInTheDocument()
    expect(within(below('held')).getByRole('link', { name: '7 fam · 10 req' })).toHaveAttribute(
      'href',
      '/aid/requests?view=holds&year=2027'
    )
  })

  it('titles Shown, not counted, with the outside fund qualified and Held showing "—" for its unknown amount (rounds-7, m3)', () => {
    renderAt('/aid/season/rounds-budget?open=lines:below')
    const table = within(screen.getByTestId('fold-lines')).getAllByRole('table')[0]!
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent)
    ).toEqual(['Line', 'Families · requests', 'Amount', 'Of it'])
    expect(
      within(below('outside_type:outside')).getByText(
        "Funded outside the budget (outside the camp's budget)"
      )
    ).toBeInTheDocument()
    expect(within(below('outside_type:outside')).getByText('$21,840 posted')).toBeInTheDocument()
    expect(within(below('held')).getByText('—')).toBeInTheDocument()
    expect(within(below('held')).getByText('amount unknown until resolved')).toBeInTheDocument()
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

  it('draws the Demand totals as two bold green-band rows, No pool described, closed by default (rounds-8, m4)', () => {
    renderAt('/aid/season/rounds-budget')
    expect(document.querySelector('[data-fold-line="demand"] table')).toBeNull()
    cleanup()
    renderAt('/aid/season/rounds-budget?open=lines:demand')
    const totals = [...document.querySelectorAll('[data-total]')]
    expect(totals.map((r) => r.querySelector('td')?.textContent)).toEqual([
      'Total · Round 2 asks so far',
      'Total · Round 1 unmet ask',
    ])
    expect(totals[0]?.querySelector('td')?.className).toMatch(/font-bold/)
    cleanup()
    // a No pool that holds some demand says what it is
    read = {
      data: {
        ...BUDGET,
        pools: BUDGET.pools.map((p) =>
          p.pool === ''
            ? {
                ...p,
                demand: {
                  ...p.demand,
                  round1_unmet: 8000,
                  round1_unmet_requests: { families: 3, requests: 3 },
                },
              }
            : p
        ),
      },
      isLoading: false,
      error: null,
    }
    renderAt('/aid/season/rounds-budget?open=lines:demand')
    expect(screen.getByText('requests with no program yet')).toBeInTheDocument()
  })

  it('keeps the drill links on Round 2 request counts and Held counts in Demand (rounds-m3)', () => {
    renderAt('/aid/season/rounds-budget?open=lines:demand')
    const asks = document.querySelector('[data-demand-line="pool_a:round2_asks"]')
    if (!(asks instanceof HTMLElement)) throw new Error('no Round 2 asks line')
    expect(within(asks).getAllByRole('link').length).toBe(2)
    expect(
      within(asks)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href'))
    ).toContain('/aid/requests?view=holds&pool=pool_a&year=2027')
  })

  it('shows the budget by decision type under its own heading only, and none when the read has no lines', () => {
    renderAt('/aid/season/rounds-budget?open=lines:types')
    expect(screen.getAllByText('In the budget, by decision type')).toHaveLength(1)
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

describe('the shots against the mock (10-10)', () => {
  it('indents each round under its pool by 24px and keeps the cell from wrapping (mock td.ind)', () => {
    renderAt('/aid/season/rounds-budget')
    const td = document.querySelector('tr[data-ledger="round"] td')
    expect(td).toHaveClass('pl-6', 'whitespace-nowrap')
  })

  it('pins each caret to the left of its 12/14px box, so a gap sits before the title (buttons centre text)', () => {
    renderAt('/aid/season/rounds-budget')
    const poolCaret = screen.getByRole('button', { name: /Pool A/ }).querySelector('span')
    // 20px line on the 10px caret, as the mock's .cf-tg inherits: the pool row stands 33px against a round's 31
    expect(poolCaret).toHaveClass('text-left', 'leading-5')
    const sectionCaret = within(screen.getByTestId('fold-lines'))
      .getByRole('button', { name: /Where each round stands/ })
      .querySelector('span')
    expect(sectionCaret).toHaveClass('text-left')
  })

  it("raises a section's note mark straight after its title, inside the title's run (mock: title then S(6))", () => {
    renderAt('/aid/season/rounds-budget')
    const section = document.querySelector('[data-fold-line="below"]') as HTMLElement
    const button = within(section).getByRole('button', { name: /Shown, not counted/ })
    const mark = within(section).getByText('6')
    expect(mark.tagName).toBe('SUP')
    expect(mark.parentElement).toBe(button.parentElement)
    expect(mark.parentElement).toHaveClass('text-[13.5px]')
    expect(mark.parentElement).not.toHaveClass('flex')
  })

  it('lets the four lower tables size their columns to the content, as the mock does (no fixed widths)', () => {
    renderAt('/aid/season/rounds-budget?open=lines:stands,lines:below,lines:demand,lines:types')
    const lines = screen.getByTestId('fold-lines')
    expect(within(lines).getAllByRole('table')).toHaveLength(4)
    expect([...lines.querySelectorAll('th')].filter((th) => th.style.width !== '')).toEqual([])
  })

  it("indents Demand's lines 24px under their pool (mock td.ind)", () => {
    renderAt('/aid/season/rounds-budget?open=lines:demand')
    const cell = screen.getAllByText('Round 2 asks so far')[0]!.closest('td')
    expect(cell).toHaveClass('pl-6')
    expect(cell).not.toHaveClass('pl-7')
  })

  it("on a one-pool page leads each pool-scoped summary with the pool's name (mock ?scope=tbm)", () => {
    renderAt('/aid/season/rounds-budget?pool=pool_b')
    const summary = (key: string) =>
      (document.querySelector(`[data-fold-line="${key}"]`) as HTMLElement).querySelector(
        'span[title]'
      )
    expect(summary('below')).toHaveTextContent(/^Pool B · outside grants \$3,100 · 1 held request$/)
    expect(summary('demand')).toHaveTextContent(/^Pool B · Round 2 asks so far/)
    expect(summary('types')).toHaveTextContent(/^Pool B · /)
  })

  it('bolds the second term in the Committed, Posted and Needs an offer notes, as the mock does', () => {
    notes = [
      {
        n: 2,
        term: 'Committed',
        text: 'Committed: Posted + Needs an offer. Accepted sits inside Posted.',
      },
      {
        n: 3,
        term: 'Posted',
        text: 'Posted: locked. Not yet confirmed: the part not in CampMinder.',
      },
      {
        n: 4,
        term: 'Needs an offer',
        text: 'Needs an offer: decided. Pending approval: a Round 3 above $300.',
      },
    ]
    renderAt('/aid/season/rounds-budget')
    const bold = [...document.querySelectorAll('ol li b')].map((b) => b.textContent)
    expect(bold).toEqual([
      'Committed:',
      'Accepted',
      'Posted:',
      'Not yet confirmed:',
      'Needs an offer:',
      'Pending approval:',
    ])
  })
})
