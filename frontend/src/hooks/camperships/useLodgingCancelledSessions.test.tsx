import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const getFullList = vi.fn(() => Promise.resolve([{ session_cm_id: 1000209 }]))
vi.mock('../../lib/pocketbase', () => ({
  pb: {
    collection: (name: string) => (name === 'lodging_session_status' ? { getFullList } : null),
  },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ isLoading: false }) }))

import { queryKeys } from '../../utils/queryKeys'
import { useLodgingCancelledSessions } from './useLodgingCancelledSessions'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useLodgingCancelledSessions (spec §5.3, open item 7)', () => {
  it("reads the lodging board's cancelled weekends as a set of session ids", async () => {
    const { result } = renderHook(() => useLodgingCancelledSessions(2027), { wrapper })
    await waitFor(() => expect(result.current).toEqual(new Set([1000209])))
    expect(getFullList).toHaveBeenCalledWith({
      filter: 'year = 2027 && status = "cancelled"',
      fields: 'session_cm_id',
    })
  })

  it("sits under the weekend-sessions prefix so the lodging board's write refreshes it", () => {
    expect(queryKeys.weekendSessionsCancelled(2027).slice(0, 1)).toEqual(
      queryKeys.weekendSessionsPrefix()
    )
  })
})
