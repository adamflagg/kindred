/**
 * useDeployedVersions — each Kindred component reports the version its image
 * was built at, because CD rebuilds only the images whose files changed. The
 * hook combines the api's and PocketBase's answers with the frontend's own
 * baked version and names the newest. `useApiWithAuth` is not mocked: the
 * assertions read what reaches `fetch`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { pb } from '../lib/pocketbase'
import { useDeployedVersions } from './useDeployedVersions'

vi.mock('../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() }, send: vi.fn() },
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))

const FRONTEND = 'v6.4.0-240-gaaaaaaa'
const API = 'v6.4.0-248-gc35904c'
const POCKETBASE = 'v6.4.0-245-gbbbbbbb'

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function answer(api: string | Error, pocketbase: string | Error) {
  fetchSpy.mockImplementation(() =>
    Promise.resolve(
      api instanceof Error
        ? new Response('{"detail":"Internal server error"}', { status: 500 })
        : new Response(JSON.stringify({ api }), { status: 200 })
    )
  )
  vi.mocked(pb.send).mockImplementation(() =>
    pocketbase instanceof Error ? Promise.reject(pocketbase) : Promise.resolve({ pocketbase })
  )
}

beforeEach(() => {
  vi.stubEnv('VITE_APP_VERSION', FRONTEND)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  fetchSpy = vi.spyOn(globalThis, 'fetch')
  vi.mocked(pb.send).mockReset()
})

afterEach(() => {
  fetchSpy.mockRestore()
  vi.unstubAllEnvs()
})

describe('useDeployedVersions', () => {
  it('combines the frontend, api and PocketBase versions and names the newest', async () => {
    answer(API, POCKETBASE)
    const { result } = renderHook(() => useDeployedVersions(), { wrapper })
    await waitFor(() => expect(result.current.api).toBe(API))
    await waitFor(() => expect(result.current.pocketbase).toBe(POCKETBASE))
    expect(result.current.frontend).toBe(FRONTEND)
    expect(result.current.newest).toBe(API)
  })

  it('asks each server with the signed-in user’s credentials', async () => {
    answer(API, POCKETBASE)
    renderHook(() => useDeployedVersions(), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe('/api/version')
    const init = fetchSpy.mock.calls[0]?.[1] ?? {}
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-jwt')
    await waitFor(() => expect(pb.send).toHaveBeenCalledTimes(1))
    expect(vi.mocked(pb.send).mock.calls[0]?.[0]).toBe('/api/custom/version')
  })

  it('shows the frontend version while the servers have not answered', () => {
    fetchSpy.mockImplementation(() => new Promise<Response>(() => {}))
    vi.mocked(pb.send).mockImplementation(() => new Promise(() => {}))
    const { result } = renderHook(() => useDeployedVersions(), { wrapper })
    expect(result.current.newest).toBe(FRONTEND)
    expect(result.current.api).toBeUndefined()
    expect(result.current.pocketbase).toBeUndefined()
  })

  it('falls back to the frontend version when both servers fail', async () => {
    answer(new Error('down'), new Error('down'))
    const { result } = renderHook(() => useDeployedVersions(), { wrapper })
    await waitFor(() => expect(client.isFetching()).toBe(0))
    await waitFor(() => expect(pb.send).toHaveBeenCalled())
    expect(result.current.api).toBeUndefined()
    expect(result.current.pocketbase).toBeUndefined()
    expect(result.current.newest).toBe(FRONTEND)
  })

  it('still uses the server that answered when the other fails', async () => {
    answer(new Error('down'), POCKETBASE)
    const { result } = renderHook(() => useDeployedVersions(), { wrapper })
    await waitFor(() => expect(result.current.pocketbase).toBe(POCKETBASE))
    expect(result.current.api).toBeUndefined()
    expect(result.current.newest).toBe(POCKETBASE)
  })

  it('asks once per session: a second consumer and a remount reuse the answer', async () => {
    answer(API, POCKETBASE)
    const first = renderHook(() => useDeployedVersions(), { wrapper })
    await waitFor(() => expect(first.result.current.api).toBe(API))
    first.unmount()
    const second = renderHook(() => [useDeployedVersions(), useDeployedVersions()], { wrapper })
    expect(second.result.current[0]?.api).toBe(API)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(pb.send).toHaveBeenCalledTimes(1)
  })

  it('ignores an answer that is not a version string', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ api: 42 }), { status: 200 }))
    )
    vi.mocked(pb.send).mockResolvedValue({})
    const { result } = renderHook(() => useDeployedVersions(), { wrapper })
    await waitFor(() => expect(client.isFetching()).toBe(0))
    await waitFor(() => expect(pb.send).toHaveBeenCalled())
    expect(result.current.api).toBeUndefined()
    expect(result.current.pocketbase).toBeUndefined()
    expect(result.current.newest).toBe(FRONTEND)
  })
})
