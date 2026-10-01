import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { makeProps } from './testFixtures'
import type { UsersPageProps } from './types'

const mockHasPermission = vi.fn()
let mockIsAdmin = false
let mockCurrentUserId = 'u-emma'

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: mockHasPermission,
    hasAnyPermission: (...perms: string[]) => perms.some(mockHasPermission),
    isAdmin: mockIsAdmin,
    permissions: [],
  }),
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: mockCurrentUserId },
    isLoading: false,
    isAuthenticated: true,
    logout: vi.fn(),
  }),
}))
vi.mock('../../../lib/pocketbase', () => ({ pb: { files: { getURL: vi.fn() } } }))
vi.mock('./UserDrawer', () => ({
  UserDrawer: ({ user }: { user: { id: string } }) => (
    <div data-testid="user-drawer">{user.id}</div>
  ),
}))

const { UsersTable } = await import('./UsersTable')

function renderTable(url: Partial<UsersPageProps['url']> = {}) {
  const props = makeProps(url)
  render(
    <MemoryRouter>
      <UsersTable {...props} />
    </MemoryRouter>
  )
  return props
}

beforeEach(() => {
  mockHasPermission.mockReset()
  mockIsAdmin = false
  mockCurrentUserId = 'u-emma'
})

describe('UsersTable', () => {
  it('shows Executive-split buckets whose counts sum to All', () => {
    renderTable()
    for (const [label, n] of [
      ['All', 20],
      ['Admin', 1],
      ['Executive', 1],
      ['Other roles', 1],
      ['No role', 17],
    ] as const) {
      expect(
        screen.getByRole('button', { name: new RegExp(`^${label}\\s*${n}$`) })
      ).toBeInTheDocument()
    }
  })

  it('pages at 15 with the pager in the toolbar', () => {
    renderTable()
    expect(screen.getByTestId('users-toolbar')).toHaveTextContent('1–15 of 20')
    expect(screen.getAllByTestId(/^user-row-/)).toHaveLength(15)
  })

  it('clamps the page when a search shrinks the list (Review Focus 1)', async () => {
    renderTable({ page: 2 })
    await userEvent.type(screen.getByPlaceholderText('Search name or email'), 'garcia')
    expect(screen.getAllByTestId(/^user-row-/)).toHaveLength(1)
    expect(screen.getByTestId('users-toolbar')).toHaveTextContent('1–1 of 1')
  })

  it('shows a specific role as a removable chip', async () => {
    const { url } = renderTable({ roleId: 'r-bunk' })
    expect(
      screen.getByText('Bunking Staff', { selector: '[data-testid="role-filter"] b' })
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear role filter' }))
    expect(url.setRole).toHaveBeenCalledWith(null)
  })

  it('says why a row cannot be managed, and ignores the click (U9, Review Focus 5)', async () => {
    mockHasPermission.mockReturnValue(true)
    renderTable()
    const adminRow = screen.getByTestId('user-row-u-admin')
    expect(adminRow).toHaveTextContent('Admin')
    await userEvent.click(adminRow)
    expect(screen.queryByTestId('user-drawer')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('user-row-u-liam'))
    expect(screen.getByTestId('user-drawer')).toHaveTextContent('u-liam')
  })

  it('hides Last active for people without users.manage (U8)', () => {
    mockHasPermission.mockReturnValue(false)
    renderTable()
    expect(screen.queryByText('Last active')).not.toBeInTheDocument()
  })

  it('opens the drawer with Enter when a manageable row name button is focused', async () => {
    mockHasPermission.mockImplementation((perm: string) => perm === 'users.manage')
    renderTable()
    const row = screen.getByTestId('user-row-u-liam')
    const btn = within(row).getByRole('button', { name: /Liam Garcia/ })
    btn.focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByTestId('user-drawer')).toHaveTextContent('u-liam')
  })

  it('renders a non-manageable row with no button at all', () => {
    mockHasPermission.mockReturnValue(false)
    renderTable()
    expect(screen.queryByRole('button', { name: /Liam Garcia/ })).not.toBeInTheDocument()
  })

  // Re-homed from Users.test.tsx (R11)
  it('shows Last active for an admin viewer', () => {
    mockIsAdmin = true
    renderTable()
    expect(screen.getByText('Last active')).toBeInTheDocument()
  })

  it('shows Last active for a non-admin users.manage holder', () => {
    mockHasPermission.mockImplementation((perm: string) => perm === 'users.manage')
    renderTable()
    expect(screen.getByText('Last active')).toBeInTheDocument()
  })

  it("does not make the current user's own row manageable", async () => {
    mockHasPermission.mockImplementation((perm: string) => perm === 'users.manage')
    renderTable()
    const own = screen.getByTestId('user-row-u-emma')
    expect(within(own).queryByRole('button', { name: /Emma Johnson/ })).not.toBeInTheDocument()
    await userEvent.click(own)
    expect(screen.queryByTestId('user-drawer')).not.toBeInTheDocument()
  })

  it('makes no row manageable without users.manage', async () => {
    mockHasPermission.mockReturnValue(false)
    renderTable()
    for (const row of screen.getAllByTestId(/^user-row-/)) {
      const id = row.getAttribute('data-testid')?.replace('user-row-', '')
      expect(within(row).queryByTestId(`manage-${String(id)}`)).not.toBeInTheDocument()
    }
    await userEvent.click(screen.getByTestId('user-row-u-liam'))
    expect(screen.queryByTestId('user-drawer')).not.toBeInTheDocument()
  })

  it('has a Joined column header', () => {
    renderTable()
    expect(screen.getByRole('columnheader', { name: 'Joined' })).toBeInTheDocument()
  })
})
