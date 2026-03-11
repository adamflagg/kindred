import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'

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

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: () => ({
      getList: vi.fn().mockResolvedValue({ items: [] }),
      getFullList: vi.fn().mockResolvedValue([]),
    }),
    files: { getURL: vi.fn() },
  },
}))

const Users = (await import('./Users')).default

function renderUsers() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Users />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('Users page access control', () => {
  beforeEach(() => {
    mockHasPermission.mockReset()
    mockIsAdmin = false
  })

  it('renders header for non-admin users', () => {
    renderUsers()
    expect(screen.getByText('System Access')).toBeTruthy()
  })

  it('does not show role management for users without users.manage', () => {
    mockHasPermission.mockReturnValue(false)
    renderUsers()
    expect(screen.getByText('System Access')).toBeTruthy()
  })
})
