/**
 * The token-stack half of `modalStack.ts` (kindred#2205).
 *
 * `hasOpenModal`/the background-inert counter (`Modal.test.tsx`) already
 * cover the count. This file is the escape-ownership half: which overlay,
 * among several independently-portalled ones, gets to act on a single
 * Escape keypress.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { acquireOverlayToken, hasOpenModal, isTopOverlay, releaseOverlayToken } from './modalStack'

describe('modalStack — the overlay token stack', () => {
  // The stack is module-scope, shared across every test in this file (and
  // every other file importing it in the same worker). A test that leaves a
  // token unreleased doesn't just fail its own assertion — it silently
  // poisons every test that runs after it. Fail loudly, at the source,
  // instead of debugging a confusing failure two tests later.
  afterEach(() => {
    expect(hasOpenModal()).toBe(false)
  })

  it('the only registered token is topmost', () => {
    const token = acquireOverlayToken()
    expect(isTopOverlay(token)).toBe(true)
    releaseOverlayToken(token)
  })

  it('the most recently acquired token is topmost, not the first', () => {
    const first = acquireOverlayToken()
    const second = acquireOverlayToken()

    expect(isTopOverlay(second)).toBe(true)
    expect(isTopOverlay(first)).toBe(false)

    releaseOverlayToken(second)
    releaseOverlayToken(first)
  })

  it('releasing the topmost token promotes the one beneath it', () => {
    const first = acquireOverlayToken()
    const second = acquireOverlayToken()

    releaseOverlayToken(second)

    expect(isTopOverlay(first)).toBe(true)
    releaseOverlayToken(first)
  })

  it('releasing a token that is NOT topmost does not disturb who is', () => {
    // The case the fix has to get right: a background dialog closing (e.g.
    // ScenarioManagementModal's outer Modal, torn down by something other
    // than Escape) must not hand ownership to the wrong overlay, or silently
    // steal it from the one actually on top.
    const bottom = acquireOverlayToken()
    const top = acquireOverlayToken()

    releaseOverlayToken(bottom)

    expect(isTopOverlay(top)).toBe(true)
    releaseOverlayToken(top)
  })

  it('a token nobody registered, or one already released, is never topmost', () => {
    const registered = acquireOverlayToken()
    const neverRegistered = Symbol('overlay-token')

    expect(isTopOverlay(neverRegistered)).toBe(false)

    releaseOverlayToken(registered)
    expect(isTopOverlay(registered)).toBe(false)
  })

  it('releasing an already-released token is a no-op, not a crash or a double-pop', () => {
    const first = acquireOverlayToken()
    const second = acquireOverlayToken()

    releaseOverlayToken(second)
    releaseOverlayToken(second) // already gone — must not touch `first`

    expect(isTopOverlay(first)).toBe(true)
    releaseOverlayToken(first)
  })

  it('hasOpenModal reflects whether the stack is empty, not a particular overlay', () => {
    expect(hasOpenModal()).toBe(false)

    const token = acquireOverlayToken()
    expect(hasOpenModal()).toBe(true)

    releaseOverlayToken(token)
    expect(hasOpenModal()).toBe(false)
  })

  it('mounting and unmounting several overlays, in any order, returns the stack to empty', () => {
    // The leak this guards against: a token that never gets released leaves
    // `hasOpenModal()` permanently true, which silently disables Escape for
    // every container that stands down while "a modal" is open (e.g.
    // `weekend/FamilyDetailsPanel`) — worse than the bug being fixed here.
    const a = acquireOverlayToken()
    const b = acquireOverlayToken()
    const c = acquireOverlayToken()

    // Unmount out of acquisition order, as a real component tree would if
    // the middle overlay closes first.
    releaseOverlayToken(b)
    releaseOverlayToken(a)
    releaseOverlayToken(c)

    expect(hasOpenModal()).toBe(false)

    // And the stack is usable again afterward — a leaked token would make
    // this next overlay topmost-forever or never-topmost, either wrong.
    const fresh = acquireOverlayToken()
    expect(isTopOverlay(fresh)).toBe(true)
    releaseOverlayToken(fresh)
    expect(hasOpenModal()).toBe(false)
  })
})
