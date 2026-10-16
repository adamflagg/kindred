import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CssVerticalRetentionBarChart } from './CssVerticalRetentionBarChart'
import type { RetentionRateBarItem } from '../../types/metrics'

const data: RetentionRateBarItem[] = [
  { name: 'Session A', retentionRate: 0.679, baseCount: 1293, returnedCount: 878 },
]

describe('CssVerticalRetentionBarChart number format', () => {
  it('labels a bar with the rate to one decimal', () => {
    const { container } = render(<CssVerticalRetentionBarChart data={data} title="By session" />)
    expect(container).toHaveTextContent('67.9%')
    expect(container).not.toHaveTextContent('68%')
  })

  it('labels a bar with the rate to one decimal and separated counts when counts are shown', () => {
    const { container } = render(
      <CssVerticalRetentionBarChart data={data} title="By session" showCounts />
    )
    expect(container).toHaveTextContent('67.9% (878/1,293)')
  })
})

describe('CssVerticalRetentionBarChart shortenLabel (P-20 option B)', () => {
  const schools: RetentionRateBarItem[] = [
    { name: 'Harbor School', retentionRate: 0.61, baseCount: 22, returnedCount: 13 },
    { name: 'Riverbend Community School', retentionRate: 0.58, baseCount: 31, returnedCount: 18 },
  ]
  const shorten = (n: string) => n.replace(/\s+School$/, '').replace(/\bCommunity\b/, 'Comm.')

  it('writes the shortened names on the axis', () => {
    render(<CssVerticalRetentionBarChart data={schools} title="By school" shortenLabel={shorten} />)
    expect(screen.getByText('Harbor')).toBeInTheDocument()
    expect(screen.getByText('Riverbend Comm.')).toBeInTheDocument()
    expect(screen.queryByText('Harbor School')).not.toBeInTheDocument()
  })

  it('keeps the full names when two would shorten to the same label', () => {
    const twins: RetentionRateBarItem[] = [
      { name: 'Harbor School', retentionRate: 0.61, baseCount: 22, returnedCount: 13 },
      { name: 'Harbor', retentionRate: 0.5, baseCount: 20, returnedCount: 10 },
    ]
    render(<CssVerticalRetentionBarChart data={twins} title="By school" shortenLabel={shorten} />)
    expect(screen.getByText('Harbor School')).toBeInTheDocument()
    expect(screen.getByText('Harbor')).toBeInTheDocument()
  })

  it('names the full name in the tooltip', () => {
    const { container } = render(
      <CssVerticalRetentionBarChart data={schools} title="By school" shortenLabel={shorten} />
    )
    const barsArea = container.querySelector('.border-l') as HTMLElement
    const column = barsArea.querySelector(':scope > [style*="max-width"]') as HTMLElement
    fireEvent.mouseEnter(column)
    fireEvent.mouseMove(column, { clientX: 10, clientY: 10 })
    expect(screen.getByText('Harbor School')).toBeInTheDocument()
  })

  it('hands the click the full item, so the drill-down filters on the full name', () => {
    const onClick = vi.fn()
    const { container } = render(
      <CssVerticalRetentionBarChart
        data={schools}
        title="By school"
        shortenLabel={shorten}
        onBarClick={onClick}
      />
    )
    fireEvent.click(container.querySelectorAll<HTMLElement>('.cursor-pointer')[1]!)
    expect(onClick).toHaveBeenCalledWith(schools[1])
  })

  it('shortens only the bars it shows, after topN', () => {
    const many: RetentionRateBarItem[] = [
      { name: 'Harbor School', retentionRate: 0.61, baseCount: 22, returnedCount: 13 },
      { name: 'Harbor', retentionRate: 0.5, baseCount: 1, returnedCount: 1 },
    ]
    render(
      <CssVerticalRetentionBarChart
        data={many}
        title="By school"
        topN={1}
        sortBy="count"
        shortenLabel={shorten}
      />
    )
    // The tiny "Harbor" is cut by topN, so nothing on the chart collides.
    expect(screen.getByText('Harbor')).toBeInTheDocument()
    expect(screen.queryByText('Harbor School')).not.toBeInTheDocument()
  })
})
