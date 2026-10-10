/**
 * AppLayout on Camperships pages (spec §3.1, §3.3; D7, D64, D65). The mocks mirror
 * AppLayout.test.tsx's, trimmed to what these cases touch.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Program } from '../contexts/ProgramContext'

let granted: string[] = []
let savedProgram: Program | null = null

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', name: 'Test User', email: 'test@example.com', avatar: '' },
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(),
  }),
}))
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (p: string) => granted.includes(p),
    hasAnyPermission: (...ps: string[]) => ps.some((p) => granted.includes(p)),
    isAdmin: false,
  }),
}))
vi.mock('../contexts/ProgramContext', () => ({
  useProgram: () => ({ currentProgram: savedProgram, setProgram: vi.fn(), clearProgram: vi.fn() }),
}))
vi.mock('../hooks/useSyncStatusAPI', async (importActual) => ({
  ...(await importActual<typeof import('../hooks/useSyncStatusAPI')>()),
  useSyncStatusAPI: () => ({ data: null }),
}))
vi.mock('../hooks/useTour', () => ({ useTour: () => ({ tourId: null, replay: vi.fn() }) }))
vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }) }))
vi.mock('../services/sync', () => ({
  syncService: { refreshBunking: vi.fn(), refreshFamilyCamp: vi.fn() },
}))
vi.mock('../hooks/useWeekendShellSession', () => ({
  useWeekendShellSession: () => ({ session: undefined, isAdultWeekend: false }),
}))
vi.mock('../lib/pocketbase', () => ({
  pb: {
    files: { getURL: vi.fn(() => '') },
    authStore: { record: { id: 'user-1' }, onChange: vi.fn(), token: 'test-jwt', isValid: true },
  },
}))
vi.mock('../components/YearSelector', () => ({
  default: ({ aid }: { aid?: boolean }) => (
    <div data-testid="year-selector" data-aid={aid ? 'true' : undefined}>
      2027
    </div>
  ),
}))
vi.mock('../components/CacheStatus', () => ({ default: () => null }))
vi.mock('../components/BunkRequestsUpload', () => ({ default: () => null }))
vi.mock('../components/BrandedLogo', () => ({ BrandedLogo: () => <div>Logo</div> }))
vi.mock('../components/VersionInfo', () => ({ VersionInfo: () => null }))
vi.mock('../components/FeedbackModal', () => ({ FeedbackModal: () => null }))
vi.mock('../components/ViewAsSwitcher', () => ({ ViewAsSwitcher: () => null }))
vi.mock('../hooks/useCanViewAs', () => ({ useCanViewAs: () => false }))
vi.mock('../components/camperships/shell/AidFreshness', () => ({
  AidFreshness: () => <div data-testid="aid-freshness" />,
}))
vi.mock('../components/camperships/shell/AidSecondaryBarRight', () => ({
  AidSecondaryBarRight: () => <div data-testid="aid-bar-right" />,
}))

import { AppLayout } from './AppLayout'

const VIEW = 'financial_aid.view'
const SUMMARY = 'financial_aid.summary'

function renderAt(route: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[route]}>
        <AppLayout />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  granted = []
  savedProgram = null
})

describe('AppLayout on a Camperships page', () => {
  // Owner ruling 2026-10-01 (supersedes "then Users after a divider", D7/D64/D65):
  // Users and Manage left the bar for the user menu, so the divider that ended the
  // section has nothing to separate and is gone.
  // Final audit M-E5: only the Camperships subbar gets the kit's white 26px Season picker.
  // chrome-m1: the opaque wrapper hid body::before's grid; Camperships alone lets it show.
  it('lets the page grid show on Camperships only (the wrapper is not opaque there)', () => {
    granted = [VIEW]
    const aid = renderAt('/aid/requests')
    expect(aid.container.firstElementChild).not.toHaveClass('bg-background')
    aid.unmount()
    const summer = renderAt('/bunking')
    expect(summer.container.firstElementChild).toHaveClass('bg-background')
  })

  // chrome-4 (owner, every program): the subbar row is 48px and <main> has 20px above, as the mock.
  it.each(['/aid/requests', '/bunking'])(
    'has a 48px subbar row and 20px main top on %s',
    (route) => {
      granted = [VIEW]
      const { container } = renderAt(route)
      const main = container.querySelector('main')
      expect(main).toHaveClass('pt-5', 'pb-6')
      expect(main).not.toHaveClass('py-6')
      expect(container.querySelector('.h-12.items-center.justify-between')).not.toBeNull()
      expect(container.querySelector('.h-14.items-center.justify-between')).toBeNull()
    }
  )

  it('asks for the kit-dressed Season picker', () => {
    granted = [VIEW]
    renderAt('/aid/requests')
    expect(screen.getByTestId('year-selector')).toHaveAttribute('data-aid', 'true')
  })

  it('shows its five links and no Campers link; Users lives in the user menu, not the bar', () => {
    granted = [VIEW]
    renderAt('/aid/requests')

    for (const label of ['Requests', 'Money', 'Season', 'Reports']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
    // Today is parked: not in the nav (the route still answers by URL).
    expect(screen.queryByRole('link', { name: 'Today' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Campers' })).toBeNull()
    expect(screen.queryByTestId('aid-nav-divider')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Manage' })).toBeNull()

    fireEvent.click(screen.getByText('Test User'))
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/users')
    // No manage-tab permission granted: no Manage item.
    expect(screen.queryByRole('link', { name: 'Manage' })).toBeNull()
  })

  it('offers Manage in the user menu to someone with a manage-tab permission', () => {
    granted = [VIEW, 'metrics.geo']
    renderAt('/aid/requests')

    fireEvent.click(screen.getByText('Test User'))
    expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/manage')
    fireEvent.click(screen.getByRole('link', { name: 'Manage' }))
    expect(screen.queryByRole('link', { name: 'My Account' })).toBeNull()
  })

  it('shows a summary-only user Reports alone (D65)', () => {
    granted = [SUMMARY]
    renderAt('/aid/reports/development')

    expect(screen.getByRole('link', { name: 'Reports' })).toBeInTheDocument()
    for (const label of ['Today', 'Requests', 'Money', 'Season']) {
      expect(screen.queryByRole('link', { name: label })).toBeNull()
    }
  })

  it('shows a pasted /aid link as summer when the user cannot open Camperships', () => {
    granted = []
    renderAt('/aid/requests')

    expect(screen.getByRole('link', { name: 'Campers' })).toBeInTheDocument()
    // Not Camperships: none of its section links are in the bar.
    for (const label of ['Today', 'Requests', 'Money', 'Season', 'Reports']) {
      expect(screen.queryByRole('link', { name: label })).toBeNull()
    }
    expect(screen.queryByTestId('aid-freshness')).toBeNull()
    expect(screen.getByRole('button', { name: 'Summer' })).toBeInTheDocument()
  })

  it('marks the section you are in, and only that one', () => {
    granted = [VIEW]
    renderAt('/aid/season/rules')

    expect(screen.getByRole('link', { name: 'Season' })).toHaveClass('active')
    expect(screen.getByRole('link', { name: 'Requests' })).not.toHaveClass('active')
  })

  it('carries the season and the as-of on section links (D15)', () => {
    granted = [VIEW]
    renderAt('/aid/requests?year=2025&as_of=2026-04-01')

    const grants = screen.getByRole('link', { name: 'Money' }).getAttribute('href') ?? ''
    expect(new URLSearchParams(grants.split('?')[1]).get('year')).toBe('2027')
    expect(new URLSearchParams(grants.split('?')[1]).get('as_of')).toBe('2026-04-01')
    expect(grants.startsWith('/aid/money?')).toBe(true)
  })

  it('points the logo at /aid', () => {
    granted = [VIEW]
    renderAt('/aid/money/ledger')

    expect(screen.getByText('Logo').closest('a')).toHaveAttribute('href', '/aid')
  })

  it('puts the season, the freshness chips and the Remaining line in the secondary bar (§3.4)', () => {
    granted = [VIEW]
    renderAt('/aid/requests')

    expect(screen.getByTestId('year-selector')).toBeInTheDocument()
    expect(screen.getByTestId('aid-freshness')).toBeInTheDocument()
    expect(screen.getByTestId('aid-bar-right')).toBeInTheDocument()
  })

  // Regression guard, not red-first (Ruling 2026-10-01 (plan review)): nothing renders them on
  // main yet; this pins that summer stays clean once they exist.
  it('keeps them off the other programs', () => {
    granted = [VIEW]
    renderAt('/summer/sessions')

    expect(screen.queryByTestId('aid-freshness')).toBeNull()
    expect(screen.queryByTestId('aid-bar-right')).toBeNull()
  })
})

describe('the program menu', () => {
  // Regression guard: Task 2 already shipped the switcher filter, so this passes before Task 4.
  it('lists Camperships only for someone who can open it', async () => {
    renderAt('/summer/sessions')
    await userEvent.click(screen.getByRole('button', { name: 'Summer' }))
    expect(screen.queryByRole('button', { name: /Camperships/ })).toBeNull()
  })

  it('lists Camperships for a view holder', async () => {
    granted = [VIEW]
    renderAt('/summer/sessions')
    await userEvent.click(screen.getByRole('button', { name: 'Summer' }))
    expect(screen.getByRole('button', { name: /Camperships/ })).toBeInTheDocument()
  })

  it("falls back to summer's nav when the saved program can no longer be opened", () => {
    savedProgram = 'aid'
    renderAt('/campers')

    expect(screen.getByRole('link', { name: 'Campers' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Today' })).toBeNull()
  })
})
