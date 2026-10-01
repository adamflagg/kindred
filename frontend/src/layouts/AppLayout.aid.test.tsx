/**
 * AppLayout on Camperships pages (spec §3.1, §3.3; D7, D64, D65). The mocks mirror
 * AppLayout.test.tsx's, trimmed to what these cases touch.
 */
import { render, screen } from '@testing-library/react'
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
  default: () => <div data-testid="year-selector">2027</div>,
}))
vi.mock('../components/CacheStatus', () => ({ default: () => null }))
vi.mock('../components/BunkRequestsUpload', () => ({ default: () => null }))
vi.mock('../components/BrandedLogo', () => ({ BrandedLogo: () => <div>Logo</div> }))
vi.mock('../components/VersionInfo', () => ({ VersionInfo: () => null }))
vi.mock('../components/FeedbackModal', () => ({ FeedbackModal: () => null }))
vi.mock('../components/ViewAsSwitcher', () => ({ ViewAsSwitcher: () => null }))
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
  it('shows its six links, no Campers link, then Users after a divider (D7, D64, D65)', () => {
    granted = [VIEW]
    renderAt('/aid/requests')

    for (const label of ['Today', 'Requests', 'Grants', 'Money', 'Season', 'Reports']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByRole('link', { name: 'Campers' })).toBeNull()
    const divider = screen.getByTestId('aid-nav-divider')
    const users = screen.getByRole('link', { name: 'Users' })
    expect(divider).toBeInTheDocument()
    expect(divider.compareDocumentPosition(users) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows a summary-only user Reports alone (D65)', () => {
    granted = [SUMMARY]
    renderAt('/aid/reports/development')

    expect(screen.getByRole('link', { name: 'Reports' })).toBeInTheDocument()
    for (const label of ['Today', 'Requests', 'Grants', 'Money', 'Season']) {
      expect(screen.queryByRole('link', { name: label })).toBeNull()
    }
  })

  it('shows a pasted /aid link as summer when the user cannot open Camperships', () => {
    granted = []
    renderAt('/aid/requests')

    expect(screen.getByRole('link', { name: 'Campers' })).toBeInTheDocument()
    expect(screen.queryByTestId('aid-nav-divider')).toBeNull()
    expect(screen.queryByTestId('aid-freshness')).toBeNull()
    expect(screen.getByRole('button', { name: 'Summer' })).toBeInTheDocument()
  })

  it('marks the section you are in, and only that one', () => {
    granted = [VIEW]
    renderAt('/aid/season/rules')

    expect(screen.getByRole('link', { name: 'Season' })).toHaveClass('active')
    expect(screen.getByRole('link', { name: 'Today' })).not.toHaveClass('active')
  })

  it('marks Today only on /aid itself', () => {
    granted = [VIEW]
    renderAt('/aid')

    expect(screen.getByRole('link', { name: 'Today' })).toHaveClass('active')
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
