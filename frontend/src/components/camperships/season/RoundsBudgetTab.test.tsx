/**
 * Season › Rounds & budget on screen (spec §7.2; D44, D53, D79, D153). The read and the notes are
 * mocked; the figures are budgetFixtures' invented season.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiAidBudget } from '../../../types/api-types'
import { BUDGET, pastBudget, pastBudgetUnmasked } from './budgetFixtures'
import { RoundsBudgetTab } from './RoundsBudgetTab'

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
const download = vi.fn<(content: string, name: string) => void>()
vi.mock('../../../utils/csvExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/csvExport')>()),
  downloadCsv: (content: string, name: string) => {
    download(content, name)
  },
}))

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

const line = (key: string) => {
  const row = document.querySelector(`[data-budget-row="${key}"]`)
  if (!(row instanceof HTMLElement)) throw new Error(`no line ${key}`)
  return row
}

const below = (key: string) => {
  const row = document.querySelector(`[data-below-line="${key}"]`)
  if (!(row instanceof HTMLElement)) throw new Error(`no below-the-line ${key}`)
  return row
}

const typeLine = (key: string) => {
  const row = document.querySelector(`[data-type-line="${key}"]`)
  if (!(row instanceof HTMLElement)) throw new Error(`no type line ${key}`)
  return row
}

const keys = (attribute: string) =>
  [...document.querySelectorAll(`[${attribute}]`)].map((el) => el.getAttribute(attribute))

beforeEach(() => {
  read = { data: BUDGET, isLoading: false, error: null }
  download.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-10T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('RoundsBudgetTab (spec §7.2)', () => {
  it("shows the strip's counts in Today's words, each opening its rows (D153)", () => {
    renderAt('/aid/season/rounds-budget')
    const strip = screen.getByTestId('budget-strip')
    expect(within(strip).getByRole('link', { name: '340 fam · 367 req' })).toHaveAttribute(
      'href',
      '/aid/requests?posted=1&counted=1&year=2027'
    )
    expect(within(strip).getByText('pending approval')).toBeInTheDocument()
    // Owner Q1 = A: no awaiting-sync or not-reconciled counts on the strip.
    expect(within(strip).queryByText(/awaiting sync|not reconciled/)).toBeNull()
  })

  it('shows each pool and its rounds, numbered by the definitions, and the total', () => {
    renderAt('/aid/season/rounds-budget')
    expect(screen.getByRole('columnheader', { name: 'Allocated1' })).toBeInTheDocument()
    expect(within(line('pool_a:1')).getByRole('link', { name: '$764,540' })).toHaveAttribute(
      'href',
      '/aid/requests?pool=pool_a&posted=1&counted=1&year=2027'
    )
    expect(within(line('total')).getByText('$194,890')).toBeInTheDocument()
  })

  it('words Needs an offer as "n · $X", the whole of it opening the rows (read 2)', () => {
    renderAt('/aid/season/rounds-budget')
    expect(within(line('pool_a:1')).getByRole('link', { name: '3 · $8,100' })).toHaveAttribute(
      'href',
      '/aid/requests?view=needs-offer&pool=pool_a&round=1&counted=1&year=2027'
    )
    expect(within(line('pool_a:3:pending')).getByText('1 · $650')).toBeInTheDocument()
    expect(
      within(line('pool_a:all')).getByText('and 1 · $650 pending approval')
    ).toBeInTheDocument()
  })

  it('leaves the Pending approval line blank outside Needs an offer, not "—" (Task 4 m1)', () => {
    renderAt('/aid/season/rounds-budget')
    const pending = line('pool_a:3:pending')
    expect(within(pending).queryByText('—')).toBeNull()
    expect(
      within(pending)
        .getAllByRole('cell')
        .map((c) => c.textContent)
    ).toEqual(['Pending approval', '', '', '', '1 · $650', ''])
  })

  it('folds a pool in the URL, replacing rather than pushing (D15)', async () => {
    vi.useRealTimers()
    renderAt('/aid/season/rounds-budget?year=2027')
    expect(screen.getByTestId('where')).toHaveAttribute('data-nav', 'POP')
    await userEvent.click(screen.getByRole('button', { name: '▾ Pool A' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?year=2027&fold=pool_a')
    expect(screen.getByTestId('where')).toHaveAttribute('data-nav', 'REPLACE')
    expect(document.querySelector('[data-budget-row="pool_a:1"]')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '▸ Pool A' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?year=2027')
    expect(screen.getByTestId('where')).not.toHaveTextContent('fold')
  })

  it("opens on one pool from the Remaining line, with that pool's own below-the-line (D48)", () => {
    renderAt('/aid/season/rounds-budget?pool=pool_b&year=2027')
    expect(line('pool_b:all')).toBeInTheDocument()
    expect(document.querySelector('[data-budget-row="pool_a:all"]')).toBeNull()
    expect(screen.getByRole('link', { name: 'All Pools ›' })).toHaveAttribute(
      'href',
      '/aid/season/rounds-budget?year=2027'
    )
    expect(document.querySelector('[data-budget-row="total"]')).toBeNull()
    expect(keys('data-below-line')).toEqual(['grants', 'held'])
  })

  it('labels the strip as the whole season when the page is on one pool (Task 4 I1)', () => {
    const first = renderAt('/aid/season/rounds-budget?pool=pool_b&year=2027')
    const strip = screen.getByTestId('budget-strip')
    expect(within(strip).getByText('All pools · the whole season')).toBeInTheDocument()
    // The figures are still the season's: Round 1 posted is every pool's.
    expect(within(strip).getByRole('link', { name: '340 fam · 367 req' })).toBeInTheDocument()
    first.unmount()
    renderAt('/aid/season/rounds-budget')
    expect(
      within(screen.getByTestId('budget-strip')).queryByText('All pools · the whole season')
    ).toBeNull()
  })

  it('on a past date, opens no queue view from its figures, and keeps the date on Posted (final review I1)', () => {
    read = { data: pastBudgetUnmasked(), isLoading: false, error: null }
    renderAt('/aid/season/rounds-budget?as_of=2027-03-15')
    const round1 = within(screen.getByTestId('budget-strip')).getByText('Round 1').parentElement
    if (round1 === null) throw new Error('no Round 1 line')
    // Round 1: needs an offer 3 · 3 and held 6 · 9 show, and open nothing; posted still opens.
    expect(within(round1).getByText('3 fam · 3 req')).toBeInTheDocument()
    expect(within(round1).queryByRole('link', { name: '3 fam · 3 req' })).toBeNull()
    expect(within(round1).getByText('6 fam · 9 req')).toBeInTheDocument()
    expect(within(round1).queryByRole('link', { name: '6 fam · 9 req' })).toBeNull()
    expect(within(round1).getByRole('link', { name: '340 fam · 367 req' })).toBeInTheDocument()
    expect(within(line('pool_a:1')).getByText('3 · $8,100')).toBeInTheDocument()
    expect(within(line('pool_a:1')).queryByRole('link', { name: '3 · $8,100' })).toBeNull()
    expect(within(below('held')).queryByRole('link')).toBeNull()
    expect(within(line('pool_a:1')).getByRole('link', { name: '$764,540' })).toHaveAttribute(
      'href',
      '/aid/requests?pool=pool_a&posted=1&counted=1&year=2027&as_of=2027-03-15'
    )
  })

  it('says so when the link names a pool this season has none of', () => {
    renderAt('/aid/season/rounds-budget?pool=pool_zz')
    expect(screen.getByText(/No pool "pool_zz" in 2027's budget/)).toBeInTheDocument()
  })

  it('keeps a past date on "All Pools ›", from an unknown pool and from one pool (Task 4 m5)', () => {
    const first = renderAt('/aid/season/rounds-budget?pool=pool_zz&as_of=2027-03-15')
    expect(screen.getByRole('link', { name: 'All Pools ›' })).toHaveAttribute(
      'href',
      '/aid/season/rounds-budget?year=2027&as_of=2027-03-15'
    )
    first.unmount()
    read = { data: pastBudget(), isLoading: false, error: null }
    renderAt('/aid/season/rounds-budget?pool=pool_b&as_of=2027-03-15')
    expect(screen.getByRole('link', { name: 'All Pools ›' })).toHaveAttribute(
      'href',
      '/aid/season/rounds-budget?year=2027&as_of=2027-03-15'
    )
  })

  it('says a past date shows what the dashboard can rebuild, in staff words', () => {
    read = { data: pastBudget(), isLoading: false, error: null }
    renderAt('/aid/season/rounds-budget?as_of=2027-03-15')
    expect(
      screen.getByText(/A past date shows what the dashboard can rebuild exactly/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/Kindred/)).toBeNull()
  })

  it('shows below the line: outside grants, decision types outside the budget, held requests', () => {
    renderAt('/aid/season/rounds-budget')
    expect(keys('data-below-line')).toEqual([
      'grants',
      'grants_off_requests',
      'outside_type:outside',
      'held',
    ])
    const grants = below('grants')
    expect(grants).toHaveTextContent('Outside grants on requests (14 fam · 16 req)')
    expect(within(grants).getByText('$44,300')).toBeInTheDocument()
    expect(within(below('grants_off_requests')).getByText('$5,400')).toBeInTheDocument()
    const outside = below('outside_type:outside')
    expect(outside).toHaveTextContent('Funded outside the budget (9 fam · 10 req)')
    expect(within(outside).getByText('$21,840')).toBeInTheDocument()
    expect(outside).toHaveTextContent('$21,840 of it posted')
    const held = below('held')
    expect(within(held).getByRole('link', { name: '7 fam · 10 req' })).toHaveAttribute(
      'href',
      '/aid/requests?view=holds&year=2027'
    )
    expect(within(held).getByText(/amount unknown until resolved/)).toBeInTheDocument()
  })

  it("shows the budget by decision type, leading with the type's own money (owner ⚠2; final review ⚠1)", () => {
    renderAt('/aid/season/rounds-budget')
    expect(screen.getByText('In the budget, by decision type')).toBeInTheDocument()
    // Scoped to this block's table: the forward-demand table also has a Requests column.
    const block = typeLine('type:standard').closest('table')
    if (block === null) throw new Error('no type table')
    for (const name of ['Decision type', 'Requests', 'Own money', 'Rounds total']) {
      expect(within(block).getByRole('columnheader', { name })).toBeInTheDocument()
    }
    expect(keys('data-type-line')).toEqual(['type:standard', 'type:appeal', 'type:none'])
    const standard = typeLine('type:standard')
    expect(
      within(standard)
        .getAllByRole('cell')
        .map((c) => c.textContent)
    ).toEqual(['Standard award', '324 fam · 345 req', '$14,400', '$751,970'])
    expect(standard).not.toHaveTextContent('in rounds totalling')
    expect(
      within(typeLine('type:appeal'))
        .getAllByRole('cell')
        .map((c) => c.textContent)
    ).toEqual(['Appeal', '40 fam · 44 req', '$4,200', '$95,540'])
    const none = typeLine('type:none')
    expect(
      within(none)
        .getAllByRole('cell')
        .map((c) => c.textContent)
    ).toEqual(['No named decision type', '1 fam · 1 req', '$0', '$1,200'])
    // The outside-budget type is below the line, not in this block.
    expect(document.querySelector('[data-type-line="type:outside"]')).toBeNull()
  })

  it('scopes the decision types to one pool, and shows no block when it has none', () => {
    renderAt('/aid/season/rounds-budget?pool=pool_b')
    expect(keys('data-type-line')).toEqual(['type:standard'])
    expect(
      within(typeLine('type:standard'))
        .getAllByRole('cell')
        .map((c) => c.textContent)
    ).toEqual(['Standard award', '24 fam · 25 req', '$2,400', '$52,400'])
  })

  it('shows no decision-type block when the read has no lines', () => {
    read = {
      data: { ...BUDGET, pools: BUDGET.pools.map((p) => ({ ...p, decision_types: [] })) },
      isLoading: false,
      error: null,
    }
    renderAt('/aid/season/rounds-budget?pool=pool_b')
    expect(screen.queryByText('In the budget, by decision type')).toBeNull()
  })

  it('reads "—" for what a past date leaves empty, and says it never estimates', () => {
    read = { data: pastBudget(), isLoading: false, error: null }
    renderAt('/aid/season/rounds-budget?as_of=2027-03-15')
    expect(screen.getByText(/never an estimate/)).toBeInTheDocument()
    expect(within(line('total')).getAllByText('—').length).toBeGreaterThan(0)
    const standard = typeLine('type:standard')
    // Requests, Own money and Rounds total: the past date masks all three.
    expect(within(standard).getAllByText('—')).toHaveLength(3)
    // The server keeps `posted`, so an outside type reads "—" with its posted note.
    const outside = below('outside_type:outside')
    expect(within(outside).getByText('—')).toBeInTheDocument()
    expect(outside).toHaveTextContent('$21,840 of it posted')
  })

  it('says when no approved rules price the season yet', () => {
    read = { data: { ...BUDGET, rules_version: null }, isLoading: false, error: null }
    renderAt('/aid/season/rounds-budget')
    expect(screen.getByText(/No approved rules price 2027 yet/)).toBeInTheDocument()
  })

  it('keeps what loaded when a background refetch fails (owner ruling Group 5)', () => {
    read = { data: BUDGET, isLoading: false, error: new Error('Failed to load Rounds & budget') }
    renderAt('/aid/season/rounds-budget')
    expect(screen.queryByText(/Failed to load/)).toBeNull()
    expect(line('total')).toBeInTheDocument()
  })

  it("downloads the table's lines on screen, named per D70 (Task 4 m3)", async () => {
    vi.useRealTimers()
    renderAt('/aid/season/rounds-budget?pool=pool_b')
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    const [content, name] = download.mock.calls[0] ?? ['', '']
    expect(name).toBe('camperships-season-rounds-budget-pool-b-2027.csv')
    // The table's lines on screen, and only those: no other pool, no total, no below-the-line.
    expect(content.split('\n')).toEqual([
      'Pool,Round,Allocated,Posted,Accepted,Needs an offer,Needs an offer requests,Pending approval,Pending approval requests,Remaining',
      'Pool B,,93600,52400,40000,0,0,0,0,41200',
      'Pool B,1,93600,52400,40000,0,0,0,0,41200',
      'Pool B,2,0,0,0,0,0,0,0,0',
      'Pool B,3,0,0,0,0,0,0,0,0',
      '',
      `Link,${window.location.href}`,
    ])
  })
})

const demandLine = (key: string) => {
  const row = document.querySelector(`[data-demand-line="${key}"]`)
  if (!(row instanceof HTMLElement)) throw new Error(`no demand line ${key}`)
  return row
}

describe('forward demand below the line (D82)', () => {
  it("shows each pool's Round 2 asks, the count opening its live appeals, with the held column", () => {
    renderAt('/aid/season/rounds-budget')
    const asks = demandLine('pool_a:round2_asks')
    expect(within(asks).getByRole('link', { name: '30 fam · 31 req' })).toHaveAttribute(
      'href',
      '/aid/requests?view=appeals&pool=pool_a&live=1&year=2027'
    )
    expect(within(asks).getByText('$33,000')).toBeInTheDocument()
    expect(within(asks).getByText('$20,500')).toBeInTheDocument()
    // Unmet ask stays empty: Asked counts held appeals' asks and Computed leaves them out.
    expect(
      within(asks)
        .getAllByRole('cell')
        .map((c) => c.textContent)
    ).toEqual([
      'Round 2 asks so far8',
      '30 fam · 31 req',
      '$33,000',
      '$20,500',
      '—',
      '2 fam · 2 req · $2,600',
    ])
  })

  it("shows Round 1's unmet ask with its count, opening nothing", () => {
    renderAt('/aid/season/rounds-budget')
    const unmet = demandLine('pool_a:round1_unmet')
    expect(within(unmet).getByText('40 fam · 44 req')).toBeInTheDocument()
    expect(within(unmet).queryByRole('link')).toBeNull()
    expect(within(unmet).getByText('$50,920')).toBeInTheDocument()
    expect(within(unmet).getByText('4 fam · 7 req · $16,300')).toBeInTheDocument()
    expect(within(unmet).getAllByRole('cell')[0]).toHaveTextContent(
      'Round 1 unmet ask, not yet appealed9'
    )
  })

  it('reads "—" and opens nothing for what a past date leaves empty', () => {
    read = { data: pastBudget(), isLoading: false, error: null }
    renderAt('/aid/season/rounds-budget?as_of=2027-03-15')
    const asks = demandLine('pool_a:round2_asks')
    expect(within(asks).getByText('30 fam · 31 req')).toBeInTheDocument()
    expect(within(asks).queryByRole('link')).toBeNull()
    expect(
      within(demandLine('pool_a:round1_unmet'))
        .getAllByRole('cell')
        .map((c) => c.textContent)
    ).toEqual(['Round 1 unmet ask, not yet appealed9', '—', '—', '—', '—', '—'])
  })

  it('shows one pool alone when the page is on it', () => {
    renderAt('/aid/season/rounds-budget?pool=pool_b')
    expect(keys('data-demand-line')).toEqual(['pool_b:round2_asks', 'pool_b:round1_unmet'])
  })
})

describe('the confirmed share under Posted (D153; Decision 10)', () => {
  it("shows the amber line under a round's Posted, opening Not reconciled on its pool", () => {
    renderAt('/aid/season/rounds-budget')
    const r1 = line('pool_a:1')
    expect(within(r1).getByRole('link', { name: '4 not yet confirmed · $5,200' })).toHaveAttribute(
      'href',
      '/aid/requests?view=not-reconciled&pool=pool_a&round=1&tick=posted&counted=1&year=2027'
    )
    expect(r1).toHaveTextContent('4 not yet confirmed · $5,200')
    expect(
      within(line('total')).getByRole('link', { name: '6 not yet confirmed · $7,000' })
    ).toHaveAttribute('href', '/aid/requests?view=not-reconciled&tick=posted&counted=1&year=2027')
    expect(within(r1).getByText('10', { selector: 'sup' })).toBeInTheDocument()
  })

  it('shows no line where the server sends none, and no interim sentence', () => {
    renderAt('/aid/season/rounds-budget')
    expect(within(line('pool_a:3')).queryByText(/not yet confirmed/)).toBeNull()
    expect(screen.queryByTestId('confirmation-line')).toBeNull()
  })

  it('shows the line without a link on a past date, where Not reconciled is refused', () => {
    read = { data: pastBudgetUnmasked(), isLoading: false, error: null }
    renderAt('/aid/season/rounds-budget?as_of=2027-03-15')
    const r1 = line('pool_a:1')
    expect(r1).toHaveTextContent('4 not yet confirmed · $5,200')
    expect(within(r1).queryByRole('link', { name: /not yet confirmed/ })).toBeNull()
  })
})
