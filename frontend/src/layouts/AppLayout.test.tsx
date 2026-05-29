import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
  syncService: { refreshBunking: vi.fn() },
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
  default: () => null,
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

function renderAppLayout() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
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

  it('passes enabled: false when user lacks bunking.manage', () => {
    mockPerms = { hasPermission: () => false, isAdmin: false }
    renderAppLayout()
    const lastCall = syncStatusSpy.mock.calls.at(-1)
    expect(lastCall?.[0]).toEqual({ enabled: false })
  })

  it('passes enabled: true when user has bunking.manage', () => {
    mockPerms = {
      hasPermission: (p: string) => p === 'bunking.manage',
      isAdmin: false,
    }
    renderAppLayout()
    const lastCall = syncStatusSpy.mock.calls.at(-1)
    expect(lastCall?.[0]).toEqual({ enabled: true })
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
      } as SyncStatusResponse,
    }))
  })

  it('renders "Assignments synced ..." label with lowercase synced', () => {
    renderAppLayout()
    expect(screen.getByText(/Assignments synced/)).toBeInTheDocument()
  })

  it('renders "Requests synced ..." label with lowercase synced', () => {
    renderAppLayout()
    expect(screen.getByText(/Requests synced/)).toBeInTheDocument()
  })

  it('Requests sync label exposes richer detail via tooltip on hover', () => {
    renderAppLayout()
    const requestsLabel = screen.getByText(/Requests synced/)
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

  it('falls back to "Requests synced" wording when upload metadata is missing', () => {
    syncStatusSpy.mockImplementation(() => ({
      data: {
        bunk_requests: {
          status: 'success',
          end_time: syncIso,
          start_time: syncIso,
          summary: { created: 0, updated: 0, skipped: 0, errors: 0 },
        },
      } as SyncStatusResponse,
    }))
    renderAppLayout()
    expect(screen.getByText(/Requests synced/)).toBeInTheDocument()
    expect(screen.queryByText(/Requests uploaded/)).not.toBeInTheDocument()
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
