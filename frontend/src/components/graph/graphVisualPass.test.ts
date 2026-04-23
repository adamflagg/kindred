/**
 * Tests for graph visual pass — feedback items #34, #37
 *
 * #34 — Wrap long node labels (text-wrap: 'wrap')
 * #37 — Highlighted node label stays readable
 *
 * Note: #39 (no re-render on unchanged toggles) is covered by PR #984's
 * EdgeFilters removal — that work is already in main.
 */

import { describe, it, expect } from 'vitest'
import { getCytoscapeStyles } from './cytoscapeStyles'

// Helper: access style property by string key without TypeScript index errors
// (Cytoscape's StylesheetStyle.style is a union type, not an open record)
function styleOf(
  styles: ReturnType<typeof getCytoscapeStyles>,
  selector: string
): Record<string, unknown> | undefined {
  const entry = styles.find((s) => s.selector === selector)
  return entry ? (entry.style as unknown as Record<string, unknown>) : undefined
}

// ── #34: Label wrapping ──────────────────────────────────────────────────────

describe('#34 node label wrap', () => {
  it('uses text-wrap: wrap (not ellipsis) on childless nodes', () => {
    const styles = getCytoscapeStyles({ showLabels: true })
    const style = styleOf(styles, 'node:childless')
    expect(style).toBeDefined()
    expect(style?.['text-wrap']).toBe('wrap')
  })

  it('sets text-max-width to allow wrapping on childless nodes', () => {
    const styles = getCytoscapeStyles({ showLabels: true })
    const style = styleOf(styles, 'node:childless')
    // text-max-width must exist and be a reasonable pixel value (e.g. '80px' or '100px')
    const maxWidth = style?.['text-max-width']
    expect(maxWidth).toBeDefined()
    expect(typeof maxWidth).toBe('string')
    expect(maxWidth as string).toMatch(/^\d+px$/)
  })
})

// ── #37: Highlighted node label readability ──────────────────────────────────

describe('#37 highlighted label readability', () => {
  it('highlighted style has a dark text-outline-color (not white) for readability on light bg', () => {
    const styles = getCytoscapeStyles({ showLabels: true })
    const style = styleOf(styles, '.highlighted')
    expect(style).toBeDefined()

    const outlineColor = style?.['text-outline-color']
    // Must not be pure white — white outline washes out names on light backgrounds
    expect(outlineColor).toBeDefined()
    expect(outlineColor).not.toBe('#fff')
    expect(outlineColor).not.toBe('#ffffff')
    expect(outlineColor).not.toBe('white')
  })

  it('highlighted node label color is not white (readable on light bg)', () => {
    const styles = getCytoscapeStyles({ showLabels: true })
    const style = styleOf(styles, '.highlighted')
    // If color is explicitly set in highlighted style, it must not be white
    const color = style?.['color']
    if (color !== undefined) {
      expect(color).not.toBe('#fff')
      expect(color).not.toBe('#ffffff')
      expect(color).not.toBe('white')
    }
    // If color is not set in the highlighted override, that's also fine —
    // the base node style handles it (no override = inherits)
  })
})

// ── #39: Prevent re-render on unchanged toggles ──────────────────────────────

describe('#39 stable showEdges callbacks', () => {
  /**
   * The edge-filter onChange callback used to fire `setShowEdges({ ...showEdges, [type]: value })`
   * even when the value hadn't changed, causing a new object reference and triggering
   * the graph rebuild effect.  The fix: guard by checking if the new value equals the old.
   */
  it('EdgeFilters source does not call onEdgeFilterChange when value is unchanged', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(resolve(__dirname, './EdgeFilters.tsx'), 'utf-8')

    // The guard should check current value before calling the callback
    // Look for a conditional that prevents the call when value hasn't changed
    expect(source).toMatch(/if.*enabled.*===.*showEdges|showEdges\[.*\].*===.*enabled/)
  })
})
