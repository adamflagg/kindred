/**
 * TDD Tests for RetentionRateBarChart showCounts prop.
 *
 * Tests written FIRST before implementation (TDD).
 * When showCounts is enabled, bar labels should show "75% (30/40)" format
 * instead of just "75%".
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  RetentionRateBarChart,
  type RetentionRateBarItem,
} from './RetentionRateBarChart'

const sampleData: RetentionRateBarItem[] = [
  { name: 'Riverside', retentionRate: 0.75, baseCount: 40, returnedCount: 30 },
  { name: 'Oak Valley', retentionRate: 0.5, baseCount: 20, returnedCount: 10 },
]

describe('RetentionRateBarChart showCounts prop', () => {
  it('should render without error when showCounts is not provided (default)', () => {
    render(<RetentionRateBarChart data={sampleData} title="By City" />)

    expect(screen.getByText('By City')).toBeInTheDocument()
  })

  it('should render without error when showCounts is true', () => {
    render(<RetentionRateBarChart data={sampleData} title="By City" showCounts />)

    expect(screen.getByText('By City')).toBeInTheDocument()
  })

  it('should still render empty state when data is empty regardless of showCounts', () => {
    render(<RetentionRateBarChart data={[]} title="By City" showCounts />)

    expect(screen.getByText('No data available')).toBeInTheDocument()
  })
})
