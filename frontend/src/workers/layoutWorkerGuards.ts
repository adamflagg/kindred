/**
 * Lifecycle guards for the LayoutWorker ↔ Cytoscape integration.
 *
 * Problem: the LayoutWorker is long-lived (reused across renders) but the
 * Cytoscape instance is destroyed and recreated every time graphData /
 * viewMode / bunksData / showEdges / showLabels changes. A stale worker
 * message arriving after cy has been torn down calls cy.batch() on a
 * destroyed instance, which triggers:
 *
 *   TypeError: Cannot read properties of null (reading 'notify')
 *     at id.endBatch → Array.forEach → notify
 *
 * The guards here provide two defence layers:
 *
 * 1. **Instance token** – a monotonically-increasing integer issued each time
 *    the component posts a new layout job (i.e. each time a new cy is created
 *    and runLayout is called). The worker echoes the token back in its output.
 *    The onmessage handler compares the echoed token against the latest token
 *    stored in a ref; mismatches are silently dropped.
 *
 * 2. **Destroyed-check** – even when the token matches, cy may have been
 *    destroyed between the postMessage and the onmessage callback (e.g. React
 *    StrictMode double-invocation, or a very fast scenario toggle). The guard
 *    checks cy.destroyed() before calling cy.batch().
 */

import type { Core } from 'cytoscape'
import type { LayoutWorkerOutput } from './layoutWorker'

/** Result codes returned by applyLayoutPositions for testability. */
export type ApplyResult = 'applied' | 'stale' | 'destroyed' | 'not-positions'

/** Counter for issuing unique tokens. */
let _tokenCounter = 0

/**
 * Issue a new layout instance token.
 * Call once per layout job (immediately before posting to the worker).
 * Store the returned value in a ref so the onmessage handler can compare.
 */
export function makeLayoutToken(): number {
  return ++_tokenCounter
}

/**
 * Returns true if the message's token no longer matches the current token,
 * meaning the result is stale and should be discarded.
 *
 * @param messageToken  The token echoed back by the worker (from event.data.token).
 * @param currentToken  The latest token stored in the component ref.
 */
export function isStaleLayoutMessage(
  messageToken: number | undefined,
  currentToken: number
): boolean {
  return messageToken !== currentToken
}

/**
 * Core onmessage handler logic, extracted for unit-testability.
 *
 * Guards applied (in order):
 *  1. If event.data.type !== 'positions' → skip (let the caller handle error/progress).
 *  2. If token mismatch → drop as stale.
 *  3. If cy.destroyed() → drop (late message against a torn-down instance).
 *  4. Otherwise apply positions via cy.batch() and call cy.fit().
 *
 * @returns A discriminant string describing what happened (for tests / logging).
 */
export function applyLayoutPositions(
  event: MessageEvent<LayoutWorkerOutput & { token?: number }>,
  currentToken: number,
  cy: Core
): ApplyResult {
  const { type, positions } = event.data
  const messageToken = (event.data as { token?: number }).token

  if (type !== 'positions' || !positions) {
    return 'not-positions'
  }

  // Guard 1: stale token → the cy this job was issued for no longer exists
  if (isStaleLayoutMessage(messageToken, currentToken)) {
    return 'stale'
  }

  // Guard 2: cy was destroyed between postMessage and onmessage
  if (cy.destroyed()) {
    return 'destroyed'
  }

  cy.batch(() => {
    Object.entries(positions).forEach(([nodeId, pos]) => {
      const node = cy.getElementById(nodeId)
      if (node.length > 0) {
        node.position(pos)
      }
    })
  })
  cy.fit(undefined, 80)

  return 'applied'
}
