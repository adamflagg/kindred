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
vi.mock('../../components/camperships/money/SourcesTab', () => ({
  SourcesTab: () => <div>Sources body</div>,
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

describe('AidMoneyPage (spec §8.1; D62)', () => {
  it('opens on To place, keeping the season and the as-of (Decision 2)', () => {
    renderAt('/aid/money?as_of=2027-05-01')
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/money/to-place?year=2027&as_of=2027-05-01'
    )
  })

  it('shows the three tabs, and To place’s body on its tab', () => {
    renderAt('/aid/money/to-place')
    for (const name of ['Ledger', 'To place', 'Sources']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument()
    }
    expect(screen.getByText('To place body')).toBeInTheDocument()
  })

  it('links what the ledger also raises to where the request is worked (§8.1)', () => {
    renderAt('/aid/money/to-place')
    expect(screen.getByRole('link', { name: 'Requests › To reverse' })).toHaveAttribute(
      'href',
      '/aid/requests?view=to-reverse&year=2027'
    )
    expect(screen.getByRole('link', { name: 'Grants › Needs attention' })).toHaveAttribute(
      'href',
      '/aid/grants/needs-attention?year=2027'
    )
  })

  it("says what each tab is for, in the mock's words (P-1)", () => {
    renderAt('/aid/money/to-place')
    expect(
      screen.getByText(
        'CampMinder aid lines that no single request explains. Attach each one to the right request.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(/^Also raised by the ledger, worked where the request is:/)
    ).toBeInTheDocument()
  })

  it('says To place shows today when the link carries a past date, and keeps the pill', () => {
    renderAt('/aid/money/to-place?as_of=2027-05-01')
    expect(
      screen.getByText('This tab shows today. Money › Ledger can show May 1, 2027.')
    ).toBeInTheDocument()
    expect(screen.getByText('As of May 1, 2027')).toBeInTheDocument()
  })

  it("shows Sources and the Ledger on their tabs, each under the mock's purpose line", () => {
    renderAt('/aid/money/sources')
    expect(screen.getByText('Sources body')).toBeInTheDocument()
    expect(
      screen.getByText("Finance's list of CampMinder descriptions and how each one is classified.")
    ).toBeInTheDocument()
  })

  it('shows the Ledger on a past date with no "shows today" line: its totals read that day', () => {
    renderAt('/aid/money/ledger?as_of=2027-05-01')
    expect(screen.getByText('Ledger body')).toBeInTheDocument()
    expect(
      screen.getByText("One row per family, plus finance's posted totals by program and source.")
    ).toBeInTheDocument()
    expect(screen.queryByText(/This tab shows today/)).toBeNull()
  })
})

describe('the Money band subtitle (coordinator 2026-10-08)', () => {
  it.each(['ledger', 'to-place', 'sources'])('is neutral on the %s tab', (slug) => {
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
