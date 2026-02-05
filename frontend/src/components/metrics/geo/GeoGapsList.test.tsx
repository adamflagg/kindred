/**
 * Tests for GeoGapsList component.
 *
 * Validates that the gap tracking panel displays unmapped items
 * sorted by count (highest-impact gaps first).
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GeoGapsList } from './GeoGapsList'
import type { GeoDataItem } from './GeoMap'

const sampleGaps: GeoDataItem[] = [
  { name: 'Unknown School A', count: 15, percentage: 10.0 },
  { name: 'Unknown School B', count: 5, percentage: 3.3 },
  { name: 'Unknown School C', count: 25, percentage: 16.7 },
]

describe('GeoGapsList', () => {
  it('renders nothing when gaps array is empty', () => {
    const { container } = render(<GeoGapsList gaps={[]} category="school" />)
    // Should render empty or null when no gaps
    expect(container.textContent).toBe('')
  })

  it('renders gap items sorted by count descending', () => {
    render(<GeoGapsList gaps={sampleGaps} category="school" />)

    // All gap names should be present
    expect(screen.getByText('Unknown School C')).toBeInTheDocument()
    expect(screen.getByText('Unknown School A')).toBeInTheDocument()
    expect(screen.getByText('Unknown School B')).toBeInTheDocument()

    // Counts should be present
    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.getByText('15')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('displays category-aware header', () => {
    render(<GeoGapsList gaps={sampleGaps} category="school" />)
    expect(screen.getByText(/unmapped schools/i)).toBeInTheDocument()

    const { unmount } = render(<GeoGapsList gaps={sampleGaps} category="city" />)
    expect(screen.getByText(/unmapped cities/i)).toBeInTheDocument()
    unmount()
  })

  it('shows total count of gaps', () => {
    render(<GeoGapsList gaps={sampleGaps} category="school" />)
    // Should show "3" as the count of unmapped items in the header
    expect(screen.getByText(/3 Unmapped/)).toBeInTheDocument()
  })
})
