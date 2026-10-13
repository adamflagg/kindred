import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const getFullList = vi.fn(() =>
  Promise.resolve([
    {
      cm_id: 1000104,
      name: 'Starter Session',
      start_date: '2027-06-13 00:00:00.000Z',
      sort_order: 1,
      session_type: 'main',
      parent_id: 0,
    },
    {
      cm_id: 1000103,
      name: 'AG Session 2',
      start_date: '2027-06-20 00:00:00.000Z',
      end_date: '2027-07-04 00:00:00.000Z',
      sort_order: null,
      session_type: 'ag',
      parent_id: 1000101,
    },
  ])
)
vi.mock('../../lib/pocketbase', () => ({
  pb: { collection: (name: string) => (name === 'camp_sessions' ? { getFullList } : null) },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ isLoading: false }) }))

import { queryKeys } from '../../utils/queryKeys'
import { useAidSessionCatalog } from './useAidSessionCatalog'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useAidSessionCatalog (spec §5.3)', () => {
  it('reads the season with type, parent, date and order, sorted as the card lays it out', async () => {
    const { result } = renderHook(() => useAidSessionCatalog(2027), { wrapper })
    await waitFor(() => expect(result.current).toHaveLength(2))
    expect(getFullList).toHaveBeenCalledWith({
      filter: 'year = 2027',
      fields: 'cm_id,name,start_date,end_date,sort_order,session_type,parent_id',
      sort: 'start_date,sort_order,cm_id',
    })
    expect(result.current?.[1]).toEqual({
      cmId: 1000103,
      name: 'AG Session 2',
      startDate: '2027-06-20 00:00:00.000Z',
      endDate: '2027-07-04 00:00:00.000Z',
      sortOrder: 0,
      type: 'ag',
      parentId: 1000101,
    })
  })

  it('asks nothing until there is a season', () => {
    getFullList.mockClear()
    renderHook(() => useAidSessionCatalog(0), { wrapper })
    expect(getFullList).not.toHaveBeenCalled()
  })
})

describe('useAidSessionCatalog: a direct PocketBase read under a shared prefix, so it names aidRetry itself', () => {
  // A client that would retry three times at once: only the hook's own rule stops it.
  const retrying = () =>
    new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } })
  const answered = (status: number) => Object.assign(new Error('x'), { status })

  it('reads a server fault once', async () => {
    const client = retrying()
    getFullList.mockClear()
    getFullList.mockImplementation(() => Promise.reject(answered(500)))
    renderHook(() => useAidSessionCatalog(2031), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    await waitFor(() =>
      expect(client.getQueryState(queryKeys.campSessionCatalog(2031))?.status).toBe('error')
    )
    expect(getFullList).toHaveBeenCalledTimes(1)
  })

  it("retries a dropped connection (PocketBase's status 0) once", async () => {
    const client = retrying()
    getFullList.mockClear()
    getFullList.mockImplementation(() => Promise.reject(answered(0)))
    renderHook(() => useAidSessionCatalog(2031), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    await waitFor(() =>
      expect(client.getQueryState(queryKeys.campSessionCatalog(2031))?.status).toBe('error')
    )
    expect(getFullList).toHaveBeenCalledTimes(2)
  })
})
