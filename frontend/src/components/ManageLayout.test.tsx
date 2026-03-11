import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'

// Mock hooks
const mockHasPermission = vi.fn()
let mockIsAdmin = false

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: mockHasPermission,
    hasAnyPermission: (...perms: string[]) => perms.some(mockHasPermission),
    isAdmin: mockIsAdmin,
    permissions: [],
  }),
}))

vi.mock('../hooks/useIsAdmin', () => ({
  useIsAdmin: () => mockIsAdmin,
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

  it('shows all tabs for admin users regardless of permissions', () => {
    mockIsAdmin = true
    mockHasPermission.mockReturnValue(false) // no individual permissions
    render(
      <MemoryRouter initialEntries={['/manage/geo']}>
        <Routes>
          <Route element={<ManageLayout />}>
            <Route path="/manage/geo" element={<div>Geo Content</div>} />
            <Route path="/manage/registration" element={<div>Reg Content</div>} />
            <Route path="/manage/sheets" element={<div>Sheets Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )
    // Admin sees all tabs even without individual permissions
    expect(screen.getByRole('link', { name: /Geo Data/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Registration/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Sheets/i })).toBeTruthy()
  })
})
