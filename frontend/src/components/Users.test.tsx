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

let mockCurrentUserId = 'user-1'
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: mockCurrentUserId },
    isLoading: false,
    isAuthenticated: true,
    logout: vi.fn(),
  }),
}))

const mockUsers = [
  {
    id: 'user-1',
    name: 'Emma Johnson',
    email: 'emma@example.com',
    is_admin: false,
    created: '2026-01-01',
  },
  {
    id: 'user-2',
    name: 'Liam Garcia',
    email: 'liam@example.com',
    is_admin: false,
    created: '2026-01-02',
  },
  {
    id: 'user-admin',
    name: 'Admin User',
    email: 'admin@example.com',
    is_admin: true,
    created: '2026-01-03',
  },
]

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: (name: string) => ({
      getList: vi.fn().mockResolvedValue({ items: name === 'users' ? mockUsers : [] }),
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
    mockCurrentUserId = 'user-1'
  })

  it('renders header for non-admin users', () => {
    renderUsers()
    expect(screen.getByText('System Access')).toBeTruthy()
  })

  it('does not show role management for users without users.manage', async () => {
    mockHasPermission.mockReturnValue(false)
    renderUsers()
    // Wait for users to load
    expect(await screen.findByText('Liam Garcia')).toBeTruthy()
    // No user rows should have cursor-pointer (no one is manageable without permission)
    const liamRow = screen.getByText('Liam Garcia').closest('[class*="flex items-center gap"]')
    expect(liamRow?.className).not.toContain('cursor-pointer')
  })

  it('shows cursor pointer for non-admin, non-self users when user has users.manage', async () => {
    mockHasPermission.mockImplementation((perm: string) => perm === 'users.manage')
    renderUsers()
    // Wait for users to load
    expect(await screen.findByText('Liam Garcia')).toBeTruthy()
    // Liam (not self, not admin) should have cursor-pointer parent
    const liamRow = screen.getByText('Liam Garcia').closest('[class*="cursor"]')
    expect(liamRow?.className).toContain('cursor-pointer')
  })

  it('blocks role management on own user row', async () => {
    mockHasPermission.mockImplementation((perm: string) => perm === 'users.manage')
    mockCurrentUserId = 'user-1'
    renderUsers()
    expect(await screen.findByText('Emma Johnson')).toBeTruthy()
    // Emma (self) should NOT have cursor-pointer
    const emmaRow = screen.getByText('Emma Johnson').closest('[class*="flex items-center gap"]')
    expect(emmaRow?.className).not.toContain('cursor-pointer')
  })

  it('blocks role management on admin users', async () => {
    mockHasPermission.mockImplementation((perm: string) => perm === 'users.manage')
    renderUsers()
    expect(await screen.findByText('Admin User')).toBeTruthy()
    // Admin user should NOT have cursor-pointer
    const adminRow = screen.getByText('Admin User').closest('[class*="flex items-center gap"]')
    expect(adminRow?.className).not.toContain('cursor-pointer')
  })
})
