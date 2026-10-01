import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    last_login: '2026-03-17 10:30:00.000Z',
  },
  {
    id: 'user-2',
    name: 'Liam Garcia',
    email: 'liam@example.com',
    is_admin: false,
    created: '2026-01-02',
    last_login: '2026-03-16 08:00:00.000Z',
  },
  {
    id: 'user-admin',
    name: 'Admin User',
    email: 'admin@example.com',
    is_admin: true,
    created: '2026-01-03',
    last_login: '2026-03-17 12:00:00.000Z',
  },
  {
    id: 'va0123456789abc',
    name: 'View as: No role',
    email: 'va0123456789abc@view-as.invalid',
    is_admin: false,
    created: '2026-01-04',
    last_login: '',
  },
]

vi.mock('../hooks/usePermissionRegistry', () => ({
  usePermissionRegistry: () => ({
    data: { permissions: [], areas: [], admin_only: [], total: 11 },
    isLoading: false,
    error: null,
  }),
}))

vi.mock('../hooks/usePermissionDescriptions', () => ({
  usePermissionDescriptions: () => ({ data: [] }),
  useSaveDescription: () => ({ mutate: vi.fn(), isPending: false }),
}))

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

function renderUsers(url = '/users') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Users />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('Users page shell', () => {
  beforeEach(() => {
    mockHasPermission.mockReset()
    mockHasPermission.mockReturnValue(false)
    mockIsAdmin = false
  })

  it('shows the band with three tabs and their counts', async () => {
    renderUsers()
    expect(screen.getByRole('heading', { name: 'System Access' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Users\s*3/ })).toBeInTheDocument() // stand-in excluded
    expect(screen.getByRole('button', { name: /Roles/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Permissions\s*11/ })).toBeInTheDocument()
  })

  it('opens the tab named in the URL', async () => {
    renderUsers('/users?tab=permissions')
    expect(await screen.findByTestId('permissions-tab')).toBeInTheDocument()
  })

  it('switching tab writes the URL', async () => {
    const user = userEvent.setup()
    renderUsers()
    await user.click(await screen.findByRole('button', { name: /Roles/ }))
    expect(await screen.findByTestId('roles-matrix')).toBeInTheDocument()
  })

  it('never counts view-as persona stand-ins', async () => {
    renderUsers()
    // 4 mock rows, one is a stand-in: the Users tab count is 3 (and the stub table mounts).
    expect(await screen.findByRole('button', { name: /Users\s*3/ })).toBeInTheDocument()
    expect(await screen.findByTestId('users-table')).toBeInTheDocument()
  })
})

// Migrated in Task 9/10: these assert on the old row/drawer markup, which the
// new UsersTable (Task 9) and UserDrawer (Task 10) replace. Parked, not deleted.
describe.skip('Users page access control (migrated in Task 9/10)', () => {
  beforeEach(() => {
    mockHasPermission.mockReset()
    mockIsAdmin = false
    mockCurrentUserId = 'user-1'
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

  it.each([
    { description: 'own user row', name: 'Emma Johnson', userId: 'user-1' },
    { description: 'admin users', name: 'Admin User', userId: 'user-1' },
  ])('blocks role management on $description', async ({ name, userId }) => {
    mockCurrentUserId = userId
    mockHasPermission.mockImplementation((perm: string) => perm === 'users.manage')
    renderUsers()
    expect(await screen.findByText(name)).toBeTruthy()
    const row = screen.getByText(name).closest('[class*="flex items-center gap"]')
    expect(row?.className).not.toContain('cursor-pointer')
  })

  it('never lists view-as persona stand-ins', async () => {
    renderUsers()
    expect(await screen.findByText('Emma Johnson')).toBeTruthy()
    expect(screen.queryByText('View as: No role')).toBeNull()
  })
})

// jsx-a11y sweep (board-graph-users chunk): the row's click handler had no
// keyboard equivalent. A manageable row is now a real <button> (native
// Enter/Space activation); a non-manageable row gets no button at all — same
// "no button at all, not just an inert row" rule GeoDetailList follows
// (kindred#2063).
describe.skip('Users page row keyboard reachability (migrated in Task 9/10)', () => {
  beforeEach(() => {
    mockHasPermission.mockReset()
    mockIsAdmin = false
    mockCurrentUserId = 'user-1'
  })

  it('opens the roles panel with Enter when a manageable row is focused', async () => {
    mockHasPermission.mockImplementation((perm: string) => perm === 'users.manage')
    renderUsers()
    expect(await screen.findByText('Liam Garcia')).toBeTruthy()

    const row = screen.getByRole('button', { name: /Liam Garcia/ })
    row.focus()
    await userEvent.keyboard('{Enter}')

    expect(await screen.findByRole('heading', { name: 'Liam Garcia' })).toBeInTheDocument()
  })

  it('renders a non-manageable row with no button at all', async () => {
    mockHasPermission.mockReturnValue(false)
    renderUsers()
    expect(await screen.findByText('Liam Garcia')).toBeTruthy()

    expect(screen.queryByRole('button', { name: /Liam Garcia/ })).not.toBeInTheDocument()
  })
})

describe.skip('Users page date column labels (migrated in Task 9/10)', () => {
  beforeEach(() => {
    mockHasPermission.mockReset()
    mockIsAdmin = false
    mockCurrentUserId = 'user-1'
  })

  it('renders Joined label next to join date', async () => {
    mockHasPermission.mockReturnValue(false)
    renderUsers()
    expect(await screen.findByText('Liam Garcia')).toBeTruthy()
    expect(screen.getAllByText('Joined').length).toBeGreaterThan(0)
  })

  it('renders Last login label for admin users', async () => {
    mockIsAdmin = true
    renderUsers()
    expect(await screen.findByText('Liam Garcia')).toBeTruthy()
    expect(screen.getAllByText('Last login').length).toBeGreaterThan(0)
  })

  it('does not render Last login label when canSeeLastLogin is false', async () => {
    mockHasPermission.mockReturnValue(false)
    renderUsers()
    expect(await screen.findByText('Liam Garcia')).toBeTruthy()
    expect(screen.queryByText('Last login')).not.toBeInTheDocument()
    expect(screen.getAllByText('Joined').length).toBeGreaterThan(0)
  })
})

describe.skip('Users page last login visibility (migrated in Task 9/10)', () => {
  beforeEach(() => {
    mockHasPermission.mockReset()
    mockIsAdmin = false
    mockCurrentUserId = 'user-1'
  })

  it('shows last login column when user is admin', async () => {
    mockIsAdmin = true
    renderUsers()
    expect(await screen.findByText('Liam Garcia')).toBeTruthy()
    expect(screen.getByTestId('last-login-user-2')).toBeTruthy()
  })

  it('shows last login column when user has users.manage permission', async () => {
    mockHasPermission.mockImplementation((perm: string) => perm === 'users.manage')
    renderUsers()
    expect(await screen.findByText('Liam Garcia')).toBeTruthy()
    expect(screen.getByTestId('last-login-user-2')).toBeTruthy()
  })

  it('hides last login column for regular users', async () => {
    mockHasPermission.mockReturnValue(false)
    renderUsers()
    expect(await screen.findByText('Liam Garcia')).toBeTruthy()
    expect(screen.queryByTestId('last-login-user-2')).toBeNull()
  })
})
