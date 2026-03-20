import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import toast from 'react-hot-toast'

vi.mock('../lib/pocketbase', () => ({
  pb: { send: vi.fn() },
}))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}))

import { pb } from '../lib/pocketbase'
import { createSyncMutation } from './createSyncMutation'
import { queryKeys } from '../utils/queryKeys'

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

describe('createSyncMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls pb.send with configured endpoint and method', async () => {
    ;(pb.send as Mock).mockResolvedValue({ status: 'started' })
    const useHook = createSyncMutation<number>({
      endpoint: (year) => `/api/custom/sync/test?year=${year}`,
      method: 'POST',
      displayName: 'Test Sync',
    })
    const { result } = renderHook(() => useHook(), { wrapper: createWrapper() })
    await act(async () => {
      result.current.mutate(2025)
    })
    expect(pb.send).toHaveBeenCalledWith('/api/custom/sync/test?year=2025', { method: 'POST' })
  })

  it('shows success toast with displayName', async () => {
    ;(pb.send as Mock).mockResolvedValue({ status: 'started' })
    const useHook = createSyncMutation<undefined>({
      endpoint: '/api/custom/sync/test',
      displayName: 'Test Sync',
    })
    const { result } = renderHook(() => useHook(), { wrapper: createWrapper() })
    await act(async () => {
      result.current.mutate(undefined)
    })
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Test Sync'), expect.any(Object))
  })

  it('extracts PocketBase error messages', async () => {
    const pbError = Object.assign(new Error('fail'), {
      response: { data: { error: 'Rate limit exceeded' } },
    })
    ;(pb.send as Mock).mockRejectedValue(pbError)
    const useHook = createSyncMutation<undefined>({
      endpoint: '/api/custom/sync/test',
      displayName: 'Test Sync',
    })
    const { result } = renderHook(() => useHook(), { wrapper: createWrapper() })
    await act(async () => {
      result.current.mutate(undefined)
    })
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('Rate limit exceeded'),
      expect.any(Object)
    )
  })

  it('invalidates syncStatus on success', async () => {
    ;(pb.send as Mock).mockResolvedValue({})
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const useHook = createSyncMutation<undefined>({
      endpoint: '/api/custom/sync/test',
      displayName: 'Test',
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useHook(), { wrapper })
    await act(async () => {
      result.current.mutate(undefined)
    })
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.syncStatus() })
  })

  it('supports DELETE method', async () => {
    ;(pb.send as Mock).mockResolvedValue({})
    const useHook = createSyncMutation<undefined>({
      endpoint: '/api/custom/sync/running',
      method: 'DELETE',
      displayName: 'Cancel',
    })
    const { result } = renderHook(() => useHook(), { wrapper: createWrapper() })
    await act(async () => {
      result.current.mutate(undefined)
    })
    expect(pb.send).toHaveBeenCalledWith('/api/custom/sync/running', { method: 'DELETE' })
  })

  it('handles "already in progress" errors', async () => {
    ;(pb.send as Mock).mockRejectedValue(new Error('Sync already in progress'))
    const useHook = createSyncMutation<undefined>({
      endpoint: '/api/custom/sync/test',
      displayName: 'Test Sync',
      alreadyRunningMessage: 'Test Sync is already running.',
    })
    const { result } = renderHook(() => useHook(), { wrapper: createWrapper() })
    await act(async () => {
      result.current.mutate(undefined)
    })
    expect(toast.error).toHaveBeenCalledWith('Test Sync is already running.', expect.any(Object))
  })
})
