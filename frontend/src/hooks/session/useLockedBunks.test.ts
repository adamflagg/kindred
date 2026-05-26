import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useLockedBunks } from './useLockedBunks'

describe('useLockedBunks', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useLockedBunks())
    expect(result.current.lockedCount).toBe(0)
    expect(result.current.isLocked(2001)).toBe(false)
  })

  it('toggleBunkLock adds then removes a bunk cm id', () => {
    const { result } = renderHook(() => useLockedBunks())
    act(() => result.current.toggleBunkLock(2001))
    expect(result.current.isLocked(2001)).toBe(true)
    expect(result.current.lockedCount).toBe(1)
    act(() => result.current.toggleBunkLock(2001))
    expect(result.current.isLocked(2001)).toBe(false)
    expect(result.current.lockedCount).toBe(0)
  })

  it('lockAll locks all the given cm ids (union with existing)', () => {
    const { result } = renderHook(() => useLockedBunks())
    act(() => result.current.toggleBunkLock(2001))
    act(() => result.current.lockAll([2002, 2003]))
    expect(result.current.lockedCount).toBe(3)
    expect(result.current.isLocked(2001)).toBe(true)
    expect(result.current.isLocked(2002)).toBe(true)
    expect(result.current.isLocked(2003)).toBe(true)
  })

  it('unlockAll clears everything', () => {
    const { result } = renderHook(() => useLockedBunks())
    act(() => result.current.lockAll([2001, 2002]))
    act(() => result.current.unlockAll())
    expect(result.current.lockedCount).toBe(0)
    expect(result.current.isLocked(2001)).toBe(false)
  })

  it('lockedBunkCmIds is a new Set instance on each change (immutability)', () => {
    const { result } = renderHook(() => useLockedBunks())
    const before = result.current.lockedBunkCmIds
    act(() => result.current.toggleBunkLock(2001))
    expect(result.current.lockedBunkCmIds).not.toBe(before)
  })
})
