/**
 * useAuditLog — the endpoints are admin-only, so every read must reach the
 * network carrying the PocketBase JWT. `useApiWithAuth` is deliberately NOT
 * mocked: the header assertion reads what reaches `fetch`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { useAuditLog, useAuditLogActors } from './useAuditLog'

vi.mock('../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ items: [], page: 1, per_page: 10, total: 0, actors: [] }), {
        status: 200,
      })
    )
  )
})

afterEach(() => {
  fetchSpy.mockRestore()
})

function authHeaderOf(call: unknown[] | undefined): string | null {
  const init = (call?.[1] ?? {}) as RequestInit
  return new Headers(init.headers).get('Authorization')
}

describe('useAuditLog', () => {
  it('reads the page and the person list with the PocketBase JWT', async () => {
    renderHook(
      () => {
        useAuditLog({ q: '', types: ['roles'], actor: '', signIns: true, page: 2, perPage: 15 })
        useAuditLogActors()
      },
      { wrapper }
    )
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))
    const urls = fetchSpy.mock.calls.map((call) => String(call[0])).sort()
    expect(urls).toEqual([
      '/api/admin/audit-log/actors',
      '/api/admin/audit-log?type=roles&sign_ins=true&page=2&per_page=15',
    ])
    for (const call of fetchSpy.mock.calls) {
      expect(authHeaderOf(call)).toBe('Bearer test-jwt')
    }
  })
})
