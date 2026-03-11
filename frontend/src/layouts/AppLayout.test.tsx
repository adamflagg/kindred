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

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: () => false,
    isAdmin: false,
  }),
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

vi.mock('../hooks/useSyncStatusAPI', () => ({
  useSyncStatusAPI: () => ({ data: null }),
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

describe('Help Menu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
