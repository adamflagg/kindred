import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('../../../lib/pocketbase', () => ({
  pb: {
    createBatch: () => ({
      collection: () => ({ create: vi.fn(), delete: vi.fn() }),
      send: () => Promise.resolve([]),
    }),
  },
}))

const { useSaveUserRoles } = await import('./useSaveUserRoles')

describe('useSaveUserRoles', () => {
  it('stays pending until the role links have refetched', async () => {
    const client = new QueryClient()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(client, 'invalidateQueries').mockReturnValue(gate)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useSaveUserRoles(), { wrapper })

    let settled = false
    let promise: Promise<unknown> = Promise.resolve()
    act(() => {
      promise = result.current.mutateAsync({ userId: 'u1', add: ['r1'], remove: [] }).then(() => {
        settled = true
      })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(client.invalidateQueries).toHaveBeenCalledTimes(2)
    expect(settled).toBe(false)

    await act(async () => {
      release()
      await promise
    })
    expect(settled).toBe(true)
  })
})
