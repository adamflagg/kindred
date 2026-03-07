import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthContext } from '../../contexts/AuthContext'
import { RolesTab } from './RolesTab'
import { createMockAuthContext } from '../../test/test-helpers'
import type { RecordModel } from 'pocketbase'

// Mock PocketBase
vi.mock('../../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn(() => ({
      getFullList: vi.fn().mockResolvedValue([
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
      ]),
    })),
  },
}))

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

describe('RolesTab', () => {
  it('renders roles list', async () => {
    const user: RecordModel = {
      id: 'u1',
      collectionId: 'users',
      collectionName: 'users',
      created: '',
      updated: '',
      is_admin: true,
      cached_permissions: ['users.manage'],
    }

    renderWithProviders(createElement(RolesTab), { user })

    await waitFor(() => {
      expect(screen.getByText('Bunking Manager')).toBeTruthy()
      expect(screen.getByText('Metrics Viewer')).toBeTruthy()
    })
  })

  it('shows system badge on system roles', async () => {
    const user: RecordModel = {
      id: 'u1',
      collectionId: 'users',
      collectionName: 'users',
      created: '',
      updated: '',
      is_admin: true,
      cached_permissions: [],
    }

    renderWithProviders(createElement(RolesTab), { user })

    await waitFor(() => {
      const systemBadges = screen.getAllByText('System')
      expect(systemBadges.length).toBeGreaterThan(0)
    })
  })

  it('shows permission badges on roles', async () => {
    const user: RecordModel = {
      id: 'u1',
      collectionId: 'users',
      collectionName: 'users',
      created: '',
      updated: '',
      is_admin: true,
      cached_permissions: [],
    }

    renderWithProviders(createElement(RolesTab), { user })

    await waitFor(() => {
      expect(screen.getByText('bunking.view')).toBeTruthy()
      expect(screen.getByText('bunking.manage')).toBeTruthy()
      expect(screen.getByText('metrics.view')).toBeTruthy()
    })
  })
})
