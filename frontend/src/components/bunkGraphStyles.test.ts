/**
 * Tests for bunk graph style helpers.
 *
 * These helpers were extracted from BunkSocialGraphModal so their behavior
 * (binary connection coloring, light/dark grade pairing, first-year badge)
 * can be exercised without standing up cytoscape.
 */
import { describe, expect, it } from 'vitest'
import {
  buildBunkColaLayoutOptions,
  buildBunkGraphElements,
  BUNK_NODE_COLORS,
  FIRST_YEAR_RING_COLOR,
  FIRST_YEAR_RING_WIDTH,
  getBunkCytoscapeStyles,
  getBunkGradeColors,
  getNodeColor,
} from './bunkGraphStyles'
import { EDGE_COLORS } from './graph/constants'

function fakeEle(data: Record<string, unknown>): { data: (key: string) => unknown } {
  return { data: (key: string) => data[key] }
}

function findEdgeStyle(
  styles: ReturnType<typeof getBunkCytoscapeStyles>,
  selector: string
): Record<string, unknown> | undefined {
  const entry = styles.find((s) => s.selector === selector)
  return entry?.style as Record<string, unknown> | undefined
}

describe('getNodeColor', () => {
  it('returns the no-connections red for an isolated node', () => {
    expect(getNodeColor(0)).toBe(BUNK_NODE_COLORS.noConnections)
  })

  it('returns the connected green for any positive degree', () => {
    expect(getNodeColor(1)).toBe(BUNK_NODE_COLORS.hasConnections)
    expect(getNodeColor(2)).toBe(BUNK_NODE_COLORS.hasConnections)
    expect(getNodeColor(7)).toBe(BUNK_NODE_COLORS.hasConnections)
  })

  it('uses only two colors — red and green, no yellow tier', () => {
    const palette = new Set<string>()
    for (let degree = 0; degree <= 10; degree++) {
      palette.add(getNodeColor(degree))
    }
    expect(palette.size).toBe(2)
    expect(palette.has(BUNK_NODE_COLORS.noConnections)).toBe(true)
    expect(palette.has(BUNK_NODE_COLORS.hasConnections)).toBe(true)
  })
})

describe('getBunkGradeColors', () => {
  it('returns an empty mapping when no grades are present', () => {
    expect(getBunkGradeColors([])).toEqual({})
  })

  it('uses the lighter end of the scale for a single grade', () => {
    const colors = getBunkGradeColors([4])
    expect(colors[4]).toBe(BUNK_NODE_COLORS.gradeLight)
  })

  it('maps youngest to light and oldest to dark for a 2-grade bunk', () => {
    const colors = getBunkGradeColors([3, 5])
    expect(colors[3]).toBe(BUNK_NODE_COLORS.gradeLight)
    expect(colors[5]).toBe(BUNK_NODE_COLORS.gradeDark)
  })

  it('walks light → mid → dark for a 3-grade bunk', () => {
    const colors = getBunkGradeColors([2, 3, 4])
    expect(colors[2]).toBe(BUNK_NODE_COLORS.gradeLight)
    expect(colors[3]).toBe(BUNK_NODE_COLORS.gradeMid)
    expect(colors[4]).toBe(BUNK_NODE_COLORS.gradeDark)
  })

  it('does not use raw blue (#3498db) or raw red (#e74c3c) for grade hues', () => {
    const colors = getBunkGradeColors([2, 3, 4])
    const values = Object.values(colors)
    expect(values).not.toContain('#3498db')
    expect(values).not.toContain('#e74c3c')
  })

  it('sorts grades before assigning so input order does not matter', () => {
    const ascending = getBunkGradeColors([3, 5])
    const descending = getBunkGradeColors([5, 3])
    expect(ascending).toEqual(descending)
  })
})

describe('buildBunkGraphElements grade coloring', () => {
  it('colors a grade-0 camper from the grade ramp, not the missing-grade gray', () => {
    // Grade 0 is a real (youngest) grade. A truthy `node.grade ? …` check would
    // misclassify it as "no grade" and fall back to gray (#666666).
    const elements = buildBunkGraphElements(
      { nodes: [{ id: 101, name: 'Emma Johnson', grade: 0 }], edges: [] },
      false,
      () => 0.5
    )
    const node = elements.find((e) => e.data?.id === 'node-101')
    expect(node?.data?.['gradeColor']).toBe(getBunkGradeColors([0])[0])
    expect(node?.data?.['gradeColor']).not.toBe('#666666')
  })
})

describe('buildBunkGraphElements multi (mixed-type conflict pairs)', () => {
  const nodes = [
    { id: 1, name: 'Emma Johnson', grade: 4 },
    { id: 2, name: 'Liam Garcia', grade: 4 },
  ]

  it('flags both edges of a mixed-type opposing pair so the stylesheet curves them', () => {
    // Backend buckets by (pair, request_type), so an A→B bunk_with paired with
    // B→A not_bunk_with ships as TWO directed edges. As straight edges they'd
    // overlap on one line; multi splays them onto opposing beziers.
    const elements = buildBunkGraphElements(
      {
        nodes,
        edges: [
          {
            source: 1,
            target: 2,
            weight: 1,
            edge_type: 'request',
            reciprocal: false,
            request_type: 'bunk_with',
          },
          {
            source: 2,
            target: 1,
            weight: 1,
            edge_type: 'request',
            reciprocal: false,
            request_type: 'not_bunk_with',
          },
        ],
      },
      false,
      () => 0.5
    )
    const edges = elements.filter((e) => e.group === 'edges')
    expect(edges).toHaveLength(2)
    expect(edges.every((e) => e.data?.['multi'] === true)).toBe(true)
  })

  it('does not flag a single one-way edge as multi', () => {
    const elements = buildBunkGraphElements(
      {
        nodes,
        edges: [
          {
            source: 1,
            target: 2,
            weight: 1,
            edge_type: 'request',
            reciprocal: false,
            request_type: 'bunk_with',
          },
        ],
      },
      false,
      () => 0.5
    )
    const edge = elements.find((e) => e.group === 'edges')
    expect(edge?.data?.['multi']).toBeUndefined()
  })

  it('does not flag a backend-collapsed reciprocal edge as multi', () => {
    // Same-type mutual pairs are collapsed to one reciprocal edge upstream —
    // that single edge must stay straight/solid, not curved.
    const elements = buildBunkGraphElements(
      {
        nodes,
        edges: [
          {
            source: 1,
            target: 2,
            weight: 1,
            edge_type: 'request',
            reciprocal: true,
            request_type: 'bunk_with',
          },
        ],
      },
      false,
      () => 0.5
    )
    const edge = elements.find((e) => e.group === 'edges')
    expect(edge?.data?.['multi']).toBeUndefined()
  })

  it('flags mixed-type cross-scope pairs as multi too', () => {
    const elements = buildBunkGraphElements(
      {
        nodes: [{ id: 1, name: 'Emma Johnson', grade: 4 }],
        edges: [],
        cross_scope_nodes: [{ id: 9, name: 'Olivia Chen', grade: 4, bunk_name: 'Cabin 3' }],
        cross_scope_edges: [
          {
            source: 1,
            target: 9,
            weight: 1,
            edge_type: 'request',
            request_type: 'bunk_with',
            confidence: 0.8,
            reciprocal: false,
            cross_scope: true,
          },
          {
            source: 9,
            target: 1,
            weight: 1,
            edge_type: 'request',
            request_type: 'not_bunk_with',
            confidence: 0.8,
            reciprocal: false,
            cross_scope: true,
          },
        ],
      },
      true,
      () => 0.5
    )
    const crossEdges = elements.filter(
      (e) => e.group === 'edges' && e.data?.['cross_scope'] === true
    )
    expect(crossEdges).toHaveLength(2)
    expect(crossEdges.every((e) => e.data?.['multi'] === true)).toBe(true)
  })
})

describe('getBunkCytoscapeStyles edge[?multi]', () => {
  it('splays multi-flagged edges onto unbundled-bezier curves (parity with session graph)', () => {
    const multiStyle = findEdgeStyle(getBunkCytoscapeStyles(), 'edge[?multi]')
    expect(multiStyle).toBeDefined()
    expect(multiStyle?.['curve-style']).toBe('unbundled-bezier')
    expect(multiStyle?.['control-point-distances']).toEqual([40])
    expect(multiStyle?.['control-point-weights']).toEqual([0.5])
  })
})

describe('buildBunkColaLayoutOptions', () => {
  it('derives a bounding box matching the container aspect so cola fills the canvas width', () => {
    const opts = buildBunkColaLayoutOptions(1600, 900)
    const bb = opts['boundingBox'] as { x1: number; y1: number; w: number; h: number }
    expect(bb).toEqual({ x1: 0, y1: 0, w: 1600, h: 900 })
    expect(bb.w / bb.h).toBeCloseTo(1600 / 900)
  })

  it('preserves the #1640 disconnected-cluster spacing options', () => {
    const opts = buildBunkColaLayoutOptions(1600, 900)
    expect(opts['name']).toBe('cola')
    expect(opts['nodeSpacing']).toBe(30)
    expect(opts['padding']).toBe(30)
    expect(opts['handleDisconnected']).toBe(true)
  })

  it('omits the bounding box when the container has not been measured yet', () => {
    // Guards against a zero-area box on the first paint before layout settles.
    expect(buildBunkColaLayoutOptions(0, 0)['boundingBox']).toBeUndefined()
    expect(buildBunkColaLayoutOptions(1200, 0)['boundingBox']).toBeUndefined()
  })
})

describe('FIRST_YEAR_RING_COLOR', () => {
  it('is not the legacy purple ring (#9b59b6)', () => {
    expect(FIRST_YEAR_RING_COLOR.toLowerCase()).not.toBe('#9b59b6')
  })

  it('is a yellow/orange/amber hue (warm, high luminance)', () => {
    // Loosely: warm hue means R component meaningfully above B component.
    const hex = FIRST_YEAR_RING_COLOR.replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    expect(r).toBeGreaterThan(b + 80)
  })
})

describe('FIRST_YEAR_RING_WIDTH', () => {
  it('is thicker than the default node border so the ring reads as a marker', () => {
    expect(FIRST_YEAR_RING_WIDTH).toBeGreaterThanOrEqual(5)
  })
})

describe('getBunkCytoscapeStyles', () => {
  it('returns an array of style definitions including an edge selector', () => {
    const styles = getBunkCytoscapeStyles()
    expect(Array.isArray(styles)).toBe(true)
    expect(styles.find((s) => s.selector === 'edge')).toBeDefined()
  })

  it('renders not_bunk_with edges with the red line-color (parity with session graph)', () => {
    const edgeStyle = findEdgeStyle(getBunkCytoscapeStyles(), 'edge')
    expect(edgeStyle).toBeDefined()
    const lineColor = edgeStyle?.['line-color'] as (ele: ReturnType<typeof fakeEle>) => string
    expect(typeof lineColor).toBe('function')
    const ele = fakeEle({ edge_type: 'request', request_type: 'not_bunk_with' })
    expect(lineColor(ele)).toBe(EDGE_COLORS['not_bunk_with'])
  })

  it('renders not_bunk_with edges with the red target-arrow-color (parity with session graph)', () => {
    const edgeStyle = findEdgeStyle(getBunkCytoscapeStyles(), 'edge')
    const arrowColor = edgeStyle?.['target-arrow-color'] as (
      ele: ReturnType<typeof fakeEle>
    ) => string
    expect(typeof arrowColor).toBe('function')
    const ele = fakeEle({ edge_type: 'request', request_type: 'not_bunk_with' })
    expect(arrowColor(ele)).toBe(EDGE_COLORS['not_bunk_with'])
  })

  it('renders reciprocal not_bunk_with edges with the red source-arrow-color', () => {
    const reciprocalStyle = findEdgeStyle(getBunkCytoscapeStyles(), 'edge[?reciprocal]')
    expect(reciprocalStyle).toBeDefined()
    const sourceArrowColor = reciprocalStyle?.['source-arrow-color'] as (
      ele: ReturnType<typeof fakeEle>
    ) => string
    expect(typeof sourceArrowColor).toBe('function')
    const ele = fakeEle({ edge_type: 'request', request_type: 'not_bunk_with' })
    expect(sourceArrowColor(ele)).toBe(EDGE_COLORS['not_bunk_with'])
  })

  it('keeps bunk_with edges blue (line-color unchanged for positive requests)', () => {
    const edgeStyle = findEdgeStyle(getBunkCytoscapeStyles(), 'edge')
    const lineColor = edgeStyle?.['line-color'] as (ele: ReturnType<typeof fakeEle>) => string
    const ele = fakeEle({ edge_type: 'request', request_type: 'bunk_with' })
    expect(lineColor(ele)).toBe(EDGE_COLORS['request'])
  })
})
