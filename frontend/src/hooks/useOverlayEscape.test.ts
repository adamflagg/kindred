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

  it('still acts when an UNCONVERTED overlay stops propagation in the capture phase', () => {
    // Twelve of kindred#2237's overlays are not token-gated yet, and one of
    // them — `CamperDetailsPanel` — installs a capture-phase `document`
    // listener that calls `stopPropagation()` unconditionally. A capture-phase
    // stop at `document` halts the event before it ever reaches the bubble
    // phase, so a bubble-phase listener on `document` never runs at all. An
    // overlay stacked ABOVE such a listener must therefore not depend on the
    // bubble phase to receive Escape, or the gate silently costs it the key
    // it is supposed to own.
    const onEscape = vi.fn()
    const legacyCapture = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.stopPropagation()
    }
    // Registered BEFORE the hook, mirroring reality: the outer panel opens
    // first, then the picker inside it.
    document.addEventListener('keydown', legacyCapture, true)
    const { unmount } = renderHook(() => useOverlayEscape(true, onEscape))

    // Dispatch from a descendant, not from `document` itself — an event whose
    // target IS `document` runs every listener in the at-target phase and so
    // cannot tell capture from bubble.
    const target = document.createElement('div')
    document.body.appendChild(target)
    fireEvent.keyDown(target, { key: 'Escape' })

    document.removeEventListener('keydown', legacyCapture, true)
    target.remove()
    unmount()

    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('swallows the key while topmost, so an unconverted listener below does not also fire', () => {
    const onEscape = vi.fn()
    const below = vi.fn()
    document.addEventListener('keydown', below)
    const { unmount } = renderHook(() => useOverlayEscape(true, onEscape))

    const target = document.createElement('div')
    document.body.appendChild(target)
    fireEvent.keyDown(target, { key: 'Escape' })

    document.removeEventListener('keydown', below)
    target.remove()
    unmount()

    expect(onEscape).toHaveBeenCalledTimes(1)
    expect(below).not.toHaveBeenCalled()
  })

  it('lets the key through untouched while NOT topmost', () => {
    const onEscape = vi.fn()
    const other = vi.fn()
    document.addEventListener('keydown', other)
    const { unmount } = renderHook(() => useOverlayEscape(true, onEscape))
    const topToken = acquireOverlayToken()

    const target = document.createElement('div')
    document.body.appendChild(target)
    fireEvent.keyDown(target, { key: 'Escape' })

    document.removeEventListener('keydown', other)
    target.remove()
    releaseOverlayToken(topToken)
    unmount()

    expect(onEscape).not.toHaveBeenCalled()
    expect(other).toHaveBeenCalledTimes(1)
  })

  it('does not re-acquire (and so jump back to the top) when the caller re-renders', () => {
    // A caller that passes an inline arrow gets a new `onEscape` identity on
    // every render. If the token is tied to that identity, an ordinary
    // re-render of a BACKGROUND overlay — a query refetch, a parent state
    // change — silently republishes it as the topmost overlay and steals
    // Escape from whatever genuinely is on top.
    const onEscape = vi.fn()
    const { rerender, unmount } = renderHook(
      ({ cb }: { cb: () => void }) => useOverlayEscape(true, () => cb()),
      { initialProps: { cb: onEscape } }
    )

    const topToken = acquireOverlayToken()
    rerender({ cb: onEscape })
    fireEvent.keyDown(document, { key: 'Escape' })

    releaseOverlayToken(topToken)
    unmount()

    expect(onEscape).not.toHaveBeenCalled()
  })

  it('invokes the LATEST callback after a re-render, not the one captured on open', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender, unmount } = renderHook(
      ({ cb }: { cb: () => void }) => useOverlayEscape(true, cb),
      { initialProps: { cb: first } }
    )

    rerender({ cb: second })
    fireEvent.keyDown(document, { key: 'Escape' })
    unmount()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
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
