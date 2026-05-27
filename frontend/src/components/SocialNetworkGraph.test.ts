import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('SocialNetworkGraph safety guards', () => {
  const source = readFileSync(resolve(__dirname, './SocialNetworkGraph.tsx'), 'utf-8')

  it('has a cancellation guard in the init effect to prevent stale async work', () => {
    // The init effect uses addElementsStaged().then(runLayout) which is async.
    // If deps change mid-build, the stale promise must not apply layout to a
    // newer (or destroyed) Cytoscape instance. A `cancelled` flag guards this.
    expect(source).toContain('let cancelled = false')
    expect(source).toContain('if (cancelled')
    expect(source).toContain('cancelled = true')
  })

  it('terminates the layout worker in the init-effect cleanup so each rebuild gets a fresh PRNG', () => {
    // fcose with `randomize: true` is sensitive to the JS engine's Math.random
    // state. The worker is long-lived (`layoutWorkerRef.current ??= new Worker(...)`)
    // so back-to-back layouts (e.g. switching scenarios after a prod load) reuse
    // a worker whose PRNG has already been advanced by the prior fcose run. On
    // some seeds this collapses the second layout to a near-line — fixed only
    // by a page refresh, which spins up a fresh worker.
    //
    // The init effect's cleanup must therefore terminate the worker and null
    // the ref, so the next runLayout creates a brand-new worker (and a fresh
    // PRNG state) for each graphData change.
    const cleanupBlock = source.match(
      /return\s*\(\s*\)\s*=>\s*\{[\s\S]*?cleanupCytoscape\([\s\S]*?\}/
    )
    expect(cleanupBlock).not.toBeNull()
    expect(cleanupBlock?.[0]).toMatch(/layoutWorkerRef\.current\?\.\s*terminate\(\)/)
    expect(cleanupBlock?.[0]).toMatch(/layoutWorkerRef\.current\s*=\s*null/)
  })

  it('restores bubbles after layout completes when showBubbles is enabled', () => {
    // When the graph rebuilds (data/viewMode change) and showBubbles is on,
    // onLayoutComplete must redraw bubbles on the new Cytoscape instance.
    // Without this, bubbles vanish until the user toggles off/on.
    expect(source).toContain(
      'drawBunkBubbles(cy, bunksData, bubbleRefs, undefined, showUnits, showBubbles)'
    )
  })

  it('clears bubbles when showBubbles is toggled OFF in the resize effect', () => {
    expect(source).toContain('clearBubbles(bubbleRefs)')
  })

  it('does not render or import GraphMetrics (network metrics UI removed)', () => {
    expect(source).not.toMatch(/<GraphMetrics\b/)
    expect(source).not.toMatch(/\bGraphMetrics\b/)
  })

  it('does not reference ego view mode', () => {
    // Ego network concept fully removed from the graph UI.
    expect(source).not.toMatch(/['"]ego['"]/)
    expect(source).not.toMatch(/\bViewMode\b/)
  })

  it('resets hasMountedExpandRef on graph rebuild to prevent expand/fit RAF race (#1663)', () => {
    // When graphData changes, the init effect destroys the old Cytoscape instance
    // and creates a new one. Without resetting hasMountedExpandRef.current, the
    // isExpanded effect skips its first-run guard and the expand/fit RAF chain
    // races the new instance's own worker layout+fit call.
    // Verify the reset appears adjacent to the destroy/null sequence.
    const destroyPos = source.indexOf('cyRef.current.destroy()')
    const nullPos = source.indexOf('cyRef.current = null')
    const resetPos = source.indexOf('hasMountedExpandRef.current = false')
    expect(destroyPos).toBeGreaterThan(0)
    expect(nullPos).toBeGreaterThan(destroyPos)
    // The ref reset must appear after the destroy and within the same block
    expect(resetPos).toBeGreaterThan(destroyPos)
    // And before a new `const cy = cytoscape` call that creates the next instance
    const createPos = source.indexOf('const cy = cytoscape(')
    expect(resetPos).toBeLessThan(createPos)
  })
})

describe('SocialNetworkGraph header layout — slim single row', () => {
  const source = readFileSync(resolve(__dirname, './SocialNetworkGraph.tsx'), 'utf-8')

  it('initialises showEdges with request true (always-on)', () => {
    // request must be present and default to true. Sibling has been removed.
    expect(source).toContain('request: true')
    expect(source).not.toContain('sibling: true')
  })

  it('does NOT render <EdgeFilters> (edge filter section removed)', () => {
    // The EdgeFilters component should no longer appear in the JSX
    expect(source).not.toMatch(/<EdgeFilters\b/)
  })

  it('renders showBubbles toggle inline in the top header row', () => {
    // bunks toggle must live in the main header JSX
    expect(source).toContain('showBubbles')
    expect(source).toContain('setShowBubbles')
    // And it must appear BEFORE the graph canvas div (i.e., in the header)
    const headerEnd = source.indexOf('Graph container')
    const bubblesPos = source.indexOf('showBubbles')
    expect(bubblesPos).toBeGreaterThan(0)
    expect(bubblesPos).toBeLessThan(headerEnd)
  })

  it('renders showUnits toggle inline in the top header row', () => {
    const headerEnd = source.indexOf('Graph container')
    const unitsPos = source.indexOf('showUnits')
    expect(unitsPos).toBeGreaterThan(0)
    expect(unitsPos).toBeLessThan(headerEnd)
  })

  it('does not import EdgeFilters at the top of the file', () => {
    // EdgeFilters import should be removed since the component is no longer used
    expect(source).not.toMatch(/\bEdgeFilters\b/)
  })
})
