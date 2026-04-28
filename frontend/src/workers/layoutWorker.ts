/**
 * WebWorker for computing graph layouts off the main thread.
 * Uses Cytoscape in headless mode with fcose for compound node support.
 */

import cytoscape from 'cytoscape'
// @ts-expect-error - No types available for cytoscape-fcose
import fcose from 'cytoscape-fcose'

// Register fcose extension
cytoscape.use(fcose)

export interface LayoutWorkerInput {
  nodes: Array<{
    data: {
      id: string
      parent?: string
      [key: string]: unknown
    }
  }>
  edges: Array<{
    data: {
      id: string
      source: string
      target: string
      [key: string]: unknown
    }
  }>
  /** Full serializable fcose options from getFcoseOptions(). Worker is a
   *  passthrough — non-serializable extras (idealEdgeLength fn) added below. */
  options: Record<string, unknown>
  /** Instance token issued by the main thread; echoed back in the response so
   *  stale results from a previous cy instance can be discarded. */
  token?: number
}

export interface LayoutWorkerOutput {
  type: 'positions' | 'error' | 'progress'
  positions?: Record<string, { x: number; y: number }>
  error?: string
  progress?: number
  /** Echoed from the input token so the main thread can detect stale results. */
  token?: number
}

// Handle messages from main thread
self.onmessage = (event: MessageEvent<LayoutWorkerInput>) => {
  const startTime = performance.now()
  // Hoist token so the catch block can echo it back too
  const token: number | undefined = event.data.token

  try {
    const { nodes, edges, options } = event.data

    // Create headless Cytoscape instance
    const cy = cytoscape({
      headless: true,
      styleEnabled: false,
      elements: {
        nodes,
        edges,
      },
    })

    // Worker is a pure passthrough — main thread owns the full fcose config
    // via getFcoseOptions(). All options are serializable; no extras injected.
    const layout = cy.layout(options as unknown as cytoscape.LayoutOptions)

    // Run layout synchronously (we're in a worker, blocking is fine)
    layout.run()

    // Extract positions
    const positions: Record<string, { x: number; y: number }> = {}
    cy.nodes().forEach((node) => {
      const pos = node.position()
      positions[node.id()] = { x: pos.x, y: pos.y }
    })

    const duration = performance.now() - startTime
    console.log(
      `[LayoutWorker] Computed ${Object.keys(positions).length} positions in ${duration.toFixed(0)}ms`
    )

    // Send positions back to main thread, echoing the token so the main thread
    // can detect and discard stale results from superseded cy instances.
    const response: LayoutWorkerOutput = {
      type: 'positions',
      positions,
      ...(token !== undefined && { token }),
    }
    self.postMessage(response)

    // Clean up
    cy.destroy()
  } catch (error) {
    const response: LayoutWorkerOutput = {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown layout error',
      ...(token !== undefined && { token }),
    }
    self.postMessage(response)
  }
}
