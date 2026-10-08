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
vi.mock('../../components/camperships/money/ToPlaceTab', () => ({
  ToPlaceTab: () => <div>To place body</div>,
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

  it('says which tabs are still to come in slice 3', () => {
    renderAt('/aid/money/sources')
    expect(
      screen.getByText('Money › Sources is built in a later part of slice 3.')
    ).toBeInTheDocument()
  })
})
