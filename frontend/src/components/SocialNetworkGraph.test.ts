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

  it('restores bubbles after layout completes when showBubbles is enabled', () => {
    // When the graph rebuilds (data/viewMode change) and showBubbles is on,
    // onLayoutComplete must redraw bubbles on the new Cytoscape instance.
    // Without this, bubbles vanish until the user toggles off/on.
    expect(source).toContain(
      'drawBunkBubbles(cy, bunksData, bubbleRefs, setBubbleRenderStatus, showUnits, showBubbles)'
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
})

describe('SocialNetworkGraph header layout — slim single row', () => {
  const source = readFileSync(resolve(__dirname, './SocialNetworkGraph.tsx'), 'utf-8')

  it('initialises showEdges with request and sibling both true (always-on)', () => {
    // request and sibling must be present and default to true
    expect(source).toContain('request: true')
    expect(source).toContain('sibling: true')
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
