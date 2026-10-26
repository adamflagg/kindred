/**
 * Trends' retention line (#3207 PR 11, ruling #89): labelled by the year campers returned into;
 * while registration is live a dashed line holds each year at the same day of its own
 * registration, ending at the live year, which is not drawn on the solid finals line.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RetentionRateLine } from './RetentionRateLine'
import { retentionLineData } from './retentionLineData'
import type { RetentionTrendYear } from '../../types/metrics'

const t = (from: number, rate: number, samePoint: number | null = null): RetentionTrendYear => ({
  from_year: from,
  to_year: from + 1,
  retention_rate: rate,
  base_count: 1000,
  returned_count: Math.round(rate * 1000),
  by_gender: [],
  by_grade: [],
  same_point_rate: samePoint,
})

const LIVE = [t(2023, 0.697, 0.619), t(2024, 0.706, 0.627), t(2025, 0.655, 0.655)]

describe('retentionLineData', () => {
  it('labels each point by the year campers returned into', () => {
    const rows = retentionLineData([t(2024, 0.706), t(2025, 0.712)], false)
    expect(rows.map((r) => r.name)).toEqual(['2025', '2026'])
    expect(rows.map((r) => r.samePoint)).toEqual([null, null])
  })

  it('while live, keeps the live year off the finals line and puts every year on the dashed one', () => {
    const rows = retentionLineData(LIVE, true)
    expect(rows.map((r) => r.name)).toEqual(['2024', '2025', '2026 so far'])
    expect(rows.at(-1)!.retentionRate).toBeNull()
    expect(rows.map((r) => r.samePoint)).toEqual(
      [61.9, 62.7, 65.5].map((v) => expect.closeTo(v, 5))
    )
  })
})

describe('RetentionRateLine legend and note', () => {
  it('names both lines and numbers the dashed one while live', () => {
    const { container } = render(
      <RetentionRateLine
        data={LIVE}
        samePoint={{ asOf: '2025-10-16', noteN: 6, throughNextDay: false }}
      />
    )
    expect(screen.getByText('Final, end of each season')).toBeInTheDocument()
    expect(container).toHaveTextContent('dashed: each year at Oct 16 of its own registration6')
    expect(
      screen.getByText(/Each year as it stood at Oct 16 of its own registration/)
    ).toBeInTheDocument()
  })

  it('has no dashed line once registration is over', () => {
    render(<RetentionRateLine data={[t(2024, 0.706), t(2025, 0.712)]} />)
    expect(screen.queryByText(/dashed/)).not.toBeInTheDocument()
  })
})

describe('retentionLineData — a year with no rate (PM-4 A)', () => {
  it('leaves it off the line: a gap, never a dip to 0', () => {
    const rows = retentionLineData(
      [
        t(2019, 0.65),
        { ...t(2020, 0), retention_rate: null },
        { ...t(2021, 0), retention_rate: null },
      ],
      false
    )
    expect(rows.map((r) => r.retentionRate)).toEqual([65, null, null])
  })
})
