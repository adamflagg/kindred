import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthContext } from '../../contexts/AuthContext'
import { UserRolesPanel } from './UserRolesPanel'
import type { RecordModel } from 'pocketbase'

// Mock PocketBase
const mockGetFullList = vi.fn()
const mockCreate = vi.fn()
const mockDelete = vi.fn()

vi.mock('../../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn((name: string) => {
      if (name === 'roles') {
        return { getFullList: mockGetFullList }
      }
      if (name === 'user_roles') {
        return {
          getFullList: mockGetFullList,
          create: mockCreate,
          delete: mockDelete,
        }
      }
      return { getFullList: mockGetFullList }
    }),
  },
}))

function createMockAuthContext(overrides: { user?: RecordModel | null; isBypassMode?: boolean }) {
  return {
    pb: {} as never,
    user: overrides.user ?? null,
    isLoading: false,
    isAuthenticated: true,
    isBypassMode: overrides.isBypassMode ?? false,
    login: vi.fn(),
    logout: vi.fn(),
    error: null,
    checkAuth: vi.fn(),
  }
}

const mockRoles = [
  {
    id: 'role-1',
    name: 'Bunking Manager',
    slug: 'bunking-manager',
    description: 'Can manage bunking',
    permissions: ['bunking.view', 'bunking.manage'],
    is_system: true,
    collectionId: 'roles',
    collectionName: 'roles',
    created: '',
    updated: '',
  },
  {
    id: 'role-2',
    name: 'Metrics Viewer',
    slug: 'metrics-viewer',
    description: 'Can view metrics',
    permissions: ['metrics.view'],
    is_system: true,
    collectionId: 'roles',
    collectionName: 'roles',
    created: '',
    updated: '',
  },
]

function renderWithProviders(
  ui: React.ReactNode,
  authOverrides: { user?: RecordModel | null; isBypassMode?: boolean } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const ctx = createMockAuthContext(authOverrides)
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(AuthContext.Provider, { value: ctx }, ui)
    )
  )
}

describe('UserRolesPanel', () => {
  const adminUser: RecordModel = {
    id: 'admin-1',
    collectionId: 'users',
    collectionName: 'users',
    created: '',
    updated: '',
    is_admin: true,
    cached_permissions: ['users.manage'],
  }

  const targetUser: RecordModel = {
    id: 'target-user-1',
    collectionId: 'users',
    collectionName: 'users',
    created: '',
    updated: '',
    name: 'Emma Johnson',
    email: 'emma@example.com',
    is_admin: false,
    cached_permissions: ['bunking.view'],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders user name and available roles', async () => {
    // First call returns roles, second returns user_roles (empty)
    mockGetFullList
      .mockResolvedValueOnce(mockRoles) // roles query
      .mockResolvedValueOnce([]) // user_roles query

    renderWithProviders(
      createElement(UserRolesPanel, {
        user: targetUser,
        onClose: vi.fn(),
      }),
      { user: adminUser }
    )

    await waitFor(() => {
      expect(screen.getByText('Emma Johnson')).toBeTruthy()
      expect(screen.getByText('Bunking Manager')).toBeTruthy()
      expect(screen.getByText('Metrics Viewer')).toBeTruthy()
    })
  })

  it('shows checkmarks for assigned roles', async () => {
    const userRoles = [
      {
        id: 'ur-1',
        user: 'target-user-1',
        role: 'role-1',
        collectionId: 'user_roles',
        collectionName: 'user_roles',
        created: '',
        updated: '',
      },
    ]

    mockGetFullList.mockResolvedValueOnce(mockRoles).mockResolvedValueOnce(userRoles)

    renderWithProviders(
      createElement(UserRolesPanel, {
        user: targetUser,
        onClose: vi.fn(),
      }),
      { user: adminUser }
    )

    await waitFor(() => {
      // The Bunking Manager checkbox should be checked
      const checkboxes = screen.getAllByRole('checkbox')
      const bunkingCheckbox = checkboxes.find((cb) => cb.getAttribute('data-role-id') === 'role-1')
      expect(bunkingCheckbox).toBeTruthy()
      expect((bunkingCheckbox as HTMLInputElement).checked).toBe(true)
    })
  })

  it('calls onClose when close button is clicked', async () => {
    mockGetFullList.mockResolvedValueOnce(mockRoles).mockResolvedValueOnce([])

    const onClose = vi.fn()

    renderWithProviders(
      createElement(UserRolesPanel, {
        user: targetUser,
        onClose,
      }),
      { user: adminUser }
    )

    await waitFor(() => {
      expect(screen.getByText('Emma Johnson')).toBeTruthy()
    })

    const closeButton = screen.getByTitle('Close panel')
    await userEvent.click(closeButton)
    expect(onClose).toHaveBeenCalled()
  })

  it('creates user_role record when toggling role on', async () => {
    mockGetFullList.mockResolvedValueOnce(mockRoles).mockResolvedValueOnce([])

    mockCreate.mockResolvedValueOnce({
      id: 'ur-new',
      user: 'target-user-1',
      role: 'role-1',
    })

    renderWithProviders(
      createElement(UserRolesPanel, {
        user: targetUser,
        onClose: vi.fn(),
      }),
      { user: adminUser }
    )

    await waitFor(() => {
      expect(screen.getByText('Bunking Manager')).toBeTruthy()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    const bunkingCheckbox = checkboxes.find((cb) => cb.getAttribute('data-role-id') === 'role-1')
    expect(bunkingCheckbox).toBeTruthy()
    await userEvent.click(bunkingCheckbox!)

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        user: 'target-user-1',
        role: 'role-1',
      })
    })
  })
})
