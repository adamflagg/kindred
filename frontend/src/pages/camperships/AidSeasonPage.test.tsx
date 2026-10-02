/**
 * Season's page (spec §7; D44, D76): its URL-held tabs, who sees which, and the as-of pill on every
 * tab while the date is past (only Rounds & budget shows that date; I6). The tabs' own bodies are
 * mocked: each has its own tests.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BUDGET } from '../../components/camperships/season/budgetFixtures'
import type { ApiAidBudget } from '../../types/api-types'
import AidSeasonPage from './AidSeasonPage'

let granted: string[] = []
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
vi.mock('../PermissionDeniedPage', () => ({ default: () => <div>Permission denied</div> }))
// A warm cache: the read returns its data whether or not a caller enables it (Task 5 m2).
let budget: ApiAidBudget = BUDGET
vi.mock('../../hooks/camperships/useAidBudget', () => ({
  useAidBudget: () => ({ data: budget, isLoading: false, error: null }),
}))
vi.mock('../../components/camperships/season/RoundsBudgetTab', () => ({
  RoundsBudgetTab: () => <div>Rounds and budget body</div>,
}))
vi.mock('../../components/camperships/season/HistoryTab', () => ({
  HistoryTab: () => <div>History body</div>,
}))
vi.mock('../../components/camperships/season/rules/RulesTab', () => ({
  RulesTab: () => <div>Rules tab body</div>,
}))

const REGISTRAR = ['financial_aid.view', 'financial_aid.casework']
const FINANCE = [...REGISTRAR, 'financial_aid.rules']

function Where() {
  const { pathname, search } = useLocation()
  const navigation = useNavigationType()
  return (
    <div data-testid="where" data-nav={navigation}>
      {pathname + search}
    </div>
  )
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/aid/season/:tab?" element={<AidSeasonPage />} />
      </Routes>
      <Where />
    </MemoryRouter>
  )
}

beforeEach(() => {
  granted = REGISTRAR
  budget = BUDGET
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-10T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('AidSeasonPage (spec §7; D44, D76)', () => {
  it('opens on Rounds & budget, keeping the season and the as-of, replacing the bare URL', () => {
    renderAt('/aid/season?as_of=2027-03-15')
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/season/rounds-budget?year=2027&as_of=2027-03-15'
    )
    // Back must not bounce through the redirect (Task 5 m4).
    expect(screen.getByTestId('where')).toHaveAttribute('data-nav', 'REPLACE')
  })

  it("shows Rounds & budget's body, its Allocated and rules version, and the as-of pill", () => {
    renderAt('/aid/season/rounds-budget?as_of=2027-03-15')
    expect(screen.getByText('Rounds and budget body')).toBeInTheDocument()
    expect(screen.getByText('$1,043,600')).toBeInTheDocument()
    expect(screen.getByText('priced by rules v3')).toBeInTheDocument()
    expect(screen.getByText('As of Mar 15, 2027')).toBeInTheDocument()
  })

  it('says "no approved rules yet" in the band when no version prices the season (Task 5 m5)', () => {
    budget = { ...BUDGET, rules_version: null }
    renderAt('/aid/season/rounds-budget')
    expect(screen.getByText('no approved rules yet')).toBeInTheDocument()
    expect(screen.queryByText(/priced by rules/)).toBeNull()
  })

  it("shows the band's Allocated on Rounds & budget only, even with the read cached (Task 5 m2)", () => {
    renderAt('/aid/season/history')
    expect(screen.queryByText('$1,043,600')).toBeNull()
    expect(screen.queryByText(/priced by rules/)).toBeNull()
  })

  it('hides Scenarios from the registrar and refuses its link (D76)', () => {
    const first = renderAt('/aid/season/history')
    expect(screen.queryByRole('link', { name: 'Scenarios' })).toBeNull()
    first.unmount()
    renderAt('/aid/season/scenarios')
    expect(screen.getByText('Permission denied')).toBeInTheDocument()
  })

  it("mounts the Rules tab's body at /aid/season/rules (Task 11 m5)", () => {
    renderAt('/aid/season/rules')
    expect(screen.getByText('Rules tab body')).toBeInTheDocument()
  })

  it('shows finance every tab', () => {
    granted = FINANCE
    renderAt('/aid/season/history')
    for (const name of ['Rounds & budget', 'Scenarios', 'Rules', 'History']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument()
    }
  })

  it('says only Rounds & budget can show a past date, and keeps the as-of pill, which covers the Remaining line', () => {
    renderAt('/aid/season/history?as_of=2027-03-15')
    expect(
      screen.getByText('This tab shows today. Rounds & budget can show Mar 15, 2027.')
    ).toBeInTheDocument()
    expect(screen.getByText('As of Mar 15, 2027')).toBeInTheDocument()
  })

  // A regression guard: the mock ignores props, so this passes before the real tab lands. It pins
  // that the page mounts History's body on its tab for both readers (the interim is retired).
  it("mounts History's body on its tab, for the registrar and for finance (D49, D76)", () => {
    const first = renderAt('/aid/season/history')
    expect(screen.getByText('History body')).toBeInTheDocument()
    first.unmount()
    granted = FINANCE
    renderAt('/aid/season/history')
    expect(screen.getByText('History body')).toBeInTheDocument()
  })
})
