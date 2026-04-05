import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TrendLineChart } from './TrendLineChart'
import type { YearMetrics } from '../../types/metrics'

let capturedStrokeLinecaps: string[] = []

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: ({ strokeLinecap }: { strokeLinecap?: string }) => {
    if (strokeLinecap) capturedStrokeLinecaps.push(strokeLinecap)
    return <div data-testid="line" />
  },
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  LabelList: () => null,
}))

const sampleData: YearMetrics[] = [
  {
    year: 2024,
    total_enrolled: 100,
    by_gender: [
      { gender: 'M', count: 50, percentage: 50 },
      { gender: 'F', count: 50, percentage: 50 },
    ],
    new_vs_returning: {
      new_count: 40,
      returning_count: 60,
      new_percentage: 40,
      returning_percentage: 60,
    },
    total_cancelled: 5,
    cancellation_rate: 5.0,
  },
  {
    year: 2025,
    total_enrolled: 120,
    by_gender: [
      { gender: 'M', count: 60, percentage: 50 },
      { gender: 'F', count: 60, percentage: 50 },
    ],
    new_vs_returning: {
      new_count: 50,
      returning_count: 70,
      new_percentage: 41.7,
      returning_percentage: 58.3,
    },
    total_cancelled: 8,
    cancellation_rate: 6.7,
  },
]

describe('TrendLineChart', () => {
  it('renders the title', () => {
    render(<TrendLineChart data={sampleData} title="Enrollment Trends" metric="total" />)
    expect(screen.getByText('Enrollment Trends')).toBeInTheDocument()
  })

  describe('animation', () => {
    it('passes strokeLinecap="round" to Line for total metric', () => {
      capturedStrokeLinecaps = []
      render(<TrendLineChart data={sampleData} title="Test" metric="total" />)
      expect(capturedStrokeLinecaps.length).toBeGreaterThan(0)
      expect(capturedStrokeLinecaps.every((v) => v === 'round')).toBe(true)
    })

    it('passes strokeLinecap="round" to Line for gender metric', () => {
      capturedStrokeLinecaps = []
      render(<TrendLineChart data={sampleData} title="Test" metric="gender" />)
      expect(capturedStrokeLinecaps.length).toBeGreaterThan(0)
      expect(capturedStrokeLinecaps.every((v) => v === 'round')).toBe(true)
    })
  })
})
