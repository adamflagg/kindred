import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'

// Mock hooks
const mockHasPermission = vi.fn()
let mockIsAdmin = false

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (perm: string) => mockIsAdmin || mockHasPermission(perm),
    hasAnyPermission: (...perms: string[]) => mockIsAdmin || perms.some(mockHasPermission),
    isAdmin: mockIsAdmin,
    permissions: [],
  }),
}))

// Must import after mocks
const { ManageLayout } = await import('./ManageLayout')

describe('ManageLayout', () => {
  beforeEach(() => {
    mockHasPermission.mockReset()
    mockIsAdmin = false
  })

  it('renders the Management header', () => {
    mockHasPermission.mockReturnValue(true)
    render(
      <MemoryRouter initialEntries={['/manage/geo']}>
        <Routes>
          <Route element={<ManageLayout />}>
            <Route path="/manage/geo" element={<div>Geo Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByText('Management')).toBeTruthy()
  })

  it('hides tab bar when only one tab is visible', () => {
    // Only geo permission
    mockHasPermission.mockImplementation((perm: string) => perm === 'metrics.geo')
    render(
      <MemoryRouter initialEntries={['/manage/geo']}>
        <Routes>
          <Route element={<ManageLayout />}>
            <Route path="/manage/geo" element={<div>Geo Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )
    // Should NOT have tab navigation links
    expect(screen.queryByRole('link', { name: /Geo Data/i })).toBeNull()
    // Content should still render
    expect(screen.getByText('Geo Content')).toBeTruthy()
  })

  it('shows tab bar when multiple tabs are visible', () => {
    // Both geo and registration permissions
    mockHasPermission.mockImplementation(
      (perm: string) => perm === 'metrics.geo' || perm === 'registration.manage'
    )
    render(
      <MemoryRouter initialEntries={['/manage/geo']}>
        <Routes>
          <Route element={<ManageLayout />}>
            <Route path="/manage/geo" element={<div>Geo Content</div>} />
            <Route path="/manage/registration" element={<div>Reg Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )
    // Should have tab links
    expect(screen.getByRole('link', { name: /Geo Data/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Registration/i })).toBeTruthy()
  })

  it('shows all six tabs for admin users regardless of permissions', () => {
    mockIsAdmin = true
    mockHasPermission.mockReturnValue(false) // no individual permissions
    render(
      <MemoryRouter initialEntries={['/manage/geo']}>
        <Routes>
          <Route element={<ManageLayout />}>
            <Route path="/manage/geo" element={<div>Geo Content</div>} />
            <Route path="/manage/registration" element={<div>Reg Content</div>} />
            <Route path="/manage/sheets" element={<div>Sheets Content</div>} />
            <Route path="/manage/lodging" element={<div>Lodging Content</div>} />
            <Route path="/manage/sync" element={<div>Sync Content</div>} />
            <Route path="/manage/config" element={<div>Config Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )
    // Admin sees all tabs even without individual permissions — including the
    // two admin-only ones, which is why kind: 'admin' resolves against isAdmin
    // directly rather than a permission codename.
    expect(screen.getByRole('link', { name: /Geo Data/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Registration/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Sheets/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Family Camp Lodging/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Sync Operations/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Configuration/i })).toBeTruthy()
  })

  it('shows exactly the tabs a non-admin has permission for, and no admin tabs', () => {
    mockHasPermission.mockImplementation(
      (perm: string) => perm === 'metrics.geo' || perm === 'sheets.export'
    )
    render(
      <MemoryRouter initialEntries={['/manage/geo']}>
        <Routes>
          <Route element={<ManageLayout />}>
            <Route path="/manage/geo" element={<div>Geo Content</div>} />
            <Route path="/manage/registration" element={<div>Reg Content</div>} />
            <Route path="/manage/sheets" element={<div>Sheets Content</div>} />
            <Route path="/manage/lodging" element={<div>Lodging Content</div>} />
            <Route path="/manage/sync" element={<div>Sync Content</div>} />
            <Route path="/manage/config" element={<div>Config Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: /Geo Data/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Sheets/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Registration/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Family Camp Lodging/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Sync Operations/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Configuration/i })).toBeNull()
  })

  it('renders its Outlet for a non-admin — no blanket guard', () => {
    // §2: AdminLayout's blanket `if (!isAdmin) return <PermissionDeniedPage />`
    // does NOT carry over here. It can't — this layout now hosts tabs with
    // mixed access requirements, so a blanket admin check would lock
    // non-admins out of Geo/Sheets/Registration/Lodging too (the exact
    // regression #450 fixed). Each tab route guards itself in App.tsx instead.
    // Do not "restore" a guard here — that would be the regression, not a fix.
    mockIsAdmin = false
    mockHasPermission.mockReturnValue(false)
    render(
      <MemoryRouter initialEntries={['/manage/geo']}>
        <Routes>
          <Route element={<ManageLayout />}>
            <Route path="/manage/geo" element={<div>Geo Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByText('Geo Content')).toBeInTheDocument()
    expect(screen.queryByText(/Access Restricted/i)).not.toBeInTheDocument()
  })
})

describe('ManageLayout tab bar', () => {
  beforeEach(() => {
    mockHasPermission.mockReset()
    mockIsAdmin = true
  })

  const renderAt = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<ManageLayout />}>
            <Route path="/manage/geo" element={<div>Geo Content</div>} />
            <Route path="/manage/sync" element={<div>Sync Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

  it('highlights the active tab based on route', () => {
    renderAt('/manage/geo')
    const geoLink = screen.getByRole('link', { name: /Geo Data/i })
    const syncLink = screen.getByRole('link', { name: /Sync Operations/i })
    expect(geoLink.className).toContain('shadow-sm')
    expect(syncLink.className).not.toContain('shadow-sm')
  })

  it('tab links point at the right paths', () => {
    renderAt('/manage/geo')
    expect(screen.getByRole('link', { name: /Geo Data/i })).toHaveAttribute('href', '/manage/geo')
    expect(screen.getByRole('link', { name: /Sync Operations/i })).toHaveAttribute(
      'href',
      '/manage/sync'
    )
  })
})
