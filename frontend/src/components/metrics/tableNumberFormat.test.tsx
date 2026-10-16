/**
 * Decision 43 (#3207): tables and tooltips write counts with separators, percentages to one
 * decimal and every negative with the true minus sign.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import { ComparisonSummaryTable } from './ComparisonSummaryTable'
import { ComparisonTable } from './ComparisonTable'
import { SessionDetailsTable } from './SessionDetailsTable'
import { SessionBunkHeatmap } from './SessionBunkHeatmap'
import { BunkCellTooltip } from './BunkStaffTooltip'
import type { SessionBreakdown } from '../../types/metrics'

const rowCells = (name: string) =>
  within(screen.getByText(name).closest('tr') as HTMLElement)
    .getAllByRole('cell')
    .map((c) => c.textContent)

describe('ComparisonSummaryTable numbers', () => {
  it('separates both values and writes a rise with its percentage', () => {
    render(
      <ComparisonSummaryTable
        title="Gender"
        primaryYear={2026}
        compareYear={2025}
        primaryData={[{ name: 'Girls', value: 1293 }]}
        compareData={[{ name: 'Girls', value: 1200 }]}
      />
    )
    expect(rowCells('Girls')).toEqual(['Girls', '1,293', '1,200', '+93(+7.8%)'])
  })

  it('writes a fall with the true minus on the count and the percentage', () => {
    render(
      <ComparisonSummaryTable
        title="Gender"
        primaryYear={2026}
        compareYear={2025}
        primaryData={[{ name: 'Boys', value: 1000 }]}
        compareData={[{ name: 'Boys', value: 1250 }]}
      />
    )
    expect(rowCells('Boys')).toEqual(['Boys', '1,000', '1,250', '−250(−20.0%)'])
  })
})

describe('ComparisonTable numbers', () => {
  it('separates values and writes the change with a true minus', () => {
    render(
      <ComparisonTable
        title="Years"
        yearALabel="2026"
        yearBLabel="2025"
        rows={[{ label: 'Total', yearA: 1000, yearB: 1250, change: -250, changePercent: -20 }]}
      />
    )
    expect(rowCells('Total')).toEqual(['Total', '1,000', '1,250', '−250 (−20.0%)'])
  })
})

function sb(name: string, count: number, capacity: number): SessionBreakdown {
  return {
    session_cm_id: 0,
    session_name: name,
    count,
    capacity,
    utilization: (count / capacity) * 100,
  }
}

describe('SessionDetailsTable numbers', () => {
  it('separates counts and writes a negative delta with the true minus', () => {
    render(
      <SessionDetailsTable
        current={[sb('Session A', 1000, 1500)]}
        prior={[sb('Session A', 1250, 1500)]}
        isComparing
        currentYear={2026}
        compareYear={2025}
      />
    )
    expect(rowCells('Session A')).toEqual(['Session A', '1,000', '1,500', '66.7%', '1,250', '−250'])
  })
})

describe('SessionBunkHeatmap numbers', () => {
  it('writes each cell rate to one decimal', () => {
    render(
      <SessionBunkHeatmap
        data={[
          {
            session: 'Session 1',
            bunk: 'B-1',
            base_count: 1293,
            returned_count: 878,
            retention_rate: 0.679,
          },
        ]}
      />
    )
    expect(screen.getByText('67.9%')).toBeInTheDocument()
  })
})

describe('BunkCellTooltip numbers', () => {
  it('separates the counts and writes the rate to one decimal', () => {
    render(
      <BunkCellTooltip
        bunkName="B-1"
        retention={{ returnedCount: 878, baseCount: 1293, rate: 0.679 }}
        isVisible
        position={{ x: 10, y: 10 }}
      />
    )
    expect(screen.getByText('878 of 1,293 returned (67.9%)')).toBeInTheDocument()
  })
})
