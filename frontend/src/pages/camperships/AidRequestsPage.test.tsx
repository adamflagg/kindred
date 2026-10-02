import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GRID_ROWS } from '../../components/camperships/requests/gridFixtures'
import type { ApiAidGrid, ApiAidRemaining } from '../../types/api-types'
import AidRequestsPage from './AidRequestsPage'

interface GridResult {
  data: ApiAidGrid | undefined
  isLoading: boolean
  error: Error | null
}
let grid: GridResult
vi.mock('../../hooks/camperships/useAidGrid', () => ({ useAidGrid: () => grid }))
const REMAINING: ApiAidRemaining = {
  year: 2027,
  pools: [
    { pool: 'pool_a', label: 'Pool A', remaining: 1000 },
    { pool: 'pool_b', label: 'Pool B', remaining: 500 },
  ],
  total: 1500,
}
vi.mock('../../hooks/camperships/useAidRemaining', () => ({
  useAidRemaining: () => ({ data: REMAINING }),
}))
vi.mock('../../components/camperships/shell/AidDefinitionNotes', () => ({
  AidDefinitionNotes: () => null,
}))
let granted: string[] = ['financial_aid.view']
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))

const LIVE: ApiAidGrid = { year: 2027, rules_version: 1, rows: [...GRID_ROWS] }

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname + search}</div>
}

function Back() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => void navigate(-1)}>
      Back
    </button>
  )
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/aid/requests"
          element={
            <>
              <AidRequestsPage />
              <Where />
            </>
          }
        />
        <Route
          path="/aid/households/:householdCmId"
          element={
            <>
              <Back />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  )
}

const viewLink = (label: string) => screen.getByRole('link', { name: new RegExp(`^${label} `) })

beforeEach(() => {
  grid = { data: LIVE, isLoading: false, error: null }
  granted = ['financial_aid.view']
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-01T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('AidRequestsPage (§6.1, §6.2)', () => {
  it('opens on All, with every view’s families and requests on its link', () => {
    renderAt('/aid/requests')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Requests')
    expect(viewLink('All')).toHaveTextContent('All 4 fam · 5 req')
    expect(viewLink('Holds')).toHaveTextContent('Holds 1 fam · 1 req')
    expect(viewLink('Holds')).toHaveAttribute('href', '/aid/requests?view=holds&year=2027')
  })

  it("shows only a view's rows", () => {
    renderAt('/aid/requests?view=holds&year=2027')
    expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
    expect(screen.queryByText('Emma Johnson')).toBeNull()
  })

  it('says a queue view can’t be shown for a past date, and still shows All for it (Decision 11)', () => {
    grid = {
      data: {
        ...LIVE,
        as_of: '2027-03-01',
        rows: GRID_ROWS.map((row) => ({ ...row, queues: null })),
      },
      isLoading: false,
      error: null,
    }
    const { unmount } = renderAt('/aid/requests?view=holds&as_of=2027-03-01')
    expect(screen.getByText(/isn't rebuilt for a past date/)).toBeInTheDocument()
    expect(screen.queryByText('No requests in this view.')).toBeNull()
    expect(viewLink('Holds')).toHaveTextContent('Holds —')
    unmount()
    renderAt('/aid/requests?as_of=2027-03-01')
    expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
  })

  it('opens the household from a name, with the view and season, and Back highlights the row (§3.5)', async () => {
    renderAt('/aid/requests')
    await userEvent.click(screen.getByRole('link', { name: 'The Garcia Family' }))
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/households/1000003?from=all&year=2027'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/requests?row=reqliam00000002')
    expect(screen.getByText('Liam Garcia').closest('tr')).toHaveAttribute(
      'data-highlighted',
      'true'
    )
  })

  it('narrows to a program, kept in the URL, and names the pools from the Remaining read', async () => {
    renderAt('/aid/requests')
    expect(
      within(screen.getByLabelText('Pool')).getByRole('option', { name: 'Pool B' })
    ).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Program'), 'quest')
    expect(screen.getByTestId('where')).toHaveTextContent('program=quest')
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.queryByText('Emma Johnson')).toBeNull()
  })

  it('names the programs in words, not by their rules keys', () => {
    renderAt('/aid/requests')
    const program = within(screen.getByLabelText('Program'))
    expect(program.getByRole('option', { name: 'Summer camp' })).toBeInTheDocument()
    expect(program.getByRole('option', { name: 'Quest' })).toBeInTheDocument()
    expect(program.queryByRole('option', { name: 'summer' })).toBeNull()
  })

  it('stays on the URL it was opened at for a queue view on a past date (A8)', () => {
    grid = {
      data: {
        ...LIVE,
        as_of: '2026-04-01',
        rows: GRID_ROWS.map((row) => ({ ...row, queues: null })),
      },
      isLoading: false,
      error: null,
    }
    renderAt('/aid/requests?view=holds&as_of=2026-04-01')
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/requests?view=holds&as_of=2026-04-01'
    )
    expect(screen.getByText(/isn't rebuilt for a past date/)).toBeInTheDocument()
  })

  it('narrows to a round and a checklist state, kept in the URL (Decision 9)', async () => {
    renderAt('/aid/requests')
    await userEvent.selectOptions(screen.getByLabelText('Checklist'), 'accepted')
    expect(screen.getByTestId('where')).toHaveTextContent('tick=accepted')
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.queryByText('Samuel Johnson')).toBeNull()
    await userEvent.selectOptions(screen.getByLabelText('Round'), '2')
    expect(screen.queryByText('Olivia Chen')).toBeNull()
  })

  it('carries the filters to the household page, so the walk and Back keep them (M5)', async () => {
    renderAt('/aid/requests?program=summer')
    await userEvent.click(screen.getByRole('link', { name: 'The Garcia Family' }))
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/households/1000003?from=all&program=summer&year=2027'
    )
  })

  it('opens on the row a link names, and keeps the URL in step with the highlight (Decision 2)', async () => {
    renderAt('/aid/requests?row=reqliam00000002')
    expect(screen.getByText('Liam Garcia').closest('tr')).toHaveAttribute(
      'data-highlighted',
      'true'
    )
    await userEvent.click(
      within(screen.getByText('Olivia Chen').closest('tr') as HTMLElement).getAllByRole(
        'cell'
      )[2] as HTMLElement
    )
    expect(screen.getByTestId('where')).toHaveTextContent('row=reqolivia000003')
  })

  it("says on Needs an offer that a split request posts per household (⚠ Decision 39's interim)", () => {
    renderAt('/aid/requests?view=needs-offer')
    expect(screen.getByText(/posts one amount per household/)).toBeInTheDocument()
  })

  it('shows the split-request line on Needs an offer only', () => {
    renderAt('/aid/requests?view=holds')
    expect(screen.queryByText(/posts one amount per household/)).toBeNull()
  })

  it('says on Waiting on the family that Posted is this round, not yet accepted (owner ruling I2)', () => {
    renderAt('/aid/requests?view=waiting')
    expect(screen.getByText(/posted in this round, not yet accepted/)).toBeInTheDocument()
  })

  it('shows the Posted note on Waiting on the family only', () => {
    renderAt('/aid/requests?view=holds')
    expect(screen.queryByText(/posted in this round, not yet accepted/)).toBeNull()
  })

  it('keeps showing loaded rows when a background refetch fails (Decision 33)', () => {
    grid = { data: LIVE, isLoading: false, error: new Error('Network down') }
    renderAt('/aid/requests')
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.queryByText(/Network down/)).toBeNull()
  })

  it('says so when nothing ever loaded', () => {
    grid = { data: undefined, isLoading: false, error: new Error('Network down') }
    renderAt('/aid/requests')
    expect(screen.getByText(/Network down/)).toBeInTheDocument()
  })
})
