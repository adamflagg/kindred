import { act, render, screen, waitFor, within } from '@testing-library/react'
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
vi.mock('../../hooks/camperships/useAidEditorPreview', () => ({
  useAidEditorPreview: () => ({ preview: { status: 'idle' }, onAmountChange: () => undefined }),
}))
const keyAsk = vi.fn(() =>
  Promise.resolve({ year: 2027, written: 1, unchanged: 0, operation_id: 'op0000000000001' })
)
vi.mock('../../hooks/camperships/useAidWrites', () => ({
  useAidKeyAsk: () => ({ mutateAsync: keyAsk }),
}))

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
  keyAsk.mockClear()
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

describe('the editor row (§4.6; D22; owner rulings A and B)', () => {
  const sessionCell = (camper: string) =>
    within(screen.getByText(camper).closest('tr') as HTMLElement).getAllByRole(
      'cell'
    )[2] as HTMLElement

  beforeEach(() => {
    granted = ['financial_aid.view', 'financial_aid.casework']
  })

  it('opens under a row whose Round 1 is posted, on its Round 2 ask', async () => {
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    expect(screen.getByLabelText('Round 2 ask')).toHaveValue('1200')
  })

  it("says why where an appeal can't be keyed yet", async () => {
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Emma Johnson'))
    expect(
      screen.getByText(
        'An appeal answers a posted offer: tick Round 1 Posted first, or correct the Round 1 ask'
      )
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Round 2 ask')).toBeNull()
  })

  it('saves an appeal with ↓, dated today, and moves on at once (ruling A)', async () => {
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300{ArrowDown}')
    expect(keyAsk).toHaveBeenCalledWith({
      requestId: 'reqolivia000003',
      body: { round: 2, amount: 1300, asked_on: '2027-04-01', note: 'Family emailed (Apr 1)' },
    })
    // The walk moved through the page's onHighlight, so the URL followed (build ruling 2).
    expect(screen.getByTestId('where')).toHaveTextContent('row=reqriley0000004')
  })

  it('opens the family from a name only once what was typed is saved (Decision 4)', async () => {
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '1300')
    await userEvent.click(screen.getByRole('link', { name: 'The Chen Family' }))
    expect(keyAsk).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        '/aid/households/1000005?from=all&year=2027'
      )
    )
  })

  it("stays on the grid when a ↓ save fails after a family link was clicked (C1, the review's probe)", async () => {
    let fail: ((error: Error) => void) | undefined
    keyAsk.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject: (error: Error) => void) => {
          fail = reject
        })
    )
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300{ArrowDown}')
    // On Riley's row now, nothing typed; Olivia's save is still in flight.
    await userEvent.click(screen.getByRole('link', { name: 'The Sam Family' }))
    expect(screen.getByTestId('where')).not.toHaveTextContent('/aid/households')
    await act(async () => fail?.(new Error('The server is down')))
    expect(screen.getByTestId('where')).not.toHaveTextContent('/aid/households')
    expect(screen.getByTestId('where')).toHaveTextContent('row=reqolivia000003')
    expect(screen.getByLabelText('Round 2 ask')).toHaveValue('1300')
    expect(
      screen.getByText("Couldn't save Olivia Chen's Round 2 ask: The server is down")
    ).toBeInTheDocument()
  })

  it('lands Back on the row whose family was opened, with the editor walk on (§3.5)', async () => {
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.click(screen.getByRole('link', { name: 'The Garcia Family' }))
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000003')
    )
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('where')).toHaveTextContent('row=reqliam00000002')
    expect(screen.getByText('Liam Garcia').closest('tr')).toHaveAttribute(
      'data-highlighted',
      'true'
    )
  })

  it('saves what is typed before a view link moves the page (Decision 4)', async () => {
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '1300')
    await userEvent.click(viewLink('Appeals'))
    expect(keyAsk).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('view=appeals'))
  })

  it("won't move for a filter while what is typed can't be saved yet, and says why once", async () => {
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '12,50')
    await userEvent.selectOptions(screen.getByLabelText('Program'), 'quest')
    expect(screen.getByTestId('where')).not.toHaveTextContent('program=quest')
    expect(screen.getAllByText('Not an amount')).toHaveLength(1)
    expect(keyAsk).not.toHaveBeenCalled()
  })

  it('marks the failed row in the grid (Decision 3, as accepted)', async () => {
    let fail: ((error: Error) => void) | undefined
    keyAsk.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject: (error: Error) => void) => {
          fail = reject
        })
    )
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300{ArrowDown}1')
    // Typing on Riley's row when it fails, so the failure is listed and marked, not jumped to.
    await act(async () => fail?.(new Error('The server is down')))
    expect(screen.getByText('Olivia Chen').closest('tr')).toHaveAttribute('data-marked', 'true')
    expect(screen.getByText('Riley Sam').closest('tr')).not.toHaveAttribute('data-marked')
  })

  it("forgets a failed row the read no longer has, so it can't block every later leave (build ruling 2)", async () => {
    let fail: ((error: Error) => void) | undefined
    keyAsk.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject: (error: Error) => void) => {
          fail = reject
        })
    )
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300{ArrowDown}1')
    await act(async () => fail?.(new Error('The server is down')))
    expect(screen.getByText(/Couldn't save Olivia Chen's Round 2 ask/)).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    // The next refetch no longer has Olivia's request (cancelled elsewhere, say).
    grid = {
      ...grid,
      data: { ...LIVE, rows: LIVE.rows.filter((r) => r.request_id !== 'reqolivia000003') },
    }
    await userEvent.click(sessionCell('Emma Johnson'))
    expect(screen.queryByText(/Couldn't save Olivia Chen/)).toBeNull()
    await userEvent.click(screen.getByRole('link', { name: 'The Garcia Family' }))
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000003')
    )
  })

  it('opens no editor without casework: the row only highlights', async () => {
    granted = ['financial_aid.view']
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    expect(screen.queryByLabelText('Round 2 ask')).toBeNull()
    expect(screen.getByText('Olivia Chen').closest('tr')).toHaveAttribute(
      'data-highlighted',
      'true'
    )
  })
})
