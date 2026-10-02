import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePermissionRegistry } from './usePermissionRegistry'

vi.mock('../lib/pocketbase', () => ({ pb: { authStore: { token: 'test-jwt', clear: vi.fn() } } }))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))

const REGISTRY = { permissions: [], areas: ['Analytics'], admin_only: ['Manage › Sync'], total: 0 }

describe('usePermissionRegistry', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reads /api/permissions with the PocketBase JWT', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(REGISTRY), { status: 200 }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => usePermissionRegistry(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(REGISTRY))
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('/api/permissions')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-jwt')
  })
})
