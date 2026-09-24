/**
 * useSessionCamperPersons carries each person's session start (owner ruling
 * 2026-09-24): the request-target picker shows a prior year's age at the
 * session's start, and this hook is the only place the picker learns it.
 *
 * Fictional data throughout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { createWrapper } from '../test/testUtils'
import { useSessionCamperPersons } from './useSessionCamperPersons'

const mockGetFullList = vi.fn()

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: () => ({ getFullList: mockGetFullList }),
  },
}))

beforeEach(() => {
  mockGetFullList.mockReset()
})

describe('useSessionCamperPersons', () => {
  it("returns each person with the session's start date", async () => {
    mockGetFullList.mockResolvedValue([
      {
        id: 'a1',
        expand: {
          person: { id: 'p1', cm_id: 1000001, first_name: 'Olivia', last_name: 'Chen' },
          session: { id: 's1', cm_id: 201, start_date: '2025-07-06 07:00:00.000Z' },
        },
      },
    ])

    const { result } = renderHook(() => useSessionCamperPersons(201, 2025), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const call = mockGetFullList.mock.calls[0]?.[0] as { expand?: string } | undefined
    expect(call?.expand?.split(',')).toEqual(expect.arrayContaining(['person', 'session']))
    expect(result.current.data).toEqual([
      expect.objectContaining({
        cm_id: 1000001,
        first_name: 'Olivia',
        session_start_date: '2025-07-06 07:00:00.000Z',
      }),
    ])
  })

  it('drops an attendee with no person', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'a1', expand: {} }])
    const { result } = renderHook(() => useSessionCamperPersons(201, 2025), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([])
  })
})
