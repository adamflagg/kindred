/**
 * Reports' page (spec §9.1; D64, D65; slice 4 Decision 1): its URL-held tabs and views, where a bare
 * link lands for each role, and the as-of. The bodies are mocked: each has its own tests.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AidReportsPage from './AidReportsPage'

let granted: string[] = []
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
vi.mock('../PermissionDeniedPage', () => ({ default: () => <div>Permission denied</div> }))
vi.mock('../../components/camperships/reports/StatisticsTab', () => ({
  StatisticsTab: () => <div>Statistics body</div>,
}))
vi.mock('../../components/camperships/reports/ProgramsTab', () => ({
  ProgramsTab: () => <div>Programs body</div>,
}))
vi.mock('../../components/camperships/reports/YearOverYear', () => ({
  YearOverYear: () => <div>Year over year body</div>,
}))

const FINANCE = ['financial_aid.view', 'financial_aid.casework', 'financial_aid.rules']
const DEVELOPMENT = [
  'financial_aid.summary',
  'financial_aid.funding_sources',
  'financial_aid.grantors',
]

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname + search}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/aid/reports/:tab?/:view?" element={<AidReportsPage />} />
      </Routes>
      <Where />
    </MemoryRouter>
  )
}

beforeEach(() => {
  granted = FINANCE
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-10T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('AidReportsPage (spec §9.1; D64, D65)', () => {
  it('opens view holders on Statistics, keeping the season and the as-of', () => {
    renderAt('/aid/reports?as_of=2027-03-08')
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/reports/statistics?year=2027&as_of=2027-03-08'
    )
  })

  it('opens a summary-only user on Development, the only tab they see (D65)', () => {
    granted = DEVELOPMENT
    renderAt('/aid/reports')
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/reports/development?year=2027')
  })

  it('refuses Statistics and Programs to a summary-only user, never redirecting them away (D65, D76)', () => {
    granted = DEVELOPMENT
    renderAt('/aid/reports/statistics')
    expect(screen.getByText('Permission denied')).toBeInTheDocument()
    expect(screen.queryByText('Statistics body')).toBeNull()
    renderAt('/aid/reports/statistics/year-over-year')
    expect(screen.getAllByText('Permission denied')).toHaveLength(2)
  })

  it("shows the three tabs, Statistics' two views and its body (S4-2)", () => {
    renderAt('/aid/reports/statistics')
    for (const name of ['Statistics', 'Programs', 'Development']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: 'This season' })).toHaveAttribute(
      'href',
      '/aid/reports/statistics?year=2027'
    )
    expect(screen.getByRole('link', { name: 'Year over year' })).toHaveAttribute(
      'href',
      '/aid/reports/statistics/year-over-year?year=2027'
    )
    expect(screen.getByText('Statistics body')).toBeInTheDocument()
  })

  it("shows Year over year as Statistics' second view, and Programs on its tab", () => {
    renderAt('/aid/reports/statistics/year-over-year')
    expect(screen.getByText('Year over year body')).toBeInTheDocument()
    renderAt('/aid/reports/programs')
    expect(screen.getByText('Programs body')).toBeInTheDocument()
  })

  it('gives development the report and ZIP codes, and no held view (owner 10-08)', () => {
    granted = DEVELOPMENT
    renderAt('/aid/reports/development')
    for (const name of ['Report', 'ZIP codes']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument()
    }
    expect(screen.queryByRole('link', { name: 'Funding sources' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Grantors' })).toBeNull()
  })

  it('sends an unknown or held view back to its tab', () => {
    renderAt('/aid/reports/statistics/nonsense')
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/reports/statistics?year=2027')
  })

  it('says a live-only view shows today when the link carries a past date', () => {
    renderAt('/aid/reports/statistics/year-over-year?as_of=2027-03-08')
    expect(screen.getByText('This view shows today: it has no past date.')).toBeInTheDocument()
    renderAt('/aid/reports/statistics?as_of=2027-03-08')
    expect(screen.getAllByText('This view shows today: it has no past date.')).toHaveLength(1)
  })
})
