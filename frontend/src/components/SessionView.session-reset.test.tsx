/**
 * Tests for the session-change lock/overflow reset behavior used by SessionView.
 *
 * SessionView itself is a heavy integration component with many providers that
 * are not practical to mock in a unit test, so the reset effect is extracted into
 * the real `useResetPartialResolveOnSessionChange` hook that SessionView calls.
 * These tests import and exercise that REAL hook — so they fail if the hook's body
 * or deps are wrong, or if the hook is deleted (SessionView's call would not compile).
 *
 * Behavioral cases:
 *   (a) unlockAll is called on session change
 *   (b) setAllowOverflow(false) is called on session change
 *   (c) both are called on a session switch
 *   (d) neither is called when the session value is unchanged
 */
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useResetPartialResolveOnSessionChange } from '../hooks/session'

describe('useResetPartialResolveOnSessionChange', () => {
  it('(a) calls unlockAll when selectedSession changes', () => {
    const unlockAll = vi.fn()
    const setAllowOverflow = vi.fn()
    const { rerender } = renderHook(
      ({ session }: { session: string }) =>
        useResetPartialResolveOnSessionChange(session, unlockAll, setAllowOverflow),
      { initialProps: { session: 'session-1' } }
    )

    // Mount fires the effect once; clear so we only observe the session-change.
    unlockAll.mockClear()
    setAllowOverflow.mockClear()

    rerender({ session: 'session-2' })

    expect(unlockAll).toHaveBeenCalledTimes(1)
  })

  it('(b) calls setAllowOverflow(false) when selectedSession changes', () => {
    const unlockAll = vi.fn()
    const setAllowOverflow = vi.fn()
    const { rerender } = renderHook(
      ({ session }: { session: string }) =>
        useResetPartialResolveOnSessionChange(session, unlockAll, setAllowOverflow),
      { initialProps: { session: 'session-1' } }
    )

    unlockAll.mockClear()
    setAllowOverflow.mockClear()

    rerender({ session: 'session-2' })

    expect(setAllowOverflow).toHaveBeenCalledTimes(1)
    expect(setAllowOverflow).toHaveBeenCalledWith(false)
  })

  it('(c) calls both unlockAll and setAllowOverflow(false) on a session switch', () => {
    const unlockAll = vi.fn()
    const setAllowOverflow = vi.fn()
    const { rerender } = renderHook(
      ({ session }: { session: string }) =>
        useResetPartialResolveOnSessionChange(session, unlockAll, setAllowOverflow),
      { initialProps: { session: 'session-1' } }
    )

    unlockAll.mockClear()
    setAllowOverflow.mockClear()

    rerender({ session: 'session-3' })

    expect(unlockAll).toHaveBeenCalledTimes(1)
    expect(setAllowOverflow).toHaveBeenCalledTimes(1)
    expect(setAllowOverflow).toHaveBeenCalledWith(false)
  })

  it('(d) does NOT call unlockAll or setAllowOverflow when selectedSession is unchanged', () => {
    const unlockAll = vi.fn()
    const setAllowOverflow = vi.fn()
    const { rerender } = renderHook(
      ({ session }: { session: string }) =>
        useResetPartialResolveOnSessionChange(session, unlockAll, setAllowOverflow),
      { initialProps: { session: 'session-1' } }
    )

    unlockAll.mockClear()
    setAllowOverflow.mockClear()

    // Re-render with the same session value — effect deps unchanged.
    rerender({ session: 'session-1' })

    expect(unlockAll).not.toHaveBeenCalled()
    expect(setAllowOverflow).not.toHaveBeenCalled()
  })
})
