/**
 * Money's page (spec §8.1; D58, D62): its URL-held tabs, where a bare link lands, and the as-of.
 * The tabs' bodies are mocked: each has its own tests.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AidMoneyPage from './AidMoneyPage'

let granted: string[] = []
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
vi.mock('../PermissionDeniedPage', () => ({ default: () => <div>Permission denied</div> }))
// What the page hands To place: its scope (`?household=`, P-8).
const toPlaceProps = vi.fn()
vi.mock('../../components/camperships/money/ToPlaceTab', () => ({
  ToPlaceTab: (props: unknown) => {
    toPlaceProps(props)
    return <div>To place body</div>
  },
}))

vi.mock('../../components/camperships/money/LedgerTab', () => ({
  LedgerTab: () => <div>Ledger body</div>,
}))
// Until M3 builds Funders, the funders slug shows Sources with the Grantors directory under it.
vi.mock('../../components/camperships/money/SourcesTab', () => ({
  SourcesTab: () => <div>Sources body</div>,
}))
vi.mock('../../components/camperships/grants/GrantorsDirectory', () => ({
  GrantorsDirectory: () => <div>Grantors body</div>,
}))
vi.mock('../../components/camperships/shell/AidDefinitionNotes', () => ({
  AidDefinitionNotes: () => null,
}))
vi.mock('../../components/camperships/grants/RegisterTab', () => ({
  RegisterTab: () => <div>Register body</div>,
}))

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname + search}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/aid/money/:tab?" element={<AidMoneyPage />} />
      </Routes>
      <Where />
    </MemoryRouter>
  )
}

beforeEach(() => {
  granted = ['financial_aid.view', 'financial_aid.casework']
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-06-03T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const DEVELOPMENT = [
  'financial_aid.summary',
  'financial_aid.funding_sources',
  'financial_aid.grantors',
]

describe('AidMoneyPage (spec §8.1; D62; owner 10-08)', () => {
  it('opens on the Ledger for a view holder, keeping the season and the as-of', () => {
    renderAt('/aid/money?as_of=2027-05-01')
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/money/ledger?year=2027&as_of=2027-05-01'
    )
  })

  it('sends an unknown tab to the first visible one too', () => {
    renderAt('/aid/money/bogus')
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/money/ledger?year=2027')
  })

  it('opens on Funders for development, who see that one tab and nothing else', () => {
    granted = DEVELOPMENT
    renderAt('/aid/money')
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/money/funders?year=2027')
    expect(screen.getByText('Sources body')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Funders' })).toBeInTheDocument()
    for (const name of ['Ledger', 'To place', 'Grants']) {
      expect(screen.queryByRole('link', { name })).toBeNull()
    }
  })

  it('refuses development the tabs that need view', () => {
    granted = DEVELOPMENT
    for (const slug of ['ledger', 'to-place', 'grants']) {
      const { unmount } = renderAt(`/aid/money/${slug}`)
      expect(screen.getByText('Permission denied')).toBeInTheDocument()
      unmount()
    }
  })

  it('shows the four tabs in order, and To place’s body on its tab', () => {
    renderAt('/aid/money/to-place')
    const nav = screen.getAllByRole('link').map((a) => a.textContent)
    expect(nav).toEqual(['Ledger', 'To place', 'Grants', 'Funders'])
    expect(screen.getByText('To place body')).toBeInTheDocument()
  })

  it('drops the purpose line and the "Also raised by the ledger" paragraph (visual true-up)', () => {
    for (const slug of ['ledger', 'to-place', 'grants', 'funders']) {
      const { unmount } = renderAt(`/aid/money/${slug}`)
      expect(screen.queryByText(/^Also raised by the ledger/)).toBeNull()
      expect(screen.queryByRole('link', { name: /^Requests ›/ })).toBeNull()
      expect(screen.queryByRole('link', { name: 'Grants › Needs attention' })).toBeNull()
      expect(screen.queryByText(/One row per family, plus finance/)).toBeNull()
      expect(screen.queryByText(/CampMinder aid lines that no single request explains/)).toBeNull()
      unmount()
    }
  })

  it('says To place shows today when the link carries a past date, and keeps the pill', () => {
    renderAt('/aid/money/to-place?as_of=2027-05-01')
    expect(
      screen.getByText('This tab shows today. Money › Ledger can show May 1, 2027.')
    ).toBeInTheDocument()
    expect(screen.getByText('As of May 1, 2027')).toBeInTheDocument()
  })

  it('shows the Ledger on a past date with no "shows today" line: its totals read that day', () => {
    renderAt('/aid/money/ledger?as_of=2027-05-01')
    expect(screen.getByText('Ledger body')).toBeInTheDocument()
    expect(screen.queryByText(/This tab shows today/)).toBeNull()
  })

  it('mounts the Register on the Grants tab, with its own past-date note (P-18)', () => {
    renderAt('/aid/money/grants?as_of=2027-05-01')
    expect(screen.getByText('Register body')).toBeInTheDocument()
    expect(screen.getByText('Grants shows today: it has no past date.')).toBeInTheDocument()
    expect(screen.queryByText(/Money › Ledger can show/)).toBeNull()
  })

  it('shows no past-date note on Grants for a live view', () => {
    renderAt('/aid/money/grants')
    expect(screen.queryByText(/has no past date/)).toBeNull()
  })

  it('mounts Sources with the Grantors directory under it on the Funders tab (until M3)', () => {
    renderAt('/aid/money/funders')
    expect(screen.getByText('Sources body')).toBeInTheDocument()
    expect(screen.getByText('Grantors body')).toBeInTheDocument()
  })

  it('aliases the old sources tab to funders, keeping the query string', () => {
    renderAt('/aid/money/sources?row=s1000001&year=2027')
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/money/funders?row=s1000001&year=2027'
    )
  })
})

describe('the Money band subtitle (coordinator 2026-10-08)', () => {
  it.each(['ledger', 'to-place', 'grants', 'funders'])('is neutral on the %s tab', (slug) => {
    renderAt(`/aid/money/${slug}`)
    expect(screen.getByText(/^Season 2027 · what CampMinder posted(?! that)/)).toBeInTheDocument()
    expect(screen.queryByText(/that no request explains/)).toBeNull()
  })
})

describe("one family's To place (P-8; ruling C)", () => {
  it('hands To place the household in `?household=`, and every family without one', () => {
    renderAt('/aid/money/to-place?household=1000001&year=2027')
    expect(toPlaceProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ householdCmId: 1000001 })
    )
    toPlaceProps.mockClear()
    renderAt('/aid/money/to-place?household=junk')
    expect(toPlaceProps).toHaveBeenLastCalledWith(expect.objectContaining({ householdCmId: null }))
  })
})
