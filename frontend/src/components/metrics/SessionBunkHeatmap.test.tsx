/**
 * TDD tests for SessionBunkHeatmap component.
 *
 * Tests written FIRST before implementation.
 * The heatmap groups bunks by session, color-codes by retention rate,
 * and shows a tooltip with detailed counts on hover.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SessionBunkHeatmap } from './SessionBunkHeatmap'
import type { RetentionBySessionBunk } from '../../types/metrics'

const sampleData: RetentionBySessionBunk[] = [
  { session: 'Session 1', bunk: 'B-1', base_count: 10, returned_count: 8, retention_rate: 0.8 },
  { session: 'Session 1', bunk: 'B-2', base_count: 12, returned_count: 3, retention_rate: 0.25 },
  { session: 'Session 1', bunk: 'G-1', base_count: 10, returned_count: 5, retention_rate: 0.5 },
  { session: 'Session 2', bunk: 'B-3', base_count: 8, returned_count: 6, retention_rate: 0.75 },
  { session: 'Session 2', bunk: 'G-2', base_count: 9, returned_count: 1, retention_rate: 0.111 },
]

describe('SessionBunkHeatmap', () => {
  it('renders session group headings', () => {
    render(<SessionBunkHeatmap data={sampleData} />)

    expect(screen.getByText('Session 1')).toBeInTheDocument()
    expect(screen.getByText('Session 2')).toBeInTheDocument()
  })

  it('renders bunk names within cells', () => {
    render(<SessionBunkHeatmap data={sampleData} />)

    expect(screen.getByText('B-1')).toBeInTheDocument()
    expect(screen.getByText('B-2')).toBeInTheDocument()
    expect(screen.getByText('G-1')).toBeInTheDocument()
    expect(screen.getByText('B-3')).toBeInTheDocument()
    expect(screen.getByText('G-2')).toBeInTheDocument()
  })

  it('renders retention percentages in cells', () => {
    render(<SessionBunkHeatmap data={sampleData} />)

    // 80% for B-1 (0.8 * 100)
    expect(screen.getByText('80%')).toBeInTheDocument()
    // 25% for B-2
    expect(screen.getByText('25%')).toBeInTheDocument()
    // 50% for G-1
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('renders tooltip text with counts', () => {
    render(<SessionBunkHeatmap data={sampleData} />)

    // Tooltip shows "X of Y returned (Z%)"
    expect(screen.getByText('8 of 10 returned (80%)')).toBeInTheDocument()
    expect(screen.getByText('3 of 12 returned (25%)')).toBeInTheDocument()
  })

  it('sorts bunks naturally within each session group', () => {
    const data: RetentionBySessionBunk[] = [
      { session: 'Session 1', bunk: 'B-10', base_count: 5, returned_count: 3, retention_rate: 0.6 },
      { session: 'Session 1', bunk: 'B-2', base_count: 5, returned_count: 3, retention_rate: 0.6 },
      { session: 'Session 1', bunk: 'B-1', base_count: 5, returned_count: 3, retention_rate: 0.6 },
    ]
    render(<SessionBunkHeatmap data={data} />)

    const bunkNames = screen.getAllByTestId('heatmap-cell').map((el) => el.textContent)
    // Natural sort: B-1, B-2, B-10 (not B-1, B-10, B-2)
    expect(bunkNames![0]).toContain('B-1')
    expect(bunkNames![1]).toContain('B-2')
    expect(bunkNames![2]).toContain('B-10')
  })

  it('renders nothing when data is empty', () => {
    const { container } = render(<SessionBunkHeatmap data={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a legend', () => {
    render(<SessionBunkHeatmap data={sampleData} />)

    expect(screen.getByText(/high/i)).toBeInTheDocument()
    expect(screen.getByText(/low/i)).toBeInTheDocument()
  })
})
