/**
 * Tests for the session-change lock reset behavior used by SessionView.
 *
 * SessionView itself is a heavy integration component with many providers that
 * are not practical to mock in a unit test, so the reset effect is extracted into
 * the real `useResetPartialResolveOnSessionChange` hook that SessionView calls.
 * These tests import and exercise that REAL hook — so they fail if the hook's
 * body or deps are wrong, or if the hook is deleted (SessionView's call would
 * not compile).
 *
 * Stream C: previously also reset allowOverflow. That state is gone (the smart
 * solver auto-uses overflow only when needed), so the hook now only resets the
 * lock set.
 *
 * Behavioral cases:
 *   (a) unlockAll is called on session change
 *   (b) unlockAll is NOT called when session is unchanged
 */
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useResetPartialResolveOnSessionChange } from '../hooks/session'

describe('useResetPartialResolveOnSessionChange', () => {
  it('(a) calls unlockAll when selectedSession changes', () => {
    const unlockAll = vi.fn()
    const { rerender } = renderHook(
      ({ session }: { session: string }) =>
        useResetPartialResolveOnSessionChange(session, unlockAll),
      { initialProps: { session: 'session-1' } }
    )

    // Mount fires the effect once; clear so we only observe the session change.
    unlockAll.mockClear()

    rerender({ session: 'session-2' })

    expect(unlockAll).toHaveBeenCalledTimes(1)
  })

  it('(b) does NOT call unlockAll when selectedSession is unchanged', () => {
    const unlockAll = vi.fn()
    const { rerender } = renderHook(
      ({ session }: { session: string }) =>
        useResetPartialResolveOnSessionChange(session, unlockAll),
      { initialProps: { session: 'session-1' } }
    )

    unlockAll.mockClear()

    rerender({ session: 'session-1' })

    expect(unlockAll).not.toHaveBeenCalled()
  })
})
