/**
 * Route-wiring test for the /manage block in App.tsx.
 *
 * App.tsx wraps its routes in a heavy provider stack (theme, query client,
 * auth, program, year, scenario, lock-group) and hardcodes BrowserRouter, so
 * rendering the real tree isn't practical here. Per the plan, this instead
 * reconstructs the route subtree with MemoryRouter, using the real guard
 * components (RequirePermission, AdminRoute) so the *pattern* — per-route
 * guards after the layout's blanket check was removed — is genuinely
 * exercised. Task 4 (manageTabs.guard.test.ts) closes the gap this leaves:
 * it source-greps App.tsx itself to prove the real route table actually
 * matches this pattern.
 *
 * The /admin block is gone entirely — see the retirement test at the bottom.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { MemoryRouter, Routes, Route } from 'react-router'
import { Permission } from './constants/permissions'
import { RequirePermission } from './components/RequirePermission'
import { AdminRoute } from './components/AdminRoute'

const mockHasPermission = vi.fn()
let mockIsAdmin = false

vi.mock('./hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: mockHasPermission,
    hasAnyPermission: (...perms: string[]) => perms.some(mockHasPermission),
    isAdmin: mockIsAdmin,
    permissions: [],
  }),
}))

vi.mock('./contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false }),
}))

function RoutesUnderTest() {
  return (
    <Routes>
      <Route
        path="/manage/geo"
        element={
          <RequirePermission permission={Permission.METRICS_GEO}>
            <div>Geo Content</div>
          </RequirePermission>
        }
      />
      <Route
        path="/manage/sync"
        element={
          <AdminRoute>
            <div>Sync Content</div>
          </AdminRoute>
        }
      />
      <Route
        path="/manage/config/:category"
        element={
          <AdminRoute>
            <div>Config Content</div>
          </AdminRoute>
        }
      />
      <Route path="/manage" element={<div>Manage Redirect Landed</div>} />
    </Routes>
  )
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RoutesUnderTest />
    </MemoryRouter>
  )
}

describe('/manage route wiring', () => {
  beforeEach(() => {
    mockHasPermission.mockReset()
    mockIsAdmin = false
  })

  it('renders geo content for a user with metrics.geo', () => {
    mockHasPermission.mockImplementation((p: string) => p === Permission.METRICS_GEO)
    renderAt('/manage/geo')
    expect(screen.getByText('Geo Content')).toBeInTheDocument()
  })

  it('denies /manage/sync to a non-admin, even with other permissions', () => {
    // This is the case that proves §2 landed: a blanket isAdmin check on the
    // layout would have been bypassed by nothing here, but a per-route
    // AdminRoute correctly locks out someone who only holds metrics.geo.
    mockHasPermission.mockImplementation((p: string) => p === Permission.METRICS_GEO)
    renderAt('/manage/sync')
    expect(screen.queryByText('Sync Content')).not.toBeInTheDocument()
    expect(screen.getByText(/Access Restricted/i)).toBeInTheDocument()
  })

  it('denies /manage/config/solver to a non-admin', () => {
    mockHasPermission.mockImplementation((p: string) => p === Permission.METRICS_GEO)
    renderAt('/manage/config/solver')
    expect(screen.queryByText('Config Content')).not.toBeInTheDocument()
    expect(screen.getByText(/Access Restricted/i)).toBeInTheDocument()
  })

  it('renders sync content for an admin', () => {
    mockIsAdmin = true
    renderAt('/manage/sync')
    expect(screen.getByText('Sync Content')).toBeInTheDocument()
  })

  it('renders config content for an admin', () => {
    mockIsAdmin = true
    renderAt('/manage/config/solver')
    expect(screen.getByText('Config Content')).toBeInTheDocument()
  })
})

/**
 * The nav consolidation originally kept /admin/* as permanent redirects to
 * preserve bookmarks. That was retired: the repo owner was the only user of
 * those paths, so there are no third-party bookmarks to honour and the
 * redirects were pure carrying cost.
 *
 * Source-grep rather than a render test, for the same reason as
 * manageTabs.guard.test.ts — this asserts against the *real* route table, not
 * a reconstruction, so a reintroduced /admin route can't slip past.
 */
describe('/admin route retirement', () => {
  const appSource = readFileSync(resolve(__dirname, './App.tsx'), 'utf-8')

  it('declares no /admin route path anywhere in App.tsx', () => {
    // Covers both the absolute form (path="/admin...") and the nested form
    // (path="admin") that /summer/admin used.
    expect(appSource).not.toMatch(/path="\/admin/)
    expect(appSource).not.toMatch(/path="admin"/)
  })

  it('keeps no redirect helper for the retired /admin/config/:category path', () => {
    expect(appSource).not.toContain('AdminConfigCategoryRedirect')
  })
})
