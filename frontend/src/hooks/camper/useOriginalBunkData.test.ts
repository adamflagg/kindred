/**
 * Tests for useOriginalBunkData hook (#1558).
 *
 * Guards the contract that the hook surfaces fetch failures as `error` rather
 * than swallowing them and returning null (which is indistinguishable from
 * "no parent input recorded").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createWrapper } from '../../test/testUtils'
import { useOriginalBunkData } from './useOriginalBunkData'

const mockGetList = vi.fn()
vi.mock('../../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn(() => ({
      getList: mockGetList,
    })),
  },
}))

describe('useOriginalBunkData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces fetch failure as `error` instead of swallowing it as null data (#1558)', async () => {
    mockGetList.mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useOriginalBunkData(1000001, 2026), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error)
    })
    expect(result.current.error?.message).toBe('network down')
    expect(result.current.originalBunkData).toBeNull()
  })

  it('returns null data without error when there are no records', async () => {
    mockGetList.mockResolvedValue({ items: [], totalItems: 0 })

    const { result } = renderHook(() => useOriginalBunkData(1000001, 2026), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.error).toBeNull()
    expect(result.current.originalBunkData).toBeNull()
  })
})
