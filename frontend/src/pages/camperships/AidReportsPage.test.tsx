/**
 * Reports' page (spec §9.1; D64, D65; owner Q7): four flat URL-held tabs and no views bar, where a
 * bare link lands for each role, and the as-of. The bodies are mocked: each has its own tests.
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
vi.mock('../../components/camperships/reports/YearOverYear', () => ({
  YearOverYear: () => <div>Year over year body</div>,
}))
vi.mock('../../components/camperships/reports/DevelopmentReport', () => ({
  DevelopmentReport: () => <div>Development report body</div>,
}))
vi.mock('../../components/camperships/reports/ZipCodes', () => ({
  ZipCodes: () => <div>ZIP codes body</div>,
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
        <Route path="/aid/reports/:tab?" element={<AidReportsPage />} />
        <Route path="/aid/reports/development/:view" element={<AidReportsPage />} />
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

  it('keeps the band and tabs for a summary-only user on Statistics, with a card pointing at Development', () => {
    granted = DEVELOPMENT
    renderAt('/aid/reports/statistics')
    expect(screen.getByText('Statistics needs view.')).toBeInTheDocument()
    expect(screen.queryByText('Statistics body')).toBeNull()
    expect(screen.queryByText('Permission denied')).toBeNull()
    expect(screen.getByRole('link', { name: 'Development' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Statistics' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Reports › Development ›' })).toHaveAttribute(
      'href',
      '/aid/reports/development?year=2027'
    )
  })

  it('names Year over year in the same card for a summary-only user', () => {
    granted = DEVELOPMENT
    renderAt('/aid/reports/year-over-year')
    expect(screen.getByText('Year over year needs view.')).toBeInTheDocument()
    expect(screen.queryByText('Year over year body')).toBeNull()
  })

  it('still refuses an unknown tab to a user with no Reports tabs', () => {
    granted = []
    renderAt('/aid/reports/nonsense')
    expect(screen.getByText('Permission denied')).toBeInTheDocument()
  })

  it('shows the four tabs in order and the Statistics body, with no views bar', () => {
    renderAt('/aid/reports/statistics')
    const names = ['Statistics', 'Year over year', 'Development', 'ZIP codes']
    const links = names.map((name) => screen.getByRole('link', { name }))
    for (let i = 1; i < links.length; i += 1) {
      expect(
        links[i - 1]!.compareDocumentPosition(links[i]!) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    }
    for (const name of names) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument()
    }
    expect(screen.queryByRole('link', { name: 'Programs' })).toBeNull()
    expect(screen.getByText('Statistics body')).toBeInTheDocument()
  })

  it('has no views bar on any tab', () => {
    for (const path of ['statistics', 'year-over-year', 'development', 'zip-codes']) {
      const { unmount } = renderAt(`/aid/reports/${path}`)
      expect(screen.queryByRole('link', { name: 'This season' })).toBeNull()
      expect(screen.queryByRole('link', { name: 'Report' })).toBeNull()
      unmount()
    }
  })

  it('renders Year over year on its own tab', () => {
    renderAt('/aid/reports/year-over-year')
    expect(screen.getByText('Year over year body')).toBeInTheDocument()
    expect(screen.queryByText('Statistics body')).toBeNull()
  })

  it('shows development the report on its own tab (D65)', () => {
    granted = DEVELOPMENT
    renderAt('/aid/reports/development')
    expect(screen.getByText('Development report body')).toBeInTheDocument()
  })

  it('names the Development band in its own words (D4)', () => {
    granted = DEVELOPMENT
    renderAt('/aid/reports/development')
    expect(screen.getByText('Development report')).toBeInTheDocument()
    expect(
      screen.getByText(/^Aid by season, for grant writing: numbers and quantities, never a family/)
    ).toBeInTheDocument()
  })

  it('gives a summary-only user Development and ZIP codes, nothing else (D65, D90)', () => {
    granted = DEVELOPMENT
    renderAt('/aid/reports/zip-codes')
    expect(screen.getByText('ZIP codes body')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Development' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ZIP codes' })).toBeInTheDocument()
    for (const name of ['Statistics', 'Year over year']) {
      expect(screen.queryByRole('link', { name })).toBeNull()
    }
  })

  it('names the ZIP codes band under the Development report title', () => {
    renderAt('/aid/reports/zip-codes')
    expect(screen.getByText('Development report')).toBeInTheDocument()
    expect(
      screen.getByText(/^Where 2027 campers live, by ZIP: counts and dollars, never a family/)
    ).toBeInTheDocument()
  })

  it('says Development and ZIP codes show today when the link carries a past date', () => {
    for (const path of ['development', 'zip-codes']) {
      const { unmount } = renderAt(`/aid/reports/${path}?as_of=2027-03-08`)
      expect(screen.getByText(/has no past date/)).toBeInTheDocument()
      unmount()
    }
  })

  it('sends an unknown tab to the first tab', () => {
    renderAt('/aid/reports/nonsense')
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/reports/statistics?year=2027')
  })

  it('says a live-only tab shows today when the link carries a past date', () => {
    renderAt('/aid/reports/year-over-year?as_of=2027-03-08')
    expect(screen.getByText('This view shows today: it has no past date.')).toBeInTheDocument()
    renderAt('/aid/reports/statistics?as_of=2027-03-08')
    expect(screen.getAllByText('This view shows today: it has no past date.')).toHaveLength(1)
  })
})
