import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

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
const syncStatusSpy = vi.fn<(opts?: unknown) => { data: unknown }>(() => ({ data: null }))
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

  it('renders all program labels in the mobile menu', () => {
    renderAppLayout()
    // Open mobile menu via hamburger button
    const menuButton = screen.getByLabelText('Toggle navigation menu')
    fireEvent.click(menuButton)

    // Mobile buttons use short labels
    const summerButtons = screen.getAllByText('Summer')
    expect(summerButtons.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Weekend')).toBeInTheDocument()
    expect(screen.getByText('Analytics')).toBeInTheDocument()
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
    const iso = '2026-04-22T12:00:00.000Z' // in the past relative to any test run
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
      },
    }))
  })

  it('renders "Assignments synced ..." label with lowercase synced', () => {
    renderAppLayout()
    // The label should read "Assignments synced <relative time>"
    expect(screen.getByText(/Assignments synced/)).toBeInTheDocument()
  })

  it('renders "Requests synced ..." label with lowercase synced', () => {
    renderAppLayout()
    expect(screen.getByText(/Requests synced/)).toBeInTheDocument()
  })

  it('Requests sync label exposes richer detail via tooltip on hover', () => {
    renderAppLayout()
    const requestsLabel = screen.getByText(/Requests synced/)
    // Find the nearest element carrying the tooltip (title attribute)
    const tooltipHost = requestsLabel.closest('[title]') as HTMLElement | null
    expect(tooltipHost).not.toBeNull()
    const title = tooltipHost?.getAttribute('title') ?? ''
    // Tooltip should contain an exact timestamp (ISO-ish) for richer sync detail
    expect(title).toMatch(/2026-04-22/)
  })
})
