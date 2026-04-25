/**
 * Tests for graph visual pass — feedback items #32, #34, #37
 *
 * #32 — Unit bubble fill is 'none' (invisible fill, stroke-only boundary)
 * #34 — Wrap long node labels (text-wrap: 'wrap')
 * #37 — Highlighted node label stays readable
 *
 * Note: #39 (no re-render on unchanged toggles) is covered by PR #984's
 * EdgeFilters removal — that work is already in main.
 */

import { describe, it, expect } from 'vitest'
import { getCytoscapeStyles } from './cytoscapeStyles'
import { getUnitBubbleStyle, getUnitBubbleOptions, getBunkBubbleOptions } from './bubbleRenderer'

// Helper: access style property by string key without TypeScript index errors
// (Cytoscape's StylesheetStyle.style is a union type, not an open record)
function styleOf(
  styles: ReturnType<typeof getCytoscapeStyles>,
  selector: string
): Record<string, unknown> | undefined {
  const entry = styles.find((s) => s.selector === selector)
  return entry ? (entry.style as unknown as Record<string, unknown>) : undefined
}

// ── #32: Unit bubble fill is 'none' ─────────────────────────────────────────

describe('#32 unit bubble fill is none', () => {
  /**
   * Unit bubbles use fillOpacity: 0 to make the fill invisible, showing only
   * the stroke boundary. Setting fill: unitColor while fillOpacity: 0 is
   * misleading — the color is never shown. The intent-preserving fix is
   * fill: 'none', making the invisible fill explicit.
   */
  it("unit bubble style has fill: 'none' (not the unit color)", () => {
    const style = getUnitBubbleStyle('#ff0000')
    expect(style.fill).toBe('none')
  })

  it('unit bubble style still has fillOpacity: 0', () => {
    const style = getUnitBubbleStyle('#ff0000')
    expect(style.fillOpacity).toBe(0)
  })

  it('unit bubble style stroke uses the provided color', () => {
    const color = '#aabbcc'
    const style = getUnitBubbleStyle(color)
    expect(style.stroke).toBe(color)
  })
})

// ── #32: Unit bubble feather + gap (unit-only, bunks unchanged) ─────────────

describe('#32 unit bubble feather + whitespace gap', () => {
  /**
   * Spec lock 2026-04-24:
   *   (a) Clear whitespace gap between unit boundary and contained bunk bubbles
   *       → unit morphBuffer must be substantially larger than bunk morphBuffer
   *   (b) Smoother spline (Photoshop-feather style, not wiggly)
   *       → unit pixelGroup must be larger than bunk pixelGroup (smoother contour)
   *   Bunk bubbles must be unchanged.
   */
  it('unit bubble nodeR1 is substantially larger than bunk nodeR1 (visible gap)', () => {
    const unitOpts = getUnitBubbleOptions() as { nodeR1?: number }
    const bunkOpts = getBunkBubbleOptions() as { nodeR1?: number }
    // Bunk uses bubbleset default (nodeR1≈10) since it's not overridden.
    const bunkNodeR1 = bunkOpts.nodeR1 ?? 10
    // Unit must extend its contour at least 20px beyond bunk's contour
    // (visual whitespace gap between bunk edge and unit boundary).
    expect(unitOpts.nodeR1).toBeDefined()
    expect(unitOpts.nodeR1!).toBeGreaterThanOrEqual(bunkNodeR1 + 20)
  })

  it('unit bubble threshold is lower than bunk threshold (contour reaches further)', () => {
    const unitOpts = getUnitBubbleOptions()
    const bunkOpts = getBunkBubbleOptions()
    expect(unitOpts.threshold).toBeLessThan(bunkOpts.threshold)
  })

  it('unit bubble pixelGroup is larger than bunk pixelGroup (smoother contour)', () => {
    const unitOpts = getUnitBubbleOptions()
    const bunkOpts = getBunkBubbleOptions()
    expect(unitOpts.pixelGroup).toBeGreaterThan(bunkOpts.pixelGroup)
  })

  it('bunk bubble options preserve the existing tuned values (do not touch bunks)', () => {
    const bunkOpts = getBunkBubbleOptions()
    expect(bunkOpts.morphBuffer).toBe(35)
    expect(bunkOpts.pixelGroup).toBe(4)
  })
})

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
