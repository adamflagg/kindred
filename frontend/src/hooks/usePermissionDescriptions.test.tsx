import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const create = vi.fn().mockResolvedValue({})
const update = vi.fn().mockResolvedValue({})
const remove = vi.fn().mockResolvedValue(true)
const getFullList = vi
  .fn()
  .mockResolvedValue([
    { id: 'o1', codename: 'metrics.geo', description: 'Edited.', base_description: 'Old.' },
  ])
vi.mock('../lib/pocketbase', () => ({
  pb: { collection: () => ({ getFullList, create, update, delete: remove }) },
}))

const { usePermissionDescriptions, useSaveDescription } =
  await import('./usePermissionDescriptions')

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const spy = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { wrapper, spy }
}

describe('usePermissionDescriptions', () => {
  it('lists overrides', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => usePermissionDescriptions(), { wrapper })
    await waitFor(() => expect(result.current.data?.[0]?.codename).toBe('metrics.geo'))
  })

  it('creates, updates and deletes by write kind, then invalidates', async () => {
    const { wrapper, spy } = setup()
    const { result } = renderHook(() => useSaveDescription(), { wrapper })
    await act(() =>
      result.current.mutateAsync({
        kind: 'create',
        codename: 'metrics.geo',
        description: 'A.',
        base_description: 'B.',
      })
    )
    expect(create).toHaveBeenCalledWith({
      codename: 'metrics.geo',
      description: 'A.',
      base_description: 'B.',
    })
    await act(() =>
      result.current.mutateAsync({
        kind: 'update',
        id: 'o1',
        description: 'C.',
        base_description: 'B.',
      })
    )
    expect(update).toHaveBeenCalledWith('o1', { description: 'C.', base_description: 'B.' })
    await act(() => result.current.mutateAsync({ kind: 'delete', id: 'o1' }))
    expect(remove).toHaveBeenCalledWith('o1')
    expect(spy).toHaveBeenCalledWith({ queryKey: ['permission-descriptions'] })
  })
})
