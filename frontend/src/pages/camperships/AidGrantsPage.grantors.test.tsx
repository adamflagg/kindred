/**
 * Grants for development and the Rules' link in (owner 10-06, rulings:676: finance AND development
 * edit grantors in Grants › Grantors; development holds grantors + summary + funding_sources, no view).
 * The page's own reads are real; the tab bodies and the directory are stand-ins (their own tests).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { aidHref } from '../../components/camperships/kit/asOf'
import AidGrantsPage from './AidGrantsPage'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
let granted: string[] = []
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
vi.mock('../PermissionDeniedPage', () => ({ default: () => <div>Permission denied</div> }))
vi.mock('../../components/camperships/grants/RegisterTab', () => ({
  RegisterTab: () => <div>Register body</div>,
}))
vi.mock('../../components/camperships/grants/NeedsAttentionTab', () => ({
  NeedsAttentionTab: () => <div>Needs attention body</div>,
}))
vi.mock('../../components/camperships/grants/ExpectedTab', () => ({
  ExpectedTab: () => <div>Expected body</div>,
}))
vi.mock('../../components/camperships/grants/GrantorsDirectory', () => ({
  GrantorsDirectory: ({
    descriptionHref,
  }: {
    descriptionHref?: (d: { source_id: string }) => string | null
  }) => (
    <div>{`Grantors directory, descriptions open ${descriptionHref?.({ source_id: 'src1' }) ?? 'nothing'}`}</div>
  ),
}))

const DEVELOPMENT = [
  'financial_aid.summary',
  'financial_aid.funding_sources',
  'financial_aid.grantors',
]
const FINANCE = [
  'financial_aid.view',
  'financial_aid.casework',
  'financial_aid.rules',
  'financial_aid.grantors',
]
/** What development may read on this page: the definitions (view or summary) and the grantors. */
const DEVELOPMENT_READS = ['/api/financial-aid/definitions', '/api/financial-aid/grantors']

let fetchSpy: MockInstance<typeof fetch>
beforeEach(() => {
  granted = DEVELOPMENT
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ surface: 'grants', notes: [] }), { status: 200 })
      )
    )
})
afterEach(() => fetchSpy.mockRestore())

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname + search}</div>
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/aid/grants/:tab?" element={<AidGrantsPage />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('Grants for development (rulings:676)', () => {
  it('lands a grantors-only user on Grantors and shows no other tab', async () => {
    renderAt('/aid/grants')
    expect(
      await screen.findByText('Grantors directory, descriptions open nothing')
    ).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/grants/grantors?year=2027')
    expect(screen.getByRole('link', { name: 'Grantors' })).toBeInTheDocument()
    for (const name of ['Register', 'Needs attention', 'Expected']) {
      expect(screen.queryByRole('link', { name })).toBeNull()
    }
  })

  it('⚠ fires no read only view may make (no /grants/{year}): every request is one development may send', async () => {
    renderAt('/aid/grants/grantors')
    await screen.findByText('Grantors directory, descriptions open nothing')
    await settle()
    const urls = fetchSpy.mock.calls.map(([url]) => String(url))
    expect(urls.some((url) => url.startsWith('/api/financial-aid/grants/'))).toBe(false)
    for (const url of urls) {
      expect(DEVELOPMENT_READS.some((allowed) => url.startsWith(allowed))).toBe(true)
    }
  })

  it('refuses the Register to development rather than sending it away (D76)', () => {
    renderAt('/aid/grants/register')
    expect(screen.getByText('Permission denied')).toBeInTheDocument()
  })

  it('still opens on the Register for view holders, whose descriptions open Money › Sources', async () => {
    granted = FINANCE
    renderAt('/aid/grants')
    expect(await screen.findByText('Register body')).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/grants/register?year=2027')
  })

  it('resolves the Rules\' "Managed in Grants ›" link to this tab (RulesTab.tsx\'s grantsHref)', async () => {
    granted = FINANCE
    // Built exactly as season/rules/RulesTab.tsx builds it.
    renderAt(aidHref('/aid/grants/grantors', { year: 2027, asOf: { kind: 'live' } }))
    expect(
      await screen.findByText(
        'Grantors directory, descriptions open /aid/money/sources?row=src1&year=2027'
      )
    ).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/grants/grantors?year=2027')
  })
})
