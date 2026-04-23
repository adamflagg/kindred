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
