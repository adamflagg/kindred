/**
 * The write surface for the staff-owned weekend cancellation flag
 * (kindred#2092).
 *
 * It lives HERE, at /manage/lodging, and not on the weekend lander: every
 * other season-grain fact — the registry, the aliases, the season
 * roll-forward — is edited on this screen, behind the same `bunking.manage`
 * gate. The lander badges the flag and never sets it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '../../../utils/queryKeys'
import { WeekendStatusPanel } from './WeekendStatusPanel'

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

const setWeekendSessionStatus = vi.fn()
vi.mock('../../../services/lodgingCrud', () => ({
  setWeekendSessionStatus: (...args: unknown[]) => setWeekendSessionStatus(...args),
}))

let mockCurrentYear = 2026
vi.mock('../../../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({
    currentYear: mockCurrentYear,
    setCurrentYear: vi.fn(),
    isYearReady: mockCurrentYear > 0,
  }),
}))

const sessionsQuery = {
  data: undefined as unknown,
  isLoading: false,
  error: null as Error | null,
}
vi.mock('../../../hooks/useWeekendRoster', () => ({
  useWeekendSessions: () => sessionsQuery,
}))

const FAMILY_CAMP_1 = {
  session_id: 'sess_1',
  session_cm_id: 1000001,
  name: 'Family Camp 1',
  session_type: 'family',
  start_date: '2026-05-22 07:00:00.000Z',
  end_date: '2026-05-25 07:00:00.000Z',
  status: 'active',
}

const WOMENS = {
  session_id: 'sess_2',
  session_cm_id: 1000002,
  name: "Women's Weekend",
  session_type: 'adult',
  start_date: '2026-10-15 07:00:00.000Z',
  end_date: '2026-10-18 07:00:00.000Z',
  status: 'active',
}

let client: QueryClient

function renderPanel(ui: ReactElement) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  mockCurrentYear = 2026
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  setWeekendSessionStatus.mockReset().mockResolvedValue(undefined)
  sessionsQuery.isLoading = false
  sessionsQuery.error = null
  // COPIES: a test that cancels one must not leave it cancelled for the next.
  sessionsQuery.data = { year: 2026, sessions: [{ ...WOMENS }, { ...FAMILY_CAMP_1 }] }
})

describe('WeekendStatusPanel', () => {
  it('lists the season in date order, not in the order the payload arrived', () => {
    renderPanel(<WeekendStatusPanel />)

    const names = screen.getAllByRole('rowheader').map((cell) => cell.textContent)
    expect(names).toEqual(['Family Camp 1', "Women's Weekend"])
  })

  it('renders the action column header with no sr-only "Action" text (kindred#2348)', () => {
    // Regression: the otherwise-empty `<th>` over the cancel/reinstate
    // buttons used to carry `<span className="sr-only">Action</span>`. No
    // assistive tech reads this app (`frontend/CLAUDE.md`); the column was
    // already visually empty on purpose, so it stays that way.
    renderPanel(<WeekendStatusPanel />)
    expect(screen.queryByText('Action')).not.toBeInTheDocument()
  })

  it('cancels one weekend, naming the season as well as the weekend', async () => {
    const user = userEvent.setup()
    renderPanel(<WeekendStatusPanel />)

    await user.click(screen.getByRole('button', { name: /cancel Women's Weekend/i }))

    // The year is half the key: CampMinder reuses session ids across seasons.
    await waitFor(() => {
      expect(setWeekendSessionStatus).toHaveBeenCalledWith(2026, 1000002, 'cancelled')
    })
  })

  it('offers the reverse action on a weekend that is already cancelled', async () => {
    const user = userEvent.setup()
    sessionsQuery.data = {
      year: 2026,
      sessions: [{ ...WOMENS, status: 'cancelled' }, { ...FAMILY_CAMP_1 }],
    }
    renderPanel(<WeekendStatusPanel />)

    expect(screen.getByText('Cancelled')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /reinstate Women's Weekend/i }))

    await waitFor(() => {
      expect(setWeekendSessionStatus).toHaveBeenCalledWith(2026, 1000002, 'active')
    })
  })

  it('invalidates the weekend surfaces, not only this panel', async () => {
    // The status is projected into /api/lodging/sessions AND /summary, whose
    // queries inherit the app's 30-minute staleTime. Invalidating a local key
    // only would leave the lander showing a cancelled weekend as running for
    // half an hour — the exact failure invalidateLodgingRegistryQueries exists
    // to prevent.
    const user = userEvent.setup()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    renderPanel(<WeekendStatusPanel />)

    await user.click(screen.getByRole('button', { name: /cancel Women's Weekend/i }))

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.weekendSummaryPrefix() })
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.weekendSessionsPrefix() })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.weekendRosterPrefix() })
  })

  it('shows the loading state rather than an empty season', () => {
    sessionsQuery.data = undefined
    sessionsQuery.isLoading = true
    renderPanel(<WeekendStatusPanel />)
    expect(screen.getByText(/Loading weekend sessions/i)).toBeInTheDocument()
  })

  it('surfaces a read failure instead of showing every weekend as running', () => {
    sessionsQuery.data = undefined
    sessionsQuery.error = new Error('boom')
    renderPanel(<WeekendStatusPanel />)
    expect(screen.getByText(/Failed to load weekend sessions data: boom/i)).toBeInTheDocument()
  })

  it('waits for the season rather than claiming the year has no weekends', () => {
    // CurrentYearContext answers the literal 0 until the backend supplies the
    // configured season, and `useWeekendSessions` gates its fetch on
    // `year > 0`. A DISABLED TanStack query reports `isLoading === false` with
    // `data === undefined` — exactly the shape QueryGuard reads as "settled,
    // nothing here" — so gating only the fetch trades a spinner for a
    // confident empty state. Same trap SeasonRollForwardPanel hit through
    // auth-loading.
    mockCurrentYear = 0
    sessionsQuery.data = undefined
    sessionsQuery.isLoading = false
    renderPanel(<WeekendStatusPanel />)

    expect(screen.getByText(/Loading weekend sessions/i)).toBeInTheDocument()
    expect(screen.queryByText(/No family or adult weekends/i)).not.toBeInTheDocument()
  })

  it('says the season has no weekends rather than rendering an empty table', () => {
    sessionsQuery.data = { year: 2026, sessions: [] }
    renderPanel(<WeekendStatusPanel />)
    expect(screen.getByText(/No family or adult weekends/i)).toBeInTheDocument()
  })
})
