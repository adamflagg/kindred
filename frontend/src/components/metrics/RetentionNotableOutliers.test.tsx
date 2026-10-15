import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OutlierSection } from './RetentionNotableOutliers'
import type { RetentionOutlier } from '../../utils/retentionTransforms'

const outliers = [
  {
    name: 'Springfield',
    retentionRate: 0.679,
    baseCount: 1293,
    returnedCount: 878,
    deviation: 12,
    impact: 155,
  },
  {
    name: 'Shelbyville',
    retentionRate: 0.421,
    baseCount: 40,
    returnedCount: 17,
    deviation: -14,
    impact: 5.6,
  },
] as RetentionOutlier[]

describe('OutlierSection number format', () => {
  it('writes each rate to one decimal and the counts with separators', () => {
    render(<OutlierSection outliers={outliers} max={5} />)
    expect(screen.getByText('67.9%')).toBeInTheDocument()
    expect(screen.getByText('42.1%')).toBeInTheDocument()
    expect(screen.getByText('878 of 1,293 returned')).toBeInTheDocument()
  })

  it('writes the deviation as a signed percentage with a true minus', () => {
    render(<OutlierSection outliers={outliers} max={5} />)
    expect(screen.getByText('+12.0%')).toBeInTheDocument()
    expect(screen.getByText('−14.0%')).toBeInTheDocument()
  })
})
