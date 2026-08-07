import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const getFullList = vi.fn()
vi.mock('../lib/pocketbase', () => ({
  pb: { collection: () => ({ getFullList }) },
}))
vi.mock('./useCurrentYear', () => ({ useYear: () => 2026 }))

import { useLinkedAgSession } from './useLinkedAgSession'

let qc: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  getFullList.mockReset()
})

describe('useLinkedAgSession', () => {
  it('returns the AG child cm_id when one exists with bunk_plans', async () => {
    // 1st call: camp_sessions; 2nd call: bunk_plans for the ag session
    getFullList
      .mockResolvedValueOnce([
        { id: 'main1', cm_id: 1000001, session_type: 'main', parent_id: null },
        { id: 'ag1', cm_id: 2000001, session_type: 'ag', parent_id: 1000001 },
      ])
      .mockResolvedValueOnce([{ id: 'bp1', session: 'ag1' }])
    const { result } = renderHook(() => useLinkedAgSession(1000001), { wrapper })
    await waitFor(() => expect(result.current.agSessionCmId).toBe(2000001))
  })

  it('returns null when no AG child exists', async () => {
    getFullList.mockResolvedValueOnce([
      { id: 'main1', cm_id: 1000001, session_type: 'main', parent_id: null },
    ])
    const { result } = renderHook(() => useLinkedAgSession(1000001), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.agSessionCmId).toBeNull()
  })

  it('returns null when the AG child has no bunk_plans', async () => {
    getFullList
      .mockResolvedValueOnce([
        { id: 'main1', cm_id: 1000001, session_type: 'main', parent_id: null },
        { id: 'ag1', cm_id: 2000001, session_type: 'ag', parent_id: 1000001 },
      ])
      .mockResolvedValueOnce([]) // no bunk_plans
    const { result } = renderHook(() => useLinkedAgSession(1000001), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.agSessionCmId).toBeNull()
  })
})
