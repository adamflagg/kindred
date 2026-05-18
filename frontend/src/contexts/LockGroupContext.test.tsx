/**
 * LockGroupContext derived state tests.
 *
 * The provider derives `isActionBarVisible` from `pendingCampers.length > 0` so
 * both side panels can read it without re-deriving.
 */
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { Camper } from '../types/app-types'

// Mock everything LockGroupProvider transitively pulls in.
vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useQuery: () => ({ data: [], isLoading: false }),
    useQueryClient: () => ({ invalidateQueries: () => {} }),
  }
})
vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: () => ({ create: () => Promise.resolve({ id: 'x' }) }),
    authStore: { record: { email: 'test@example.com' } },
    filter: (s: string) => s,
  },
}))
vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2026 }))
vi.mock('../hooks/useScenario', () => ({
  useScenario: () => ({
    currentScenario: { id: 'scenario-1' },
    isProductionMode: false,
  }),
}))
vi.mock('../hooks/useGroupConflictConfirm', () => ({
  useGroupConflictConfirm: () => ({
    dialogState: { isOpen: false },
    checkConflict: () => Promise.resolve('confirmed'),
  }),
}))
vi.mock('react-hot-toast', () => ({
  toast: { success: () => {}, error: () => {} },
  default: { success: () => {}, error: () => {} },
}))

import { LockGroupProvider, useLockGroupContext } from './LockGroupContext'

const wrapper = ({ children }: { children: ReactNode }) => (
  <LockGroupProvider>{children}</LockGroupProvider>
)

const fakeCamper = (overrides: Partial<Camper> = {}): Camper =>
  ({
    id: 'pb-1',
    person_cm_id: 1000001,
    name: 'Emma Johnson',
    grade: 5,
    gender: 'F',
    assigned_bunk: '',
    assigned_bunk_cm_id: null,
    attendee_id: 'att-1',
    ...overrides,
  }) as unknown as Camper

describe('LockGroupContext.isActionBarVisible', () => {
  it('is false when no campers are pending', () => {
    const { result } = renderHook(() => useLockGroupContext(), { wrapper })
    expect(result.current.isActionBarVisible).toBe(false)
  })

  it('flips to true when a camper is added to pending', () => {
    const { result } = renderHook(() => useLockGroupContext(), { wrapper })
    act(() => {
      result.current.addPendingCamper(fakeCamper())
    })
    expect(result.current.isActionBarVisible).toBe(true)
  })

  it('returns to false when pending list is cleared', () => {
    const { result } = renderHook(() => useLockGroupContext(), { wrapper })
    act(() => {
      result.current.addPendingCamper(fakeCamper())
    })
    expect(result.current.isActionBarVisible).toBe(true)
    act(() => {
      result.current.clearPendingCampers()
    })
    expect(result.current.isActionBarVisible).toBe(false)
  })
})
