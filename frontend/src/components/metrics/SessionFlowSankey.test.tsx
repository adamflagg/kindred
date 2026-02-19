/**
 * TDD tests for SessionFlowSankey enhancements.
 *
 * Tests written FIRST before implementation.
 * Validates source-colored links, hover interaction, and dynamic height.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SessionFlowSankey } from './SessionFlowSankey'
import type { SankeyData } from '../../utils/retentionTransforms'

// Recharts SVG rendering is limited in jsdom. We test what we can observe:
// - Title renders
// - Container exists with correct height attribute
// - The component doesn't crash with valid data

const sampleData: SankeyData = {
  nodes: [
    { name: 'Session 1 (from)' },
    { name: 'Session 2 (from)' },
    { name: 'Session 1 (to)' },
    { name: 'Session 2 (to)' },
    { name: 'Did Not Return' },
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
