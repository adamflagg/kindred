import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { householdPage } from '../../components/camperships/household/householdFixtures'
import { AidApiError } from '../../services/camperships/aidApi'
import type { ApiAidHouseholdPage } from '../../types/api-types'
import AidHouseholdPage from './AidHouseholdPage'

interface PageResult {
  data: ApiAidHouseholdPage | undefined
  isLoading: boolean
  error: Error | null
}
let result: PageResult
const asked: number[] = []
vi.mock('../../hooks/camperships/useAidHouseholdPage', () => ({
  useAidHouseholdPage: (id: number) => {
    asked.push(id)
    return result
  },
}))
const NOTES: Record<string, number> = { cost: 1, decided: 2, grants: 3, family_share: 4, posted: 5 }
vi.mock('../../hooks/camperships/useAidDefinitions', () => ({
  useAidDefinitions: () => ({
    notes: [],
    numberOf: (k: string) => NOTES[k] ?? null,
    isPending: false,
    error: null,
  }),
}))
vi.mock('../../components/camperships/shell/AidDefinitionNotes', () => ({
  AidDefinitionNotes: () => null,
}))
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => p === 'financial_aid.view' }),
}))
vi.mock('../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname + search}</div>
}

function renderAt(path: string, history: string[] = [], state: unknown = null) {
  return render(
    <MemoryRouter
      initialEntries={[
        ...history,
        {
          pathname: path.split('?')[0] ?? path,
          search: path.includes('?') ? `?${path.split('?')[1] ?? ''}` : '',
          state,
        },
      ]}
      initialIndex={history.length}
    >
      <Routes>
        <Route path="/aid/households/:householdCmId" element={<AidHouseholdPage />} />
        <Route path="/aid/requests" element={<Where />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  result = { data: householdPage(), isLoading: false, error: null }
  asked.length = 0
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-01T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('AidHouseholdPage (§6.3)', () => {
  it('names the family in the band, with the totals on its right (D77)', () => {
    renderAt('/aid/households/1000001')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The Johnson Family')
    expect(screen.getByText('$9,300')).toBeInTheDocument()
    expect(screen.getByText('posted · 1 short $210')).toBeInTheDocument()
    expect(asked).toContain(1000001)
  })

  it("shows each request's card", () => {
    renderAt('/aid/households/1000001')
    expect(screen.getAllByRole('table', { name: 'Decision panel' })).toHaveLength(2)
  })

  it('says a household has no aid activity this season, rather than spinning (Review Focus 3)', () => {
    result = { data: undefined, isLoading: false, error: new AidApiError('no aid activity', 404) }
    renderAt('/aid/households/1000009')
    expect(screen.getByText('No aid activity for household 1000009 in 2027.')).toBeInTheDocument()
    expect(screen.queryByText(/Loading/)).toBeNull()
  })

  it('reads nothing for an id that is not one, and says so', () => {
    result = { data: undefined, isLoading: false, error: null }
    renderAt('/aid/households/abc')
    expect(asked).toEqual([0])
    expect(screen.getByText('No aid activity for household abc in 2027.')).toBeInTheDocument()
  })

  it('is live only: a past date in the link gets a line saying so (Decision 36)', () => {
    renderAt('/aid/households/1000001?as_of=2027-03-01')
    expect(screen.getByText(/shows today's figures only/)).toBeInTheDocument()
    expect(screen.queryByText(/^As of Mar 1, 2027/)).toBeNull()
  })

  it('keeps showing what loaded when a background refetch fails (Decision 33)', () => {
    result = { data: householdPage(), isLoading: false, error: new Error('Network down') }
    renderAt('/aid/households/1000001')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The Johnson Family')
    expect(screen.queryByText(/Network down/)).toBeNull()
  })

  // Regression guard: passed against the first build too (no `from` means no link).
  it('has no way back when it was not opened from the grid', () => {
    renderAt('/aid/households/1000001?year=2027')
    expect(screen.queryByRole('link', { name: /Back to requests/ })).toBeNull()
  })

  it('links back to the grid view and filters it came from (fresh tab, no history)', async () => {
    renderAt('/aid/households/1000001?year=2027&from=approved&pool=pool_a&ids=1')
    await userEvent.click(screen.getByRole('link', { name: /Back to requests/ }))
    const where = new URL(String(screen.getByTestId('where').textContent), 'http://x')
    expect(where.pathname).toBe('/aid/requests')
    expect(Object.fromEntries(where.searchParams)).toEqual({
      view: 'approved',
      pool: 'pool_a',
      ids: '1',
      year: '2027',
    })
  })

  it('keeps the as-of of the view it came from in the fallback href', () => {
    renderAt('/aid/households/1000001?year=2027&from=all&as_of=2027-03-01')
    const href = screen.getByRole('link', { name: /Back to requests/ }).getAttribute('href') ?? ''
    expect(new URL(href, 'http://x').searchParams.get('as_of')).toBe('2027-03-01')
  })

  it('goes back through history when the grid opened it, so the grid lands on its row (§3.5)', async () => {
    renderAt(
      '/aid/households/1000001?year=2027&from=all',
      ['/aid/requests?view=all&row=req-7&year=2027'],
      { aidFromGrid: true }
    )
    await userEvent.click(screen.getByRole('link', { name: /Back to requests/ }))
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/requests?view=all&row=req-7&year=2027'
    )
  })

  it('follows the href, not history, when something else opened it (a queue step, a jump)', async () => {
    renderAt('/aid/households/1000001?year=2027&from=all', ['/aid/households/1000002?from=all'])
    await userEvent.click(screen.getByRole('link', { name: /Back to requests/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/requests?view=all&year=2027')
  })

  it('shows the income, the grants and postings, and the history below the cards', () => {
    renderAt('/aid/households/1000001')
    expect(screen.getByRole('heading', { name: 'Household income' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Grants and postings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'History' })).toBeInTheDocument()
  })
})
