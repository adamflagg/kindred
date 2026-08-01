/**
 * Tests for AdminLayout component
 * Route-based tab navigation for admin control center
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Navigate } from 'react-router'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// We'll import from the module once it exists — for now these tests define the spec
import { AdminLayout } from './AdminLayout'

// Mock useIsAdmin hook
const mockIsAdmin = vi.fn(() => true)
vi.mock('../hooks/useIsAdmin', () => ({
  useIsAdmin: () => mockIsAdmin(),
}))

// Mock usePermissions hook
const mockHasPermission = vi.fn(() => true)
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: mockHasPermission }),
}))

const TestChild = ({ text }: { text: string }) => <div data-testid="child">{text}</div>

const renderWithRouter = (initialPath: string, { isAdmin = true } = {}) => {
  mockIsAdmin.mockReturnValue(isAdmin)
  mockHasPermission.mockReturnValue(isAdmin)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/admin" element={<Navigate to="/admin/sync" replace />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="sync" element={<TestChild text="Sync Content" />} />
            <Route path="config" element={<Navigate to="/admin/config/solver" replace />} />
            <Route path="config/:category" element={<TestChild text="Config Content" />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('AdminLayout', () => {
  it('renders admin header', () => {
    renderWithRouter('/admin/sync')

    expect(screen.getByText('Admin Control Center')).toBeInTheDocument()
  })

  it('renders primary navigation tabs as links', () => {
    renderWithRouter('/admin/sync')

    expect(screen.getByRole('link', { name: /sync operations/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /configuration/i })).toBeInTheDocument()
  })

  it('highlights active tab based on route - sync', () => {
    renderWithRouter('/admin/sync')

    const syncLink = screen.getByRole('link', { name: /sync operations/i })
    const configLink = screen.getByRole('link', { name: /configuration/i })

    expect(syncLink.className).toContain('shadow-sm')
    expect(configLink.className).not.toContain('shadow-sm')
  })

  it('highlights active tab based on route - config', () => {
    renderWithRouter('/admin/config/solver')

    const syncLink = screen.getByRole('link', { name: /sync operations/i })
    const configLink = screen.getByRole('link', { name: /configuration/i })

    expect(configLink.className).toContain('shadow-sm')
    expect(syncLink.className).not.toContain('shadow-sm')
  })

  it('renders child content via Outlet on sync tab', () => {
    renderWithRouter('/admin/sync')

    expect(screen.getByTestId('child')).toHaveTextContent('Sync Content')
  })

  it('renders child content via Outlet on config tab', () => {
    renderWithRouter('/admin/config/solver')

    expect(screen.getByTestId('child')).toHaveTextContent('Config Content')
  })

  it('tab links point to correct paths', () => {
    renderWithRouter('/admin/sync')

    expect(screen.getByRole('link', { name: /sync operations/i })).toHaveAttribute(
      'href',
      '/admin/sync'
    )
    expect(screen.getByRole('link', { name: /configuration/i })).toHaveAttribute(
      'href',
      '/admin/config'
    )
  })

  describe('non-admin access', () => {
    // Filtering the tab list is not a guard: typing /admin/sync rendered the
    // page for anyone logged in (#1895). Every remaining admin tab is
    // admin-only, so the layout itself is the right place to stop.
    it('refuses the page rather than rendering it tabless', () => {
      renderWithRouter('/admin/sync', { isAdmin: false })

      expect(screen.getByText('Access Restricted')).toBeInTheDocument()
      expect(screen.queryByTestId('child')).not.toBeInTheDocument()
      expect(screen.queryByText('Admin Control Center')).not.toBeInTheDocument()
    })
  })
})
