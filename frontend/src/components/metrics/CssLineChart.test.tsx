import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CssLineChart } from './CssLineChart'

const SAMPLE_DATA = [
  { year: '2022', total: 180, newCampers: 60, returning: 120 },
  { year: '2023', total: 200, newCampers: 70, returning: 130 },
  { year: '2024', total: 220, newCampers: 75, returning: 145 },
  { year: '2025', total: 210, newCampers: 65, returning: 145 },
]

describe('CssLineChart', () => {
  it('renders title', () => {
    render(
      <CssLineChart
        data={SAMPLE_DATA}
        xKey="year"
        lines={[{ key: 'total', label: 'Total', color: 'green' }]}
        title="Enrollment Trend"
      />
    )
    expect(screen.getByText('Enrollment Trend')).toBeInTheDocument()
  })

  it('renders empty state when data is empty', () => {
    render(
      <CssLineChart
        data={[]}
        xKey="year"
        lines={[{ key: 'total', label: 'Total', color: 'green' }]}
        title="Empty Chart"
      />
    )
    expect(screen.getByText('No data available')).toBeInTheDocument()
  })

  it('renders an SVG with path elements for each line', () => {
    const { container } = render(
      <CssLineChart
        data={SAMPLE_DATA}
        xKey="year"
        lines={[
          { key: 'total', label: 'Total', color: 'green' },
          { key: 'newCampers', label: 'New', color: 'blue' },
        ]}
        title="Multi-Line"
      />
    )
    const paths = container.querySelectorAll('svg path[data-line]')
    expect(paths).toHaveLength(2)
  })

  it('renders dots for each data point per line', () => {
    const { container } = render(
      <CssLineChart
        data={SAMPLE_DATA}
        xKey="year"
        lines={[{ key: 'total', label: 'Total', color: 'green' }]}
        title="Dots"
      />
    )
    const dots = container.querySelectorAll('svg circle[data-dot]')
    expect(dots).toHaveLength(4)
  })

  it('renders x-axis labels from xKey', () => {
    render(
      <CssLineChart
        data={SAMPLE_DATA}
        xKey="year"
        lines={[{ key: 'total', label: 'Total', color: 'green' }]}
        title="Axis Labels"
      />
    )
    expect(screen.getByText('2022')).toBeInTheDocument()
    expect(screen.getByText('2025')).toBeInTheDocument()
  })

  it('renders reference lines when provided', () => {
    const { container } = render(
      <CssLineChart
        data={SAMPLE_DATA}
        xKey="year"
        lines={[{ key: 'total', label: 'Total', color: 'green' }]}
        referenceLines={[{ y: 200 }]}
        title="Ref Line"
      />
    )
    const refLines = container.querySelectorAll('svg line[data-reference]')
    expect(refLines).toHaveLength(1)
  })

  it('renders legend when multiple lines', () => {
    render(
      <CssLineChart
        data={SAMPLE_DATA}
        xKey="year"
        lines={[
          { key: 'total', label: 'Total', color: 'green' },
          { key: 'newCampers', label: 'New Campers', color: 'blue' },
        ]}
        title="Legend"
      />
    )
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(screen.getByText('New Campers')).toBeInTheDocument()
  })

  it('calls onDotClick when a dot is clicked', () => {
    const handleClick = vi.fn()
    const { container } = render(
      <CssLineChart
        data={SAMPLE_DATA}
        xKey="year"
        lines={[{ key: 'total', label: 'Total', color: 'green' }]}
        onDotClick={handleClick}
        title="Click"
      />
    )
    const dots = container.querySelectorAll('svg circle[data-dot]')
    dots[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(handleClick).toHaveBeenCalledWith(SAMPLE_DATA[0])
  })

  it('renders value labels on dots when formatValue is provided', () => {
    const { container } = render(
      <CssLineChart
        data={SAMPLE_DATA}
        xKey="year"
        lines={[{ key: 'total', label: 'Total', color: 'green' }]}
        formatValue={(v: number) => `${v}`}
        title="Labels"
      />
    )
    const labels = container.querySelectorAll('svg text[data-value-label]')
    expect(labels).toHaveLength(4)
  })
})
