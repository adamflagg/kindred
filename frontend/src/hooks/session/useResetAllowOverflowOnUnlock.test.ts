import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useResetAllowOverflowOnUnlock } from './useResetAllowOverflowOnUnlock'

describe('useResetAllowOverflowOnUnlock', () => {
  it('does not reset on initial mount when lockedCount is 0 — user may have toggled overflow before locking anything', () => {
    const setAllowOverflow = vi.fn()
    renderHook(({ lockedCount }) => useResetAllowOverflowOnUnlock(lockedCount, setAllowOverflow), {
      initialProps: { lockedCount: 0 },
    })
    expect(setAllowOverflow).not.toHaveBeenCalled()
  })

  it('does not reset on initial mount when lockedCount is >0', () => {
    const setAllowOverflow = vi.fn()
    renderHook(({ lockedCount }) => useResetAllowOverflowOnUnlock(lockedCount, setAllowOverflow), {
      initialProps: { lockedCount: 3 },
    })
    expect(setAllowOverflow).not.toHaveBeenCalled()
  })

  it('does not reset when lockedCount transitions 0 -> N (locking starts)', () => {
    const setAllowOverflow = vi.fn()
    const { rerender } = renderHook(
      ({ lockedCount }) => useResetAllowOverflowOnUnlock(lockedCount, setAllowOverflow),
      { initialProps: { lockedCount: 0 } }
    )
    rerender({ lockedCount: 2 })
    expect(setAllowOverflow).not.toHaveBeenCalled()
  })

  it('does not reset when lockedCount changes between two >0 values', () => {
    const setAllowOverflow = vi.fn()
    const { rerender } = renderHook(
      ({ lockedCount }) => useResetAllowOverflowOnUnlock(lockedCount, setAllowOverflow),
      { initialProps: { lockedCount: 2 } }
    )
    rerender({ lockedCount: 5 })
    rerender({ lockedCount: 1 })
    expect(setAllowOverflow).not.toHaveBeenCalled()
  })

  it('resets to false when lockedCount transitions >0 -> 0 (last bunk unlocked)', () => {
    const setAllowOverflow = vi.fn()
    const { rerender } = renderHook(
      ({ lockedCount }) => useResetAllowOverflowOnUnlock(lockedCount, setAllowOverflow),
      { initialProps: { lockedCount: 3 } }
    )
    rerender({ lockedCount: 0 })
    expect(setAllowOverflow).toHaveBeenCalledTimes(1)
    expect(setAllowOverflow).toHaveBeenCalledWith(false)
  })

  it('does not re-trigger when lockedCount stays at 0 after a reset', () => {
    const setAllowOverflow = vi.fn()
    const { rerender } = renderHook(
      ({ lockedCount }) => useResetAllowOverflowOnUnlock(lockedCount, setAllowOverflow),
      { initialProps: { lockedCount: 1 } }
    )
    rerender({ lockedCount: 0 })
    expect(setAllowOverflow).toHaveBeenCalledTimes(1)
    rerender({ lockedCount: 0 })
    expect(setAllowOverflow).toHaveBeenCalledTimes(1)
  })
})
