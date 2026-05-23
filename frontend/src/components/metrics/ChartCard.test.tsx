import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChartCard } from './ChartCard'

describe('ChartCard', () => {
  it('renders title', () => {
    render(
      <ChartCard title="Test Chart">
        <div>content</div>
      </ChartCard>
    )
    expect(screen.getByText('Test Chart')).toBeInTheDocument()
  })

  it('renders children', () => {
    render(
      <ChartCard title="Test">
        <div data-testid="child">chart</div>
      </ChartCard>
    )
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('renders empty state when isEmpty is true', () => {
    render(
      <ChartCard title="Empty" isEmpty>
        <div>chart</div>
      </ChartCard>
    )
    expect(screen.getByText('No data available')).toBeInTheDocument()
  })

  it('renders Y-axis ticks when yAxis is provided', () => {
    render(
      <ChartCard
        title="With Y-Axis"
        yAxis={{ ticks: [0, 50, 100], axisMax: 100, drawingHeight: 200, barsHeight: 220 }}
      >
        <div>chart</div>
      </ChartCard>
    )
    expect(screen.getByText('50')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
  })

  it('renders formatted Y-axis ticks', () => {
    render(
      <ChartCard
        title="Formatted"
        yAxis={{
          ticks: [0, 50, 100],
          axisMax: 100,
          drawingHeight: 200,
          barsHeight: 220,
          formatTick: (v) => `${v}%`,
        }}
      >
        <div>chart</div>
      </ChartCard>
    )
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('renders X-axis labels when provided', () => {
    render(
      <ChartCard
        title="With X-Axis"
        yAxis={{ ticks: [0, 100], axisMax: 100, drawingHeight: 200, barsHeight: 220 }}
        xLabels={['2022', '2023', '2024']}
      >
        <div>chart</div>
      </ChartCard>
    )
    expect(screen.getByText('2022')).toBeInTheDocument()
    expect(screen.getByText('2024')).toBeInTheDocument()
  })

  it('renders legend when provided', () => {
    render(
      <ChartCard
        title="With Legend"
        legend={[
          { label: 'Series A', color: 'blue' },
          { label: 'Series B', color: 'red' },
        ]}
      >
        <div>chart</div>
      </ChartCard>
    )
    expect(screen.getByText('Series A')).toBeInTheDocument()
    expect(screen.getByText('Series B')).toBeInTheDocument()
  })

  it('renders without Y-axis for pie chart layout', () => {
    const { container } = render(
      <ChartCard title="Pie Layout">
        <div data-testid="pie">pie chart</div>
      </ChartCard>
    )
    expect(container.querySelector('.border-l')).toBeNull()
    expect(screen.getByTestId('pie')).toBeInTheDocument()
  })

  it('uses card-lodge wrapper class', () => {
    const { container } = render(
      <ChartCard title="Card">
        <div>c</div>
      </ChartCard>
    )
    expect(container.querySelector('.card-lodge')).not.toBeNull()
  })

  it('renders headerRight content in the header', () => {
    render(
      <ChartCard title="Overall Retention Rate Trend" headerRight={<span>Camp → Teen</span>}>
        <div />
      </ChartCard>
    )
    expect(screen.getByText('Camp → Teen')).toBeInTheDocument()
  })
})
