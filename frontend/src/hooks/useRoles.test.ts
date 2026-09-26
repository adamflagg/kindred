import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '../test/test-helpers'

const getFullList = vi.fn()
vi.mock('../lib/pocketbase', () => ({
  pb: { collection: vi.fn(() => ({ getFullList })) },
}))

import { useRoles } from './useRoles'

function wrapper({ children }: { children: React.ReactNode }) {
  return createElement(QueryClientProvider, { client: createTestQueryClient() }, children)
}

describe('useRoles', () => {
  beforeEach(() => getFullList.mockReset())

  it('loads roles sorted by name', async () => {
    getFullList.mockResolvedValue([{ id: 'r1', name: 'Registrar', permissions: ['metrics.geo'] }])
    const { result } = renderHook(() => useRoles(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([
      { id: 'r1', name: 'Registrar', permissions: ['metrics.geo'] },
    ])
    expect(getFullList).toHaveBeenCalledWith({ sort: 'name', requestKey: null })
  })

  it('does not fetch when disabled', () => {
    renderHook(() => useRoles({ enabled: false }), { wrapper })
    expect(getFullList).not.toHaveBeenCalled()
  })
})
