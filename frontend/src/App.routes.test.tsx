/**
 * Route-wiring test for the /manage and /admin blocks in App.tsx.
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
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Navigate, useParams } from 'react-router'
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

// Forwards :category the way a bare <Navigate> cannot — mirrors the redirect
// App.tsx uses for /admin/config/:category -> /manage/config/:category.
function AdminConfigRedirect() {
  const { category } = useParams()
  return <Navigate to={`/manage/config/${category}`} replace />
}

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
      <Route path="/admin" element={<Navigate to="/manage" replace />} />
      <Route path="/admin/sync" element={<Navigate to="/manage/sync" replace />} />
      <Route path="/admin/config/:category" element={<AdminConfigRedirect />} />
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

describe('/manage and /admin route wiring', () => {
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

  it('redirects /admin, /admin/sync and /admin/config/:category to /manage equivalents', () => {
    mockIsAdmin = true

    renderAt('/admin')
    expect(screen.getByText('Manage Redirect Landed')).toBeInTheDocument()

    renderAt('/admin/sync')
    expect(screen.getByText('Sync Content')).toBeInTheDocument()

    renderAt('/admin/config/solver')
    expect(screen.getByText('Config Content')).toBeInTheDocument()
  })
})
