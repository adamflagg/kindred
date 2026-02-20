/**
 * Tests for ComparisonBarChart component.
 *
 * TDD: Tests written first to define expected rendering behavior.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ComparisonBarChart } from './ComparisonBarChart'

// Mock Recharts to avoid canvas/SVG issues in tests
vi.mock('recharts', () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Legend: () => null,
  LabelList: () => null,
}))

describe('ComparisonBarChart', () => {
  const primaryData = [
    { name: 'Grade 5', value: 10 },
    { name: 'Grade 6', value: 20 },
  ]

  const comparisonData = [
    { name: 'Grade 5', value: 8 },
    { name: 'Grade 6', value: 25 },
  ]

  it('renders the title', () => {
    render(
      <ComparisonBarChart
        title="Enrollment by Grade"
        primaryData={primaryData}
        comparisonData={comparisonData}
        primaryYear={2025}
        compareYear={2024}
      />
    )

    expect(screen.getByText('Enrollment by Grade')).toBeInTheDocument()
  })

  it('renders the bar chart container', () => {
    render(
      <ComparisonBarChart
        title="Test Chart"
        primaryData={primaryData}
        comparisonData={comparisonData}
        primaryYear={2025}
        compareYear={2024}
      />
    )

    expect(screen.getByTestId('bar-chart')).toBeInTheDocument()
  })

  it('renders no data message when primary data is empty', () => {
    render(
      <ComparisonBarChart
        title="Empty Chart"
        primaryData={[]}
        comparisonData={[]}
        primaryYear={2025}
        compareYear={2024}
      />
    )

    expect(screen.getByText(/no data/i)).toBeInTheDocument()
  })

  it('renders year labels in legend area', () => {
    render(
      <ComparisonBarChart
        title="Chart"
        primaryData={primaryData}
        comparisonData={comparisonData}
        primaryYear={2025}
        compareYear={2024}
      />
    )

    // Year labels should be visible as part of the chart legend/header
    expect(screen.getByText('2025')).toBeInTheDocument()
    expect(screen.getByText('2024')).toBeInTheDocument()
  })
})
