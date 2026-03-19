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
          permissions: ['bunking.manage'],
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
          permissions: ['metrics.financial'],
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
  it('renders roles with system badges and permission badges', async () => {
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
      // Role names
      expect(screen.getByText('Bunking Manager')).toBeTruthy()
      expect(screen.getByText('Metrics Viewer')).toBeTruthy()
      // System badges
      const systemBadges = screen.getAllByText('System')
      expect(systemBadges.length).toBeGreaterThan(0)
      // Permission badges
      expect(screen.getByText('bunking.manage')).toBeTruthy()
      expect(screen.getByText('metrics.financial')).toBeTruthy()
    })
  })
})
