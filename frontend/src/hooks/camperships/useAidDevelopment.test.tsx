/**
 * Reports › Development's reads and the dated columns' write (spec §9.4; D65, D68). `useApiWithAuth`
 * is NOT mocked: the header assertion reads what reaches the network.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import {
  COLUMNS_SAVED,
  DEVELOPMENT,
} from '../../components/camperships/reports/developmentFixtures'
import {
  useAidDevelopment,
  useAidReportColumns,
  useAidSaveReportColumns,
  useFreshAidReportColumns,
} from './useAidDevelopment'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
let granted: string[] = []
vi.mock('../usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../useCurrentYear', () => ({ useYear: () => 2027 }))

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient()
  granted = ['financial_aid.summary']
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((url) =>
      Promise.resolve(
        new Response(
          JSON.stringify(String(url).includes('/columns') ? COLUMNS_SAVED : DEVELOPMENT),
          { status: 200 }
        )
      )
    )
})
afterEach(() => fetchSpy.mockRestore())

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useAidDevelopment', () => {
  it('reads the report with summary alone (D65), through fetchWithAuth', async () => {
    const { result } = renderHook(() => useAidDevelopment(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(DEVELOPMENT))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/reports/2027/development')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('reads nothing without view or summary', async () => {
    granted = ['financial_aid.grantors']
    renderHook(() => useAidDevelopment(), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('the dated columns', () => {
  it('reads the saved list, and reads it past the cache before a change', async () => {
    const { result } = renderHook(() => useAidReportColumns(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(COLUMNS_SAVED))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/reports/development/columns')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
    const fresh = renderHook(() => useFreshAidReportColumns(), { wrapper })
    await act(async () => {
      await fresh.result.current()
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('saves the whole list with PUT, and refreshes the report (the reports prefix)', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidSaveReportColumns(), { wrapper })
    const body = { columns: [{ season: 2027, as_of: '2027-03-09' }] }
    await act(() => result.current.mutateAsync(body))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/reports/development/columns')
    expect(options.method).toBe('PUT')
    expect(JSON.parse(options.body as string)).toEqual(body)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', 'reports'] })
  })
})
