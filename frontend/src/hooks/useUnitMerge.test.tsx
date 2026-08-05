/**
 * Merging a house into one card, or splitting it back into rooms.
 *
 * The behaviour worth pinning here is the GATING and the invalidation, and
 * neither is `useUnitAvailability`'s. A merge is a planning choice — it lives
 * only in a draft — so, unlike availability, the write is refused with no
 * scenario selected. And unlike placement, there is no optimistic layer:
 * nothing moves under the pointer, so the card is simply redrawn when the
 * roster returns.
 *
 * Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WeekendRoster } from '../types/lodging'
import { queryKeys } from '../utils/queryKeys'
import { useUnitMerge } from './useUnitMerge'

const setSlotMerge = vi.fn()

vi.mock('../services/lodgingApi', () => ({
  setSlotMerge: (...args: unknown[]) => setSlotMerge(...args),
}))

vi.mock('./useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn(), isAuthenticated: true, isAuthLoading: false }),
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('react-hot-toast', () => ({
  default: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}))

const YEAR = 2026
const SESSION = 1000001
const DRAFT = 'scn7x2k9qw3mnbv'

let client: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function rosterKey(scenario: string) {
  return queryKeys.weekendRoster(YEAR, SESSION, scenario)
}

function seededRoster(): WeekendRoster {
  return { year: YEAR, session_cm_id: SESSION, parties: [], units: [] }
}

beforeEach(() => {
  vi.clearAllMocks()
  setSlotMerge.mockResolvedValue({ record_id: 'r1', deleted: false })
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(rosterKey(''), seededRoster())
  client.setQueryData(rosterKey(DRAFT), seededRoster())
})

function renderMerge(sessionCmId = SESSION, scenario = DRAFT) {
  return renderHook(() => useUnitMerge({ year: YEAR, sessionCmId, scenario }), { wrapper })
}

describe('useUnitMerge', () => {
  it('sends the weekend, the scenario, the container and the combined flag', async () => {
    const { result } = renderMerge()

    await act(async () => {
      await result.current.setCombined('u_wing', 'The Wing', true)
    })

    expect(setSlotMerge).toHaveBeenCalledTimes(1)
    expect(setSlotMerge.mock.calls[0]?.[1]).toEqual({
      year: YEAR,
      session_cm_id: SESSION,
      scenario: DRAFT,
      unit_id: 'u_wing',
      combined: true,
    })
  })

  it('refuses to write on the CampMinder mirror rather than sending scenario ""', async () => {
    // The mirror inherits the registry default and is never overridable — the
    // same rule that makes placement read-only there. Refused BEFORE the
    // write, silently, matching the board's own `canPlace` gate: this is the
    // hook's belt to that braces, not a second UI-facing error path.
    const { result } = renderMerge(SESSION, '')

    await act(async () => {
      await result.current.setCombined('u_wing', 'The Wing', true)
    })

    expect(setSlotMerge).not.toHaveBeenCalled()
  })

  it('refuses to write without a weekend rather than sending session_cm_id 0', async () => {
    const { result } = renderMerge(0, DRAFT)

    await act(async () => {
      await result.current.setCombined('u_wing', 'The Wing', true)
    })

    expect(setSlotMerge).not.toHaveBeenCalled()
  })

  it('refreshes every scenario of the weekend, not just the one on screen', async () => {
    // The roster key carries a scenario (#1967) — invalidating only the
    // visible key leaves every other draft of the weekend drawing the
    // building at the old level.
    const { result } = renderMerge()

    await act(async () => {
      await result.current.setCombined('u_wing', 'The Wing', true)
    })

    await waitFor(() => {
      expect(client.getQueryState(rosterKey(DRAFT))?.isInvalidated).toBe(true)
      expect(client.getQueryState(rosterKey(''))?.isInvalidated).toBe(true)
    })
  })

  it('names only the unit being written, so one card waits and the rest do not', async () => {
    let release: (value: unknown) => void = () => undefined
    setSlotMerge.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )

    const { result } = renderMerge()
    act(() => {
      void result.current.setCombined('u_wing', 'The Wing', true)
    })

    await waitFor(() => {
      expect(result.current.pendingUnitId).toBe('u_wing')
    })

    await act(async () => {
      release({ record_id: 'r1', deleted: false })
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(result.current.pendingUnitId).toBe(null)
    })
  })

  it('says what a refused write was, rather than leaving the card looking saved', async () => {
    setSlotMerge.mockRejectedValue(new Error('Permission required: bunking.manage'))

    const { result } = renderMerge()
    await act(async () => {
      await result.current.setCombined('u_wing', 'The Wing', true).catch(() => undefined)
    })

    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('Permission required'))
  })

  it('names merge or split in the failure toast, matching what was attempted', async () => {
    setSlotMerge.mockRejectedValue(new Error('boom'))
    const { result } = renderMerge()

    await act(async () => {
      await result.current.setCombined('u_wing', 'The Wing', false).catch(() => undefined)
    })

    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('split'))
  })
})
