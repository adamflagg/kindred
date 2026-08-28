/**
 * The "Push write-ins" entry (kindred#2477): the button beside the stats
 * line that opens the scenario→live review. Extracted from `LodgingBoard`
 * to the page header on the owner's first visual pass (2026-08-24).
 *
 * Present only where a push could ever apply — inside a scenario, held by a
 * `bunking.manage` user — and ABSENT everywhere else. `opacity-40` is this
 * board's vocabulary for a refusal (CLAUDE.md §4, "Family Camp Models
 * Summer"); an affordance with nothing behind it is not a refusal, so it is
 * not rendered at all rather than disabled.
 *
 * THE BADGE IS THE SERVER'S ANSWER, not the board's own write-in total: it
 * counts the rows a push would actually write or delete, which is the whole
 * point of the owner's 2026-08-28 ruling. Only the server can know that —
 * inside a scenario the client never reads the live board's write-ins.
 *
 * Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PushBuildingReport, PushPreview, PushRowPayload } from '../../services/lodgingApi'
import { PushWriteInsEntry } from './PushWriteInsEntry'

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isAdmin: true,
    permissions: [],
    hasPermission: () => true,
    hasAnyPermission: () => true,
  }),
}))

vi.mock('../../hooks/useWeekendRoster', () => ({
  useHouseholdMedical: () => ({ data: undefined, isLoading: false, error: null }),
}))

vi.mock('../../hooks/useLodgingPlacement', () => ({
  useLodgingPlacement: () => ({ move: vi.fn(), isMoving: false }),
}))

// `PushWriteInsModal` (mounted alongside the button) calls the real
// `useApiWithAuth` directly rather than through a wrapped hook, and this tree
// carries no AuthProvider — the same reason the sibling board test files mock
// `useUnitAvailability`/`useUnitMerge` rather than let them reach the real
// hook.
const mockFetchWithAuth = vi.fn()
vi.mock('../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    fetchWithAuth: mockFetchWithAuth,
    isAuthenticated: true,
    isAuthLoading: false,
  }),
}))

const mockFetchPushPreview = vi.fn()
vi.mock('../../services/lodgingApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/lodgingApi')>()
  return {
    ...actual,
    fetchPushPreview: (...args: unknown[]) => mockFetchPushPreview(...args) as unknown,
  }
})

let client: QueryClient

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mockFetchWithAuth.mockReset()
  mockFetchPushPreview.mockReset()
  mockFetchPushPreview.mockResolvedValue(preview([]))
})

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/weekend/fc1/housing']}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

function row(unitCode: string, occupantName: string): PushRowPayload {
  return {
    unit_id: `u-${unitCode}`,
    unit_code: unitCode,
    unit_name: unitCode,
    occupant_name: occupantName,
    note: '',
    party_size: null,
    sleeps: null,
  }
}

function building(
  key: string,
  cls: PushBuildingReport['cls'],
  live: PushRowPayload[],
  draft: PushRowPayload[]
): PushBuildingReport {
  return { key, label: key, cls, live, draft }
}

function preview(buildings: PushBuildingReport[]): PushPreview {
  return {
    year: 2026,
    session_cm_id: 1000001,
    scenario: SCENARIO,
    digest: 'd'.repeat(64),
    buildings,
  }
}

const SCENARIO = 'scn7x2k9qw3mnbv'

function renderEntry(props: Partial<Parameters<typeof PushWriteInsEntry>[0]> = {}) {
  return render(
    <PushWriteInsEntry
      year={2026}
      sessionCmId={1000001}
      scenario={SCENARIO}
      canManage={true}
      {...props}
    />,
    { wrapper }
  )
}

function pushButton() {
  return screen.getByRole('button', { name: /push write-ins/i })
}

describe('PushWriteInsEntry — the push write-ins button beside the stats line', () => {
  it('is absent without bunking.manage', () => {
    renderEntry({ canManage: false })
    expect(screen.queryByRole('button', { name: /push write-ins/i })).not.toBeInTheDocument()
  })

  it('is absent on the CampMinder mirror, where there is no scenario to push', () => {
    renderEntry({ scenario: '' })
    expect(screen.queryByRole('button', { name: /push write-ins/i })).not.toBeInTheDocument()
  })

  it('is absent without a weekend session, where a preview would fire session_cm_id=0', () => {
    // CodeRabbit fix-round finding (2026-08-23, PR #2555 comment 3): the
    // same third condition `canPlace` (Line ~314) carries for the identical
    // reason -- `sessionCmId` defaults to 0 for boards under test that don't
    // exercise a real weekend, and the preview endpoint requires a positive
    // id.
    renderEntry({ sessionCmId: 0 })
    expect(screen.queryByRole('button', { name: /push write-ins/i })).not.toBeInTheDocument()
  })

  it('asks for no preview where it does not render', () => {
    renderEntry({ scenario: '' })
    expect(mockFetchPushPreview).not.toHaveBeenCalled()
  })

  it('is present with both', () => {
    renderEntry()
    expect(pushButton()).toBeInTheDocument()
  })

  it('badges the rows a push would write or delete, not the board-wide write-in total', async () => {
    // Five write-in rows on this board; only three of them are a push. The
    // old badge counted the board's own rows and read "4" here — every
    // already-matching row inflating a number staff read as work to do.
    mockFetchPushPreview.mockResolvedValue(
      preview([
        building('yurt-5', 'add', [], [row('yurt-5', 'Kitchen crew'), row('yurt-5', 'A. Rivera')]),
        building('fern-1', 'match', [row('fern-1', 'E. Sandoval')], [row('fern-1', 'E. Sandoval')]),
        building(
          'cedar-9',
          'conflict',
          [row('cedar-9', 'G. Whitfield')],
          [row('cedar-9', 'H. Osei')]
        ),
      ])
    )
    renderEntry()

    await waitFor(() => {
      expect(pushButton()).toHaveTextContent('3')
    })
  })

  it('reads 0 and greys out when the scenario already matches CampMinder', async () => {
    mockFetchPushPreview.mockResolvedValue(
      preview([
        building('fern-1', 'match', [row('fern-1', 'E. Sandoval')], [row('fern-1', 'E. Sandoval')]),
      ])
    )
    renderEntry()

    await waitFor(() => {
      expect(pushButton()).toHaveClass('text-muted-foreground')
    })
    expect(pushButton()).toHaveTextContent('0')
  })

  it('stays clickable with nothing to push — the report is still worth reading', async () => {
    mockFetchPushPreview.mockResolvedValue(preview([]))
    renderEntry()

    await waitFor(() => {
      expect(pushButton()).toHaveClass('text-muted-foreground')
    })
    // Greyed, never disabled: staff opening it see WHY there is nothing to
    // do, which a dead button cannot say.
    expect(pushButton()).toBeEnabled()
  })

  it('is not greyed while the preview is still in flight', () => {
    mockFetchPushPreview.mockReturnValue(new Promise(() => undefined))
    renderEntry()

    expect(pushButton()).not.toHaveClass('text-muted-foreground')
    // No badge either — a placeholder count would be a guess, and the count
    // is the one thing this button now promises to be right about.
    expect(pushButton()).not.toHaveTextContent(/\d/)
  })

  it('is not greyed when the preview fails — an unknown count is not a zero', async () => {
    mockFetchPushPreview.mockRejectedValue(new Error('boom'))
    renderEntry()

    await waitFor(() => {
      expect(mockFetchPushPreview).toHaveBeenCalled()
    })
    expect(pushButton()).not.toHaveClass('text-muted-foreground')
    expect(pushButton()).not.toHaveTextContent(/\d/)
  })
})
