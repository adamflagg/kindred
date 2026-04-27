/**
 * Tests for LayoutWorker lifecycle guards.
 *
 * Regression tests for: "Cannot read properties of null (reading 'notify')"
 * thrown when a stale LayoutWorker message arrives after Cytoscape is
 * destroyed/replaced by a new render.
 *
 * The guards tested here are:
 *  1. Instance token — each message dispatch carries a monotonically-increasing
 *     token.  The onmessage handler drops results whose token ≠ current token.
 *  2. Destroyed-check — before cy.batch() and bubble-creation, verify
 *     !cy.destroyed() and short-circuit if the instance is gone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LayoutWorkerOutput } from './layoutWorker'
import { makeLayoutToken, isStaleLayoutMessage, applyLayoutPositions } from './layoutWorkerGuards'

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

describe('makeLayoutToken', () => {
  it('returns a new unique token each call', () => {
    const t1 = makeLayoutToken()
    const t2 = makeLayoutToken()
    expect(t1).not.toBe(t2)
  })

  it('returns a positive integer', () => {
    const t = makeLayoutToken()
    expect(Number.isInteger(t)).toBe(true)
    expect(t).toBeGreaterThan(0)
  })
})

describe('isStaleLayoutMessage', () => {
  it('returns false when token matches', () => {
    const token = makeLayoutToken()
    expect(isStaleLayoutMessage(token, token)).toBe(false)
  })

  it('returns true when token does not match (stale message)', () => {
    const old = makeLayoutToken()
    const current = makeLayoutToken()
    expect(isStaleLayoutMessage(old, current)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// applyLayoutPositions — the core onmessage handler logic
// ---------------------------------------------------------------------------

function makeMockCy(destroyed = false) {
  const batchFn = vi.fn((cb: () => void) => cb())
  return {
    destroyed: () => destroyed,
    batch: batchFn,
    getElementById: vi.fn(() => ({ length: 1, position: vi.fn() })),
    fit: vi.fn(),
  }
}

describe('applyLayoutPositions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies positions when token is current and cy is alive', () => {
    const token = makeLayoutToken()
    const cy = makeMockCy(false)
    const positions = { node1: { x: 10, y: 20 }, node2: { x: 30, y: 40 } }
    const event: MessageEvent<LayoutWorkerOutput> = new MessageEvent('message', {
      data: { type: 'positions', positions, token },
    })

    const result = applyLayoutPositions(event, token, cy as never)

    expect(result).toBe('applied')
    expect(cy.batch).toHaveBeenCalledOnce()
    expect(cy.fit).toHaveBeenCalledOnce()
  })

  it('drops result and does NOT call cy.batch when token is stale (old cy destroyed)', () => {
    const oldToken = makeLayoutToken()
    const currentToken = makeLayoutToken() // scenario changed, new token
    const cy = makeMockCy(false) // even if cy somehow still lives, stale token wins
    const positions = { node1: { x: 10, y: 20 } }
    const event: MessageEvent<LayoutWorkerOutput> = new MessageEvent('message', {
      data: { type: 'positions', positions, token: oldToken },
    })

    const result = applyLayoutPositions(event, currentToken, cy as never)

    expect(result).toBe('stale')
    expect(cy.batch).not.toHaveBeenCalled()
    expect(cy.fit).not.toHaveBeenCalled()
  })

  it('drops result and does NOT call cy.batch when cy is destroyed (token matches)', () => {
    const token = makeLayoutToken()
    const destroyedCy = makeMockCy(true) // cy was destroyed before message arrived
    const positions = { node1: { x: 10, y: 20 } }
    const event: MessageEvent<LayoutWorkerOutput> = new MessageEvent('message', {
      data: { type: 'positions', positions, token },
    })

    // This is the crash path: token is current but cy was torn down mid-flight
    const result = applyLayoutPositions(event, token, destroyedCy as never)

    expect(result).toBe('destroyed')
    expect(destroyedCy.batch).not.toHaveBeenCalled()
  })

  it('drops result when event.data.token is missing (legacy/unguarded message)', () => {
    const currentToken = makeLayoutToken()
    const cy = makeMockCy(false)
    const positions = { node1: { x: 10, y: 20 } }
    // No token field in the data — simulates a message from before the guard was added
    const event: MessageEvent<LayoutWorkerOutput> = new MessageEvent('message', {
      data: { type: 'positions', positions } as unknown as LayoutWorkerOutput,
    })

    const result = applyLayoutPositions(event, currentToken, cy as never)

    // Missing token cannot match any current token → treated as stale
    expect(result).toBe('stale')
    expect(cy.batch).not.toHaveBeenCalled()
  })

  it('does nothing when type is not "positions"', () => {
    const token = makeLayoutToken()
    const cy = makeMockCy(false)
    const event: MessageEvent<LayoutWorkerOutput> = new MessageEvent('message', {
      data: { type: 'error', error: 'layout failed', token } as unknown as LayoutWorkerOutput,
    })

    const result = applyLayoutPositions(event, token, cy as never)

    expect(result).toBe('not-positions')
    expect(cy.batch).not.toHaveBeenCalled()
  })
})
