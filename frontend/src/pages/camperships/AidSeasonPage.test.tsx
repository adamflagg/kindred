/**
 * Season's page (spec §7; D44, D76): its URL-held tabs, who sees which, and the as-of only on
 * Rounds & budget. The tabs' own bodies are mocked: each has its own tests.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BUDGET } from '../../components/camperships/season/budgetFixtures'
import AidSeasonPage from './AidSeasonPage'

let granted: string[] = []
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
vi.mock('../PermissionDeniedPage', () => ({ default: () => <div>Permission denied</div> }))
vi.mock('../../hooks/camperships/useAidBudget', () => ({
  useAidBudget: ({ enabled = true }: { enabled?: boolean } = {}) => ({
    data: enabled ? BUDGET : undefined,
    isLoading: false,
    error: null,
  }),
}))
vi.mock('../../components/camperships/season/RoundsBudgetTab', () => ({
  RoundsBudgetTab: () => <div>Rounds and budget body</div>,
}))

const REGISTRAR = ['financial_aid.view', 'financial_aid.casework']
const FINANCE = [...REGISTRAR, 'financial_aid.rules']

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname + search}</div>
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
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-10T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('AidSeasonPage (spec §7; D44, D76)', () => {
  it('opens on Rounds & budget, keeping the season and the as-of', () => {
    renderAt('/aid/season?as_of=2027-03-15')
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/season/rounds-budget?year=2027&as_of=2027-03-15'
    )
  })

  it("shows Rounds & budget's body, its Allocated and rules version, and the as-of pill", () => {
    renderAt('/aid/season/rounds-budget?as_of=2027-03-15')
    expect(screen.getByText('Rounds and budget body')).toBeInTheDocument()
    expect(screen.getByText('$1,043,600')).toBeInTheDocument()
    expect(screen.getByText('priced by rules v3')).toBeInTheDocument()
    expect(screen.getByText('As of Mar 15, 2027')).toBeInTheDocument()
  })

  it('hides Scenarios from the registrar and refuses its link (D76)', () => {
    const first = renderAt('/aid/season/history')
    expect(screen.queryByRole('link', { name: 'Scenarios' })).toBeNull()
    first.unmount()
    renderAt('/aid/season/scenarios')
    expect(screen.getByText('Permission denied')).toBeInTheDocument()
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

  it('says History waits for its server read, pointing finance at the scenario trail', () => {
    const first = renderAt('/aid/season/history')
    expect(screen.getByText("The season's log isn't built yet.")).toBeInTheDocument()
    expect(screen.queryByText(/Scenarios › Trail/)).toBeNull()
    first.unmount()
    granted = FINANCE
    renderAt('/aid/season/history')
    expect(screen.getByText(/Scenarios › Trail/)).toBeInTheDocument()
  })
})
