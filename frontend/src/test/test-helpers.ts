import { QueryClient } from '@tanstack/react-query'
import { vi } from 'vitest'
import type { RecordModel } from 'pocketbase'

// Create a custom query client for tests
export const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
    },
  })

/** Creates a mock AuthContext value for testing auth-dependent components. */
export function createMockAuthContext(overrides: {
  user?: RecordModel | null
  isBypassMode?: boolean
}) {
  return {
    pb: {} as never,
    user: overrides.user ?? null,
    isLoading: false,
    isAuthenticated: overrides.user != null,
    isBypassMode: overrides.isBypassMode ?? false,
    login: vi.fn(),
    logout: vi.fn(),
    error: null,
    checkAuth: vi.fn(),
  }
}

/** Creates a mock PocketBase user record with RBAC fields. */
export function createMockUser(
  overrides: {
    is_admin?: boolean
    cached_permissions?: string[]
    last_login?: string
    name?: string
    email?: string
  } = {}
): RecordModel {
  return {
    id: 'user-1',
    collectionId: 'users',
    collectionName: 'users',
    created: '',
    updated: '',
    is_admin: overrides.is_admin ?? false,
    cached_permissions: overrides.cached_permissions ?? [],
    last_login: overrides.last_login ?? '',
    name: overrides.name ?? 'Emma Johnson',
    email: overrides.email ?? 'emma@example.com',
  }
}
