import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { SyncStatusResponse } from '../hooks/useSyncStatusAPI'

// Mock all heavy dependencies before importing AppLayout
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', name: 'Jane Smith', email: 'jane@example.com', avatar: '' },
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(),
  }),
}))

// Mutable so individual tests can override permission behavior
let mockPerms = {
  hasPermission: (_p: string) => false,
  isAdmin: false,
}
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => mockPerms,
}))

vi.mock('../hooks/useTour', () => ({
  useTour: () => ({
    tourId: 'test-tour',
    replay: vi.fn(),
  }),
}))

vi.mock('../contexts/ProgramContext', () => ({
  useProgram: () => ({
    currentProgram: 'summer',
    setProgram: vi.fn(),
    clearProgram: vi.fn(),
  }),
}))

// Spy so tests can assert on what args AppLayout passes
// Return type is `{ data: SyncStatusResponse | null }` to allow sentinel-shape tests
const syncStatusSpy = vi.fn((_opts?: unknown): { data: SyncStatusResponse | null } => ({
  data: null,
}))
vi.mock('../hooks/useSyncStatusAPI', () => ({
  useSyncStatusAPI: (...args: unknown[]) => syncStatusSpy(...args),
}))

vi.mock('../hooks/useCurrentYear', () => ({
  useYear: () => 2026,
}))

vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({
    theme: 'dark',
    toggleTheme: vi.fn(),
  }),
}))

vi.mock('../services/sync', () => ({
  syncService: { refreshBunking: vi.fn(), refreshFamilyCamp: vi.fn() },
}))

let mockWeekendShell: { session: unknown; isAdultWeekend: boolean } = {
  session: undefined,
  isAdultWeekend: false,
}
vi.mock('../hooks/useWeekendShellSession', () => ({
  useWeekendShellSession: () => mockWeekendShell,
}))

vi.mock('../lib/pocketbase', () => ({
  pb: {
    files: { getURL: vi.fn(() => '') },
    authStore: {
      record: { id: 'user-1' },
      onChange: vi.fn(),
    },
  },
}))

vi.mock('../components/YearSelector', () => ({
  default: () => <div data-testid="year-selector">2026</div>,
}))

vi.mock('../components/CacheStatus', () => ({
  default: () => null,
}))

vi.mock('../components/BunkRequestsUpload', () => ({
  // The label goes in an ATTRIBUTE, not text: the fresh-login guard below
  // asserts that no /Requests/ text renders when sync end_times are absent,
  // and a mock that printed "Upload Requests" would break that unrelated test.
  default: ({ label }: { label?: string }) => (
    <div data-testid="bunk-requests-upload" data-label={label ?? '(default)'} />
  ),
}))

vi.mock('../components/BrandedLogo', () => ({
  BrandedLogo: () => <div>Logo</div>,
}))

vi.mock('../components/VersionInfo', () => ({
  VersionInfo: () => null,
}))

vi.mock('../components/FeedbackModal', () => ({
  FeedbackModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="feedback-modal">Feedback Modal</div> : null,
}))

import { AppLayout } from './AppLayout'

function renderAppLayout(route = '/') {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <AppLayout />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('Program Switcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPerms = { hasPermission: () => false, isAdmin: false }
    syncStatusSpy.mockImplementation(() => ({ data: null }))
  })

  it('renders all program labels in the desktop dropdown', () => {
    renderAppLayout()
    // Open the program dropdown
    const programButton = screen.getByText('Summer')
    fireEvent.click(programButton)

    expect(screen.getByText('Summer Bunking')).toBeInTheDocument()
    expect(screen.getByText('Weekend Housing')).toBeInTheDocument()
    expect(screen.getByText('Camp Analytics')).toBeInTheDocument()
  })

  it('no longer renders a mobile hamburger toggle (#1611)', () => {
    renderAppLayout()
    expect(screen.queryByLabelText('Toggle navigation menu')).toBeNull()
  })

  it('renders Switch Programs button in desktop dropdown', () => {
    renderAppLayout()
    const programButton = screen.getByText('Summer')
    fireEvent.click(programButton)

    expect(screen.getByText('Switch Programs')).toBeInTheDocument()
  })
})

describe('Help Menu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPerms = { hasPermission: () => false, isAdmin: false }
    syncStatusSpy.mockImplementation(() => ({ data: null }))
  })

  it('renders the help button with ? icon', () => {
    renderAppLayout()
    const helpButton = screen.getByLabelText('Help menu')
    expect(helpButton).toBeInTheDocument()
  })

  it('opens help dropdown on click', () => {
    renderAppLayout()
    const helpButton = screen.getByLabelText('Help menu')
    fireEvent.click(helpButton)

    expect(screen.getByText('Report a Problem')).toBeInTheDocument()
    expect(screen.getByText('Tour This Page')).toBeInTheDocument()
  })

  it('opens feedback modal when Report a Problem is clicked', () => {
    renderAppLayout()
    fireEvent.click(screen.getByLabelText('Help menu'))
    fireEvent.click(screen.getByText('Report a Problem'))

    expect(screen.getByTestId('feedback-modal')).toBeInTheDocument()
  })

  it('shows Tour This Page when tourId is truthy', () => {
    renderAppLayout()
    fireEvent.click(screen.getByLabelText('Help menu'))

    expect(screen.getByText('Report a Problem')).toBeInTheDocument()
    expect(screen.getByText('Tour This Page')).toBeInTheDocument()
  })

  it('hides Tour This Page when tourId is falsy', async () => {
    const useTourModule = await import('../hooks/useTour')
    vi.spyOn(useTourModule, 'useTour').mockReturnValue({
      tourId: null,
      replay: vi.fn(),
    } as ReturnType<typeof useTourModule.useTour>)

    renderAppLayout()
    fireEvent.click(screen.getByLabelText('Help menu'))

    expect(screen.getByText('Report a Problem')).toBeInTheDocument()
    expect(screen.queryByText('Tour This Page')).not.toBeInTheDocument()
  })
})

describe('AppLayout sync-status polling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    syncStatusSpy.mockImplementation(() => ({ data: null }))
  })

  /**
   * The shell is no longer the only consumer of this query: `useSyncSequenceRun`
   * subscribes to the same cache entry for the two refresh chains
   * (kindred#2478 §4, kindred#2587), and `RefreshHousingButton` reads it for the
   * modal's last-refreshed line. So the assertion is over EVERY call rather than
   * the last one — the spec being pinned is that NO consumer in the shell reads
   * the protected endpoint without `bunking.manage`, which is stronger than what
   * a single-call assertion said.
   */
  function resolvedEnabledFlags(): boolean[] {
    return syncStatusSpy.mock.calls.map(
      (call) => (call[0] as { enabled?: boolean } | undefined)?.enabled ?? true
    )
  }

  it('passes enabled: false to every consumer when user lacks bunking.manage', () => {
    mockPerms = { hasPermission: () => false, isAdmin: false }
    renderAppLayout()
    const flags = resolvedEnabledFlags()
    expect(flags.length).toBeGreaterThan(0)
    expect(flags.every((enabled) => enabled === false)).toBe(true)
  })

  it('passes enabled: true when user has bunking.manage', () => {
    mockPerms = {
      hasPermission: (p: string) => p === 'bunking.manage',
      isAdmin: false,
    }
    renderAppLayout()
    const flags = resolvedEnabledFlags()
    expect(flags.length).toBeGreaterThan(0)
    expect(flags.every((enabled) => enabled === true)).toBe(true)
  })
})

describe('AppLayout sync-status labels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPerms = {
      hasPermission: (p: string) => p === 'bunking.manage',
      isAdmin: false,
    }
    const iso = '2026-04-22T12:00:00.000Z'
    syncStatusSpy.mockImplementation(() => ({
      data: {
        bunk_assignments: {
          status: 'success',
          end_time: iso,
          start_time: iso,
          summary: { created: 1, updated: 2, skipped: 0, errors: 0 },
        },
        bunk_requests: {
          status: 'success',
          end_time: iso,
          start_time: iso,
          summary: { created: 3, updated: 4, skipped: 1, errors: 0 },
        },
        // The request-text span reads the UPLOAD timestamp and nothing else —
        // a `bunk_requests` run on its own renders no line at all (see the
        // no-fallback test below). The sync summary above still reaches the
        // TOOLTIP, which is what the hover test asserts on.
        _bunk_requests_upload: {
          uploaded_at: iso,
          filename: 'BunkRequests_2026-04-22.csv',
        },
      } as SyncStatusResponse,
    }))
  })

  it('renders "Assignments synced ..." label with lowercase synced', () => {
    renderAppLayout()
    expect(screen.getByText(/Assignments synced/)).toBeInTheDocument()
  })

  // WAS: 'renders "Requests synced ..." label'. The fallback that produced that
  // label is gone — see the no-fallback test at the end of this describe — so the
  // request-text span now only ever renders the UPLOAD wording.
  it('renders "Requests uploaded ..." label off the CSV upload timestamp', () => {
    renderAppLayout()
    expect(screen.getByText(/Requests uploaded/)).toBeInTheDocument()
    expect(screen.queryByText(/Requests synced/)).not.toBeInTheDocument()
  })

  it('Requests label exposes richer detail via tooltip on hover', () => {
    renderAppLayout()
    const requestsLabel = screen.getByText(/Requests uploaded/)
    const tooltipHost = requestsLabel.closest('[title]') as HTMLElement | null
    expect(tooltipHost).not.toBeNull()
    const title = tooltipHost?.getAttribute('title') ?? ''
    expect(title).toMatch(/2026-04-22/)
    expect(title).toMatch(/created 3, updated 4, skipped 1, errors 0/)
  })
})

describe('AppLayout requests upload label', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPerms = {
      hasPermission: (p: string) => p === 'bunking.manage',
      isAdmin: false,
    }
  })

  // Use an upload time well in the past so the relative phrase is stable
  // across test runs ("about 1 month ago" instead of e.g. "less than a minute ago").
  const uploadedAt = '2026-04-04T14:13:00.000Z'
  const syncIso = '2026-04-22T12:00:00.000Z'

  function mockWithUpload(filename: string) {
    syncStatusSpy.mockImplementation(() => ({
      data: {
        bunk_assignments: {
          status: 'success',
          end_time: syncIso,
          start_time: syncIso,
          summary: { created: 1, updated: 2, skipped: 0, errors: 0 },
        },
        bunk_requests: {
          status: 'success',
          end_time: syncIso,
          start_time: syncIso,
          summary: { created: 3, updated: 4, skipped: 1, errors: 0 },
        },
        _bunk_requests_upload: { filename, uploaded_at: uploadedAt },
      } as SyncStatusResponse,
    }))
  }

  it('uses upload time with relative-only wording in the label (#1706)', () => {
    mockWithUpload('BunkRequests_2026-04-04.csv')
    renderAppLayout()

    const label = screen.getByText(/Requests uploaded/)
    expect(label).toBeInTheDocument()
    // Relative phrase ("ago" suffix) is what's shown inline
    expect(label.textContent).toMatch(/ago/)
    // #1706: the absolute date must NOT appear in the visible label — rendering
    // both the full timestamp and the relative phrase made the header status
    // string too long. The absolute time moves to the tooltip instead.
    expect(label.textContent).not.toMatch(/Apr 4/)
    // Should NOT use the sync end_time wording when upload metadata exists
    expect(screen.queryByText(/Requests synced/)).not.toBeInTheDocument()
  })

  it('exposes the original CSV filename and absolute upload time via tooltip (#1706)', () => {
    mockWithUpload('BunkRequests_2026-04-04.csv')
    renderAppLayout()
    const label = screen.getByText(/Requests uploaded/)
    const tooltipHost = label.closest('[title]') as HTMLElement | null
    expect(tooltipHost).not.toBeNull()
    const title = tooltipHost?.getAttribute('title') ?? ''
    expect(title).toContain('BunkRequests_2026-04-04.csv')
    // Absolute date preserved in the tooltip now that it's out of the label
    expect(title).toMatch(/Apr 4/)
  })

  // WAS: 'falls back to "Requests synced" wording when upload metadata is
  // missing'. That fallback was REMOVED by owner ruling 2026-08-28, and this
  // test is its inverse rather than its deletion.
  //
  // Request text reaches Kindred only by CSV upload; the `bunk_requests` job
  // re-processes the same file on the daily cron and reports success every
  // time. Measured on a dev snapshot, its last three runs were
  // `created=0 updated=0 skipped=2354`, so this branch rendered "Requests
  // synced 1 day ago" while the newest text on disk was eight days old — a job
  // that RAN reported as text that ARRIVED, which is the exact lie kindred#2481
  // and kindred#2570 were filed about. Weekend never had the fallback
  // (kindred#2570 ruled it out); summer now matches.
  it('renders NO request-text line when no CSV has ever been uploaded, even with a successful bunk_requests run', () => {
    syncStatusSpy.mockImplementation(() => ({
      data: {
        bunk_requests: {
          status: 'success',
          end_time: syncIso,
          start_time: syncIso,
          summary: { created: 0, updated: 0, skipped: 2354, errors: 0 },
        },
      } as SyncStatusResponse,
    }))
    renderAppLayout()
    expect(screen.queryByText(/Requests synced/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Requests uploaded/)).not.toBeInTheDocument()
  })

  // The other half of the same rule: the ASSIGNMENTS line is unaffected and must
  // still render off `bunk_assignments`, so removing the request-text fallback
  // cannot silently take the whole group down with it.
  it('still renders the assignments line when only bunk_assignments has run', () => {
    syncStatusSpy.mockImplementation(() => ({
      data: {
        bunk_assignments: { status: 'success', end_time: syncIso, start_time: syncIso },
      } as SyncStatusResponse,
    }))
    renderAppLayout()
    expect(screen.getByText(/Assignments synced/)).toBeInTheDocument()
    expect(screen.queryByText(/Requests/)).not.toBeInTheDocument()
  })
})

// Regression boundary: sentinel shape returned on 401, not the full
// pb.afterSend async-redirect race. See #1011 for the discriminated-union fix.
describe('AppLayout fresh-login crash guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Grant bunking.manage so the sync-status bar renders
    mockPerms = {
      hasPermission: (p: string) => p === 'bunking.manage',
      isAdmin: false,
    }
  })

  it('does not throw when syncStatus has bunk_assignments but no bunk_requests', () => {
    syncStatusSpy.mockImplementation(() => ({
      data: { bunk_assignments: { status: 'idle' } } as SyncStatusResponse,
    }))
    expect(() => renderAppLayout()).not.toThrow()
  })

  it('renders the nav without sync labels when end_times are absent', () => {
    syncStatusSpy.mockImplementation(() => ({ data: {} as SyncStatusResponse }))
    renderAppLayout()
    expect(screen.queryByText(/Assignments/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Requests/)).not.toBeInTheDocument()
  })
})

// Nav consolidation: /admin folded into /manage as one top-level tab (#1895,
// #450). There must be exactly one nav entry ("Manage"), never a separate
// "Admin" entry — an admin having two nav links into the same layout would
// be the old split resurfacing.
describe('AppLayout Manage nav link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    syncStatusSpy.mockImplementation(() => ({ data: null }))
  })

  it('shows no Manage link for a user with no manage-tab permission', () => {
    mockPerms = { hasPermission: () => false, isAdmin: false }
    renderAppLayout()
    expect(screen.queryByRole('link', { name: 'Manage' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull()
  })

  it('shows exactly one Manage link for a user with a single manage-tab permission', () => {
    mockPerms = { hasPermission: (p: string) => p === 'metrics.geo', isAdmin: false }
    renderAppLayout()
    expect(screen.getAllByRole('link', { name: 'Manage' })).toHaveLength(1)
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull()
  })

  it('shows one Manage link for an admin, not two nav entries', () => {
    mockPerms = { hasPermission: () => false, isAdmin: true }
    renderAppLayout()
    expect(screen.getAllByRole('link', { name: 'Manage' })).toHaveLength(1)
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull()
  })
})

/**
 * The weekend freshness stack — kindred#2570 (the ingest-age indicator) and
 * kindred#2478 §4 (the `Housing synced` line beside it and `Upload Bunk
 * Notes`). Both edit the same group, which is why they are one change.
 */
describe('AppLayout weekend freshness stack', () => {
  const housingIso = '2026-04-22T12:00:00.000Z'
  const uploadedAt = '2026-04-04T14:13:00.000Z'

  function mockWeekendSyncStatus(overrides: Partial<SyncStatusResponse> = {}) {
    syncStatusSpy.mockImplementation(() => ({
      data: {
        lodging_assignments: {
          status: 'success',
          end_time: housingIso,
          start_time: housingIso,
          summary: { created: 1, updated: 2, skipped: 0, errors: 0 },
        },
        _bunk_requests_upload: {
          filename: 'BunkRequests_2026-04-04.csv',
          uploaded_at: uploadedAt,
        },
        ...overrides,
      } as SyncStatusResponse,
    }))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPerms = { hasPermission: (p: string) => p === 'bunking.manage', isAdmin: false }
    mockWeekendShell = { session: undefined, isAdultWeekend: false }
    mockWeekendSyncStatus()
  })

  it('renders "Housing synced ..." off lodging_assignments', () => {
    renderAppLayout('/weekend/fc4')
    const label = screen.getByText(/Housing synced/)
    expect(label.textContent).toMatch(/ago/)
  })

  it('renders "Bunk notes uploaded ..." off the CSV upload timestamp (#2570)', () => {
    renderAppLayout('/weekend/fc4')
    const label = screen.getByText(/Bunk notes uploaded/)
    expect(label.textContent).toMatch(/ago/)
    // #1706: relative-only inline; the absolute time lives in the tooltip.
    expect(label.textContent).not.toMatch(/Apr 4/)
  })

  it('puts Housing synced BEFORE Bunk notes uploaded, mirroring summer', () => {
    renderAppLayout('/weekend/fc4')
    const housing = screen.getByText(/Housing synced/)
    const notes = screen.getByText(/Bunk notes uploaded/)
    // Node.DOCUMENT_POSITION_FOLLOWING === 4
    expect(housing.compareDocumentPosition(notes) & 4).toBeTruthy()
  })

  it('exposes the CSV filename and absolute upload time via tooltip', () => {
    renderAppLayout('/weekend/fc4')
    const label = screen.getByText(/Bunk notes uploaded/)
    const tooltipHost = label.closest('[title]') as HTMLElement | null
    expect(tooltipHost).not.toBeNull()
    const title = tooltipHost?.getAttribute('title') ?? ''
    expect(title).toContain('BunkRequests_2026-04-04.csv')
    expect(title).toMatch(/Apr 4/)
  })

  it("does NOT render summer's own labels on the weekend surface", () => {
    mockWeekendSyncStatus({
      bunk_assignments: { status: 'success', end_time: housingIso },
    } as Partial<SyncStatusResponse>)
    renderAppLayout('/weekend/fc4')
    expect(screen.queryByText(/Assignments synced/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Requests uploaded/)).not.toBeInTheDocument()
  })

  // kindred#2570: `bunking_notes` reaches Kindred ONLY by CSV, so summer's
  // "Requests synced" fallback off bunk_requests.end_time would report the
  // hourly job's `success created=0 updated=0 skipped=1732` as freshness —
  // which is precisely the lie the issue is about.
  it('renders NO bunk-notes line at all when no CSV has ever been uploaded', () => {
    syncStatusSpy.mockImplementation(() => ({
      data: {
        lodging_assignments: { status: 'success', end_time: housingIso },
        bunk_requests: { status: 'success', end_time: housingIso },
      } as SyncStatusResponse,
    }))
    renderAppLayout('/weekend/fc4')
    expect(screen.getByText(/Housing synced/)).toBeInTheDocument()
    expect(screen.queryByText(/Bunk notes/)).not.toBeInTheDocument()
    expect(screen.queryByText(/synced.*ago/)).not.toHaveTextContent(/Requests/)
    expect(screen.queryByText(/Requests synced/)).not.toBeInTheDocument()
  })

  it('renders nothing at all without bunking.manage', () => {
    mockPerms = { hasPermission: () => false, isAdmin: false }
    renderAppLayout('/weekend/fc4')
    expect(screen.queryByText(/Housing synced/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Bunk notes uploaded/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('bunk-requests-upload')).toBeNull()
  })

  it("renders Upload Bunk Notes, not summer's Upload Requests", () => {
    renderAppLayout('/weekend/fc4')
    const upload = screen.getByTestId('bunk-requests-upload')
    expect(upload.getAttribute('data-label')).toBe('Upload Bunk Notes')
  })

  it("leaves summer's upload label at its default", () => {
    renderAppLayout('/summer/sessions')
    const upload = screen.getByTestId('bunk-requests-upload')
    expect(upload.getAttribute('data-label')).toBe('(default)')
  })
})

/**
 * kindred#2478 §5.1: on an ADULT weekend the housing half is hidden, because
 * `GetFamilyCampSessionCMIDs` filters `session_type = 'family'` exactly — the
 * adult sessions are not in the bounded cohort, and `lodging_assignments` is a
 * transform that rewrites their rows from custom values up to seven days old.
 * The CSV lane is program-agnostic and is NOT affected.
 */
describe('AppLayout adult weekend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPerms = { hasPermission: (p: string) => p === 'bunking.manage', isAdmin: false }
    mockWeekendShell = { session: { session_type: 'adult' }, isAdultWeekend: true }
    syncStatusSpy.mockImplementation(() => ({
      data: {
        lodging_assignments: { status: 'success', end_time: '2026-04-22T12:00:00.000Z' },
        _bunk_requests_upload: {
          filename: 'BunkRequests_2026-04-04.csv',
          uploaded_at: '2026-04-04T14:13:00.000Z',
        },
      } as SyncStatusResponse,
    }))
  })

  it('hides the Housing synced line', () => {
    renderAppLayout('/weekend/ww')
    expect(screen.queryByText(/Housing synced/)).not.toBeInTheDocument()
  })

  it('still renders Bunk notes uploaded — the CSV lane is program-agnostic', () => {
    renderAppLayout('/weekend/ww')
    expect(screen.getByText(/Bunk notes uploaded/)).toBeInTheDocument()
  })

  it('still renders Upload Bunk Notes', () => {
    renderAppLayout('/weekend/ww')
    expect(screen.getByTestId('bunk-requests-upload').getAttribute('data-label')).toBe(
      'Upload Bunk Notes'
    )
  })
})

/**
 * kindred#2478 §4 — `Refresh Housing` in the weekend action row.
 *
 * Placement mirrors summer four for four: the upload action, then the refresh
 * action. Hidden on adult weekends for the same reason the `Housing synced`
 * line is (§5.1), and hidden without `bunking.manage` like everything else in
 * the row.
 */
describe('AppLayout Refresh Housing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPerms = { hasPermission: (p: string) => p === 'bunking.manage', isAdmin: false }
    mockWeekendShell = { session: { session_type: 'family' }, isAdultWeekend: false }
    syncStatusSpy.mockImplementation(() => ({
      data: {
        lodging_assignments: { status: 'success', end_time: '2026-04-22T12:00:00.000Z' },
      } as SyncStatusResponse,
    }))
  })

  it('renders on a family weekend, after the upload action', () => {
    renderAppLayout('/weekend/fc4')
    const upload = screen.getByTestId('bunk-requests-upload')
    const refresh = screen.getByRole('button', { name: /Refresh Housing/i })
    // Node.DOCUMENT_POSITION_FOLLOWING === 4
    expect(upload.compareDocumentPosition(refresh) & 4).toBeTruthy()
  })

  it('is hidden on an adult weekend — the chain would refresh nothing (§5.1)', () => {
    mockWeekendShell = { session: { session_type: 'adult' }, isAdultWeekend: true }
    renderAppLayout('/weekend/ww')
    expect(screen.queryByRole('button', { name: /Refresh Housing/i })).not.toBeInTheDocument()
    // The CSV lane is program-agnostic and stays.
    expect(screen.getByTestId('bunk-requests-upload')).toBeInTheDocument()
  })

  it('is hidden without bunking.manage', () => {
    mockPerms = { hasPermission: () => false, isAdmin: false }
    renderAppLayout('/weekend/fc4')
    expect(screen.queryByRole('button', { name: /Refresh Housing/i })).not.toBeInTheDocument()
  })

  it('does not appear on the summer surface', () => {
    renderAppLayout('/summer/sessions')
    expect(screen.queryByRole('button', { name: /Refresh Housing/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Refresh Bunking/i })).toBeInTheDocument()
  })
})

/**
 * kindred#2587 — `Refresh Bunking` used to leave the summer board stale for up
 * to thirty minutes: `refreshBunkingMutation` had `onError` and nothing else,
 * and `hooks/session/useSessionData.ts` inherits the app default 30 minute
 * `staleTime`.
 *
 * ⛔ The obvious fix is harmful and the issue says so: `POST /refresh-bunking`
 * returns `200 {"status":"started"}` immediately while `RunSyncSequence` runs
 * in a goroutine for ~4.7 s, so an `onSuccess` invalidation would refetch the
 * OLD rows and re-mark them fresh for another thirty minutes. The invalidation
 * must hang off COMPLETION DETECTION, which is what these two tests separate.
 */
describe('AppLayout Refresh Bunking staleness (kindred#2587)', () => {
  const CLEANUP_BASELINE = '2026-04-22T09:00:05.000Z'
  let bunksFromServer = 'Bunk 4'

  function bunkingStatus(overrides: Record<string, unknown> = {}): SyncStatusResponse {
    return {
      bunks: { status: 'success', end_time: '2026-04-22T09:00:01.000Z' },
      bunk_plans: { status: 'success', end_time: '2026-04-22T09:00:02.000Z' },
      bunk_assignments: { status: 'success', end_time: '2026-04-22T09:00:03.000Z' },
      stranded_assignment_cleanup: { status: 'success', end_time: CLEANUP_BASELINE },
      ...overrides,
    } as unknown as SyncStatusResponse
  }

  /** What the bunking board renders, on the real inline key from useSessionBunks. */
  function BunksProbe() {
    const { data } = useQuery({
      queryKey: ['bunks', '4011', 4011, []],
      queryFn: () => Promise.resolve(bunksFromServer),
    })
    return <div data-testid="board-bunks">{data ?? 'loading'}</div>
  }

  function renderSummerShell() {
    // The app's REAL cache policy — this bug only exists because of it.
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30 * 60 * 1000,
          gcTime: 60 * 60 * 1000,
          refetchOnWindowFocus: false,
          retry: false,
        },
      },
    })
    const tree = (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/summer/sessions']}>
          <BunksProbe />
          <AppLayout />
        </MemoryRouter>
      </QueryClientProvider>
    )
    const utils = render(tree)
    return { ...utils, replay: () => utils.rerender(tree) }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPerms = { hasPermission: (p: string) => p === 'bunking.manage', isAdmin: false }
    mockWeekendShell = { session: undefined, isAdultWeekend: false }
    bunksFromServer = 'Bunk 4'
    syncStatusSpy.mockImplementation(() => ({ data: bunkingStatus() }))
  })

  it('does NOT invalidate when the endpoint merely answers "started"', async () => {
    const { replay } = renderSummerShell()
    await screen.findByText('Bunk 4')

    fireEvent.click(screen.getByRole('button', { name: /Refresh Bunking/i }))
    // The chain is still running; the server has not written anything yet.
    bunksFromServer = 'Bunk 7'
    syncStatusSpy.mockImplementation(() => ({
      data: bunkingStatus({ bunks: { status: 'running', start_time: '2026-04-22T10:00:01.000Z' } }),
    }))
    replay()

    // Refetching HERE would re-mark the old rows fresh for another 30 minutes.
    await waitFor(() => expect(screen.getByTestId('board-bunks').textContent).toBe('Bunk 4'))
  })

  it('lands the refreshed bunks on the board at the cutover', async () => {
    const { replay } = renderSummerShell()
    await screen.findByText('Bunk 4')

    fireEvent.click(screen.getByRole('button', { name: /Refresh Bunking/i }))
    bunksFromServer = 'Bunk 7'
    syncStatusSpy.mockImplementation(() => ({
      data: bunkingStatus({
        stranded_assignment_cleanup: { status: 'success', end_time: '2026-04-22T10:00:06.000Z' },
      }),
    }))
    replay()

    // WITHOUT the invalidation this stays "Bunk 4" for thirty minutes.
    await waitFor(() => expect(screen.getByTestId('board-bunks').textContent).toBe('Bunk 7'))
  })
})
