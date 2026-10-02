import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { APPROVED_RULES_2026 } from '../../components/camperships/requests/approvedRulesFixtures'
import { GRID_ROWS } from '../../components/camperships/requests/gridFixtures'
import type { ApiAidApprovedRules, ApiAidGrid } from '../../types/api-types'
import AidRequestsPage from './AidRequestsPage'

interface GridResult {
  data: ApiAidGrid | undefined
  isLoading: boolean
  error: Error | null
}
let grid: GridResult
vi.mock('../../hooks/camperships/useAidGrid', () => ({ useAidGrid: () => grid }))
let approved: { data: ApiAidApprovedRules | undefined } = { data: APPROVED_RULES_2026 }
vi.mock('../../hooks/camperships/useAidRules', () => ({
  useAidApprovedRules: () => approved,
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

const openProgram = () => userEvent.click(screen.getByLabelText('Program'))
const pickProgram = async (name: string) => {
  await openProgram()
  await userEvent.click(await screen.findByRole('option', { name }))
}

const viewLink = (label: string) => screen.getByRole('link', { name: new RegExp(`^${label} `) })

beforeEach(() => {
  approved = { data: APPROVED_RULES_2026 }
  grid = { data: LIVE, isLoading: false, error: null }
  granted = ['financial_aid.view']
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-01T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('AidRequestsPage (§6.1, §6.2)', () => {
  // T4 spec change: the strip draws each count as its requests alone (the mock's one-line strip).
  it('opens on All, with every lens’s and stage’s requests on its link', () => {
    renderAt('/aid/requests')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Requests')
    expect(viewLink('All')).toHaveTextContent('All 5')
    expect(viewLink('All')).toHaveAttribute('href', '/aid/requests?year=2027')
    expect(viewLink('Holds')).toHaveTextContent('Holds 1')
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

  // T6 spec change: Program and Pool are one grouped dropdown; pool names come from the rules' read.
  it("narrows to a program, kept in the URL, under its pool's heading from the rules' read", async () => {
    renderAt('/aid/requests')
    await openProgram()
    expect(screen.getByRole('option', { name: 'Weekend Programs' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Pool B' })).toBeNull()
    await pickProgram('Quest')
    expect(screen.getByTestId('where')).toHaveTextContent('program=quest')
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.queryByText('Emma Johnson')).toBeNull()
  })

  it('narrows to a pool by its heading, clearing the program, and back (T6)', async () => {
    renderAt('/aid/requests?program=summer')
    await pickProgram('Weekend Programs')
    expect(screen.getByTestId('where')).toHaveTextContent('pool=pool_b')
    expect(screen.getByTestId('where')).not.toHaveTextContent('program=')
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.queryByText('Emma Johnson')).toBeNull()
    await pickProgram('Summer')
    expect(screen.getByTestId('where')).toHaveTextContent('program=summer')
    expect(screen.getByTestId('where')).not.toHaveTextContent('pool=')
  })

  it("names the programs with the server's labels, not by their rules keys", async () => {
    renderAt('/aid/requests')
    await openProgram()
    expect(screen.getByRole('option', { name: 'Summer' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'summer' })).toBeNull()
    expect(screen.queryByRole('option', { name: 'Summer camp' })).toBeNull()
    // The rules do not name Quest: its key spelled out.
    expect(screen.getByRole('option', { name: 'Quest' })).toBeInTheDocument()
  })

  it("shows a label the key could not spell: the server's Women's weekend, not Womens weekend", async () => {
    grid = {
      data: { ...LIVE, rows: [...GRID_ROWS, { ...GRID_ROWS[0]!, program_key: 'womens_weekend' }] },
      isLoading: false,
      error: null,
    }
    renderAt('/aid/requests')
    await openProgram()
    expect(screen.getByRole('option', { name: "Women's weekend" })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Womens weekend' })).toBeNull()
  })

  it('spells the keys out when the rules read has no answer (404, loading, failed), and still filters', async () => {
    approved = { data: undefined }
    renderAt('/aid/requests')
    await openProgram()
    expect(screen.getByRole('option', { name: 'Summer' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Pool b' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: 'Quest' }))
    expect(screen.getByTestId('where')).toHaveTextContent('program=quest')
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
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

const headers = () => screen.getAllByRole('columnheader').map((th) => th.textContent)

describe('AidRequestsPage views strip (T4; RULED P1, P2, P4)', () => {
  it('narrows every row and count to appeals under the Appeals lens, with the Appeals columns', () => {
    renderAt('/aid/requests?lens=appeals')
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.queryByText('Emma Johnson')).toBeNull()
    expect(viewLink('Appeals')).toHaveTextContent('Appeals 1')
    expect(viewLink('All')).toHaveTextContent('All 5')
    expect(viewLink('Needs an offer')).toHaveTextContent('Needs an offer 1')
    expect(viewLink('Holds')).toHaveTextContent('Holds 0')
    expect(headers()).toContain('Appeal ask')
    expect(screen.getByText('Showing appeals only.')).toBeInTheDocument()
  })

  it('links each stage under the lens, and each lens with no stage (picking a lens clears the stage)', () => {
    renderAt('/aid/requests?view=holds&lens=appeals&program=summer')
    expect(viewLink('Needs an offer')).toHaveAttribute(
      'href',
      '/aid/requests?view=needs-offer&lens=appeals&program=summer&year=2027'
    )
    expect(viewLink('All')).toHaveAttribute('href', '/aid/requests?program=summer&year=2027')
    expect(viewLink('Appeals')).toHaveAttribute(
      'href',
      '/aid/requests?lens=appeals&program=summer&year=2027'
    )
  })

  it("shows a stage's appeals with the Appeals view's column set", () => {
    renderAt('/aid/requests?view=needs-offer&lens=appeals')
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.queryByText('Emma Johnson')).toBeNull()
    expect(headers()).toContain('Appeal ask')
    expect(headers()).not.toContain('Round')
  })

  it("orders the Appeals view's columns by the identity rule under the lens: Camper first, Family just left of Needs attention (T2)", () => {
    renderAt('/aid/requests?view=needs-offer&lens=appeals')
    expect(headers()).toEqual([
      'Camper',
      'Session',
      'Stage',
      'R1',
      'Appeal ask',
      'R2',
      'Total',
      'Posted',
      'Family',
      'Needs attention',
    ])
  })

  it('shows a stage under All with its own columns, and no appeals-only line', () => {
    renderAt('/aid/requests?view=needs-offer')
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(headers()).toContain('Round')
    expect(screen.queryByText('Showing appeals only.')).toBeNull()
  })

  it('reads the retired ?view=appeals as no stage and no lens, and leaves the URL alone (no fallback)', () => {
    renderAt('/aid/requests?view=appeals')
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.queryByText('Showing appeals only.')).toBeNull()
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/requests?view=appeals')
  })

  it('carries the lens and the stage to the household page (from=<stage>, or all)', async () => {
    renderAt('/aid/requests?lens=appeals')
    await userEvent.click(screen.getByRole('link', { name: 'The Chen Family' }))
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/households/1000005?from=all&lens=appeals&year=2027'
    )
  })

  it('says the Appeals lens needs today’s data on a past date, and counts only All', () => {
    grid = {
      data: {
        ...LIVE,
        as_of: '2027-03-01',
        rows: GRID_ROWS.map((row) => ({ ...row, queues: null })),
      },
      isLoading: false,
      error: null,
    }
    renderAt('/aid/requests?lens=appeals&as_of=2027-03-01')
    expect(screen.getByText(/Appeals needs today's data/)).toBeInTheDocument()
    expect(viewLink('Appeals')).toHaveTextContent('Appeals —')
    expect(viewLink('All')).toHaveTextContent('All 5')
  })
})
