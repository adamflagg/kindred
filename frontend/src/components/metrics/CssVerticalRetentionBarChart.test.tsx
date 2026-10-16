import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
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
