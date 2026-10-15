/**
 * Decision 43 (#3207): the Geo views write counts with separators and one-decimal percentages.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

import { GeoSummaryCards } from './GeoSummaryCards'
import { GeoCategoryTabs } from './GeoCategoryTabs'
import { GeoDetailList } from './GeoDetailList'
import { GeoComparisonDetailList } from './GeoComparisonDetailList'

describe('GeoSummaryCards numbers', () => {
  it('separates the counts and writes the top share to one decimal', () => {
    render(
      <GeoSummaryCards
        cityCount={1293}
        schoolCount={12}
        synagogueCount={3}
        topLocation={{ name: 'Springfield', count: 400, percentage: 33.33, category: 'city' }}
      />
    )
    expect(screen.getByText('1,293')).toBeInTheDocument()
    expect(screen.getByText('33.3% of campers')).toBeInTheDocument()
  })
})

describe('GeoCategoryTabs numbers', () => {
  it('separates the tab counts', () => {
    render(
      <GeoCategoryTabs
        activeCategory="city"
        onCategoryChange={() => {}}
        counts={{ city: 1293, school: 2, synagogue: 3 }}
      />
    )
    expect(screen.getByText('1,293')).toBeInTheDocument()
  })
})

describe('GeoDetailList numbers', () => {
  it('separates a row count', () => {
    render(
      <GeoDetailList
        data={[{ name: 'Springfield, IL', count: 1293, percentage: 67.94 }]}
        category="city"
      />
    )
    fireEvent.click(screen.getByText('Cities'))
    const row = screen.getByText('Springfield, IL').closest('tr') as HTMLElement
    expect(within(row).getByText('1,293')).toBeInTheDocument()
    expect(within(row).getByText('67.9%')).toBeInTheDocument()
  })
})

describe('GeoComparisonDetailList numbers', () => {
  it('separates values and writes a drop with the true minus', () => {
    render(
      <GeoComparisonDetailList
        category="city"
        primaryData={[{ name: 'Springfield', count: 1000, percentage: 50 }]}
        compareData={[{ name: 'Springfield', count: 1250, percentage: 60 }]}
        primaryYear={2026}
        compareYear={2025}
      />
    )
    fireEvent.click(screen.getByText('Cities'))
    const row = screen.getByText('Springfield').closest('tr') as HTMLElement
    expect(
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent)
    ).toEqual(['Springfield', '1,000', '1,250', '−250'])
  })
})
