import { render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AidHome from './AidHome'
import AidSectionPage from './AidSectionPage'

let granted: string[] = []
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
vi.mock('../PermissionDeniedPage', () => ({ default: () => <div>Permission denied</div> }))

const REGISTRAR = ['financial_aid.view', 'financial_aid.casework']
const FINANCE = [...REGISTRAR, 'financial_aid.rules', 'financial_aid.summary']

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname + search}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/aid"
          element={
            <>
              <Outlet />
              <Where />
            </>
          }
        >
          <Route index element={<AidHome />} />
          <Route path="requests" element={<AidSectionPage section="requests" />} />
          <Route path="season/:tab?" element={<AidSectionPage section="season" />} />
          <Route path="reports/:tab?" element={<AidSectionPage section="reports" />} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  granted = REGISTRAR
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('AidSectionPage before its slice lands (Decision 4)', () => {
  it('opens a tabbed section on its first tab this user may see', () => {
    renderAt('/aid/season')
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/season/rounds-budget')
    expect(
      screen.getByText('Season › Rounds & budget is built in slice 2 (January).')
    ).toBeInTheDocument()
  })

  it('keeps the season and the as-of when it picks the first tab (D15, Decision 9)', () => {
    renderAt('/aid/season?as_of=2026-04-01')
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/season/rounds-budget?year=2027&as_of=2026-04-01'
    )
  })

  it('sends an unknown tab to the first one', () => {
    renderAt('/aid/season/bogus')
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/season/rounds-budget')
  })

  it('refuses a tab this user may not see, rather than redirecting it away (D76)', () => {
    renderAt('/aid/season/scenarios')
    expect(screen.getByText('Permission denied')).toBeInTheDocument()
  })

  it('shows finance the Scenarios tab', () => {
    granted = FINANCE
    renderAt('/aid/season/scenarios')
    expect(screen.getByRole('link', { name: 'Scenarios' })).toBeInTheDocument()
  })

  it('opens Reports on Development, alone, for a summary-only user (D65)', () => {
    granted = ['financial_aid.summary']
    renderAt('/aid/reports')
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/reports/development')
    expect(screen.queryByRole('link', { name: 'Statistics' })).toBeNull()
  })

  it('dates a money page and leaves Today, a page of counts, undated (D20)', () => {
    renderAt('/aid/requests')
    expect(screen.getByText('Season 2027 · as of Oct 1 (live)')).toBeInTheDocument()
  })
})

describe('AidHome', () => {
  it('is Today for a view holder, with no as-of', () => {
    renderAt('/aid')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Today')
    expect(screen.queryByText(/as of/)).toBeNull()
  })

  it('lands a summary-only user on Reports › Development (D65)', () => {
    granted = ['financial_aid.summary']
    renderAt('/aid')
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/reports/development')
  })
})
