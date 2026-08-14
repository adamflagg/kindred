/**
 * kindred#2237 — the shared Escape-handling hook every overlay adopter of
 * the kindred#2205 token stack should use, rather than each hand-rolling its
 * own acquire/listen/release effect.
 *
 * No blanket `afterEach(() => expect(hasOpenModal()).toBe(false))` guard
 * here, unlike `modalStack.test.ts` — that file manipulates tokens directly,
 * so its guard runs synchronously relative to every test. This file's
 * release happens on REACT unmount, which for a test that doesn't call
 * `unmount()` itself only happens via `@testing-library/react`'s automatic
 * `cleanup()` — a root-level `afterEach` registered in `src/test/setup.ts`.
 * Vitest runs a describe-scoped `afterEach` (this file) BEFORE an outer
 * root-level one (the setup file), so a blanket guard here would assert
 * before that automatic unmount has actually run. Each test below either
 * doesn't need a released token (still open) or unmounts explicitly first,
 * matching `ConfirmActionPopover.test.tsx`'s own pattern.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { useOverlayEscape } from './useOverlayEscape'
import { acquireOverlayToken, hasOpenModal, releaseOverlayToken } from '../components/ui/modalStack'

describe('useOverlayEscape', () => {
  it('calls onEscape when Escape is pressed while open', () => {
    const onEscape = vi.fn()
    const { unmount } = renderHook(() => useOverlayEscape(true, onEscape))

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onEscape).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('does nothing while closed', () => {
    const onEscape = vi.fn()
    const { unmount } = renderHook(() => useOverlayEscape(false, onEscape))

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onEscape).not.toHaveBeenCalled()
    unmount()
    expect(hasOpenModal()).toBe(false)
  })

  it('ignores a non-Escape key', () => {
    const onEscape = vi.fn()
    const { unmount } = renderHook(() => useOverlayEscape(true, onEscape))

    fireEvent.keyDown(document, { key: 'Enter' })

    expect(onEscape).not.toHaveBeenCalled()
    unmount()
  })

  it('does NOT act on Escape once a further overlay has opened on top of it', () => {
    // The exact scenario kindred#2237 is about: a second, independently
    // portalled overlay acquires a token after this one, so it — not this
    // hook's caller — owns the next Escape press.
    const onEscape = vi.fn()
    const { unmount } = renderHook(() => useOverlayEscape(true, onEscape))

    const topToken = acquireOverlayToken()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onEscape).not.toHaveBeenCalled()

    releaseOverlayToken(topToken)
    unmount()
  })

  it('acts again once the overlay on top of it releases its token', () => {
    const onEscape = vi.fn()
    const { unmount } = renderHook(() => useOverlayEscape(true, onEscape))

    const topToken = acquireOverlayToken()
    releaseOverlayToken(topToken)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onEscape).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('releases its overlay token on unmount, so the stack does not leak', () => {
    const { unmount } = renderHook(() => useOverlayEscape(true, vi.fn()))

    unmount()

    expect(hasOpenModal()).toBe(false)
  })

  it('releases its overlay token when isOpen flips back to false, not only on unmount', () => {
    const { result, rerender, unmount } = renderHook(
      ({ isOpen }: { isOpen: boolean }) => {
        const [calls, setCalls] = useState(0)
        useOverlayEscape(isOpen, () => setCalls((c) => c + 1))
        return calls
      },
      { initialProps: { isOpen: true } }
    )

    expect(hasOpenModal()).toBe(true)

    rerender({ isOpen: false })

    expect(hasOpenModal()).toBe(false)
    expect(result.current).toBe(0)
    unmount()
  })
})
