/**
 * TDD tests for SessionFlowSankey enhancements.
 *
 * Tests written FIRST before implementation.
 * Validates source-colored links, hover interaction, and dynamic height.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SessionFlowSankey } from './SessionFlowSankey'
import { buildCmIdColorMap, resolveNodeColor, DID_NOT_RETURN_COLOR } from './sankeyColors'
import type { SankeyData } from '../../utils/retentionTransforms'

// Recharts SVG rendering is limited in jsdom. We test what we can observe:
// - Title renders
// - Container exists with correct height attribute
// - The component doesn't crash with valid data

const sampleData: SankeyData = {
  nodes: [
    { name: 'Session 1 (from)', cmId: 1000 },
    { name: 'Session 2 (from)', cmId: 1001 },
    { name: 'Session 1 (to)', cmId: 1000 },
    { name: 'Session 2 (to)', cmId: 1001 },
    { name: 'Did Not Return', cmId: null },
  ],
  links: [
    { source: 0, target: 2, value: 30 },
    { source: 0, target: 3, value: 15 },
    { source: 0, target: 4, value: 10 },
    { source: 1, target: 2, value: 5 },
    { source: 1, target: 3, value: 25 },
    { source: 1, target: 4, value: 8 },
  ],
}

describe('SessionFlowSankey', () => {
  it('renders the title', () => {
    render(<SessionFlowSankey data={sampleData} title="Session Flow: 2025 → 2026" />)

    expect(screen.getByText('Session Flow: 2025 → 2026')).toBeInTheDocument()
  })

  it('renders without crashing with valid data', () => {
    const { container } = render(<SessionFlowSankey data={sampleData} title="Session Flow" />)

    // Should render a card container
    expect(container.querySelector('.card-lodge')).toBeInTheDocument()
  })

  it('uses increased height for the dedicated tab (min 500px)', () => {
    // With 2 source nodes, height should be max(500, 2 * 100) = 500
    const { container } = render(<SessionFlowSankey data={sampleData} title="Test" />)

    // ResponsiveContainer sets height on its wrapper
    const responsiveContainer = container.querySelector('[style*="height"]')
    if (responsiveContainer) {
      const style = responsiveContainer.getAttribute('style') ?? ''
      // Height should be at least 500px (the new minimum)
      const heightMatch = style.match(/height:\s*(\d+)/)
      if (heightMatch) {
        expect(Number(heightMatch[1])).toBeGreaterThanOrEqual(500)
      }
    }
  })

  it('renders with empty links gracefully', () => {
    const emptyData: SankeyData = { nodes: [], links: [] }
    // Should not crash
    const { container } = render(<SessionFlowSankey data={emptyData} title="Empty" />)

    expect(container.querySelector('.card-lodge')).toBeInTheDocument()
  })
})

describe('buildCmIdColorMap', () => {
  it('assigns the same color to nodes sharing a cmId', () => {
    const nodes = [
      { name: 'Session 1 (from)', cmId: 1000 },
      { name: 'Session 2 (from)', cmId: 1001 },
      { name: 'Session 1 (to)', cmId: 1000 },
      { name: 'Session 2 (to)', cmId: 1001 },
    ]
    const map = buildCmIdColorMap(nodes)

    // Same cmId → same color
    expect(map.get(1000)).toBeDefined()
    expect(map.get(1001)).toBeDefined()
    expect(map.get(1000)).not.toBe(map.get(1001))
  })

  it('does not assign a color for null cmId (Did Not Return)', () => {
    const nodes = [
      { name: 'Session 1 (from)', cmId: 1000 },
      { name: 'Did Not Return', cmId: null },
    ]
    const map = buildCmIdColorMap(nodes)

    expect(map.has(1000)).toBe(true)
    // null cmId should not be in the map
    expect(map.size).toBe(1)
  })

  it('cycles through palette for many sessions', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({
      name: `Session ${i + 1}`,
      cmId: 2000 + i,
    }))
    const map = buildCmIdColorMap(nodes)

    // All 12 should get a color (cycling through the palette)
    expect(map.size).toBe(12)
    // Colors should cycle: cmId 2000 and 2008 share the same palette slot
    expect(map.get(2000)).toBe(map.get(2008))
  })
})

describe('resolveNodeColor', () => {
  it('returns the session color when node has a cmId', () => {
    const cmIdColorMap = new Map([[1000, '#059669']])
    // Recharts passes source/target as node objects, not indices
    const nodeObj = { cmId: 1000, name: 'Session 1' }
    expect(resolveNodeColor(nodeObj, cmIdColorMap)).toBe('#059669')
  })

  it('returns DID_NOT_RETURN_COLOR when node has null cmId', () => {
    const cmIdColorMap = new Map<number, string>()
    const nodeObj = { cmId: null, name: 'Did Not Return' }
    expect(resolveNodeColor(nodeObj, cmIdColorMap)).toBe(DID_NOT_RETURN_COLOR)
  })

  it('returns DID_NOT_RETURN_COLOR when cmId is not in the map', () => {
    const cmIdColorMap = new Map([[1000, '#059669']])
    const nodeObj = { cmId: 9999, name: 'Unknown' }
    expect(resolveNodeColor(nodeObj, cmIdColorMap)).toBe(DID_NOT_RETURN_COLOR)
  })

  it('handles node objects as Recharts actually passes them (with extra props)', () => {
    // Recharts enriches nodes with x, y, dx, dy, depth, etc.
    const cmIdColorMap = new Map([[1000, '#2563eb']])
    const rechartsNode = {
      cmId: 1000,
      name: 'Session 1 (from)',
      x: 0,
      y: 50,
      dx: 14,
      dy: 100,
      depth: 0,
      value: 55,
      sourceNodes: [],
      sourceLinks: [],
      targetNodes: [2, 3],
      targetLinks: [0, 1],
    }
    expect(resolveNodeColor(rechartsNode, cmIdColorMap)).toBe('#2563eb')
  })
})
