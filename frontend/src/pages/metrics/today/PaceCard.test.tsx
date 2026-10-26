/**
 * PaceCard — Today's Pace chart (#3207 PR 8). Scan findings (ti:P-35, MR-PAR-09 findings 1-2): the axis
 * must cover every value it draws, the stored (3 a.m.) count included, and the "N today" label sits by
 * the live dot when the live point is drawn.
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PaceCard } from './PaceCard'
import type { LivePoint } from '../../../components/velocity/velocityLive'
import type { VelocityResponse } from '../../../types/velocity'

function velocity(stored: number, priorFinal: number): VelocityResponse {
  return {
    year: 2027,
    season_start: '2026-11-11',
    combined: {
      year: 2027,
      weekly: [],
      daily: [
        { date: '2026-11-11', day_offset: 0, gross_enrolled: 200, enrolled: 200, cancelled: 0 },
        {
          date: '2027-02-09',
          day_offset: 90,
          gross_enrolled: stored,
          enrolled: stored,
          cancelled: 0,
        },
      ],
    },
    by_session: [],
    prior_years: [
      {
        year: 2026,
        daily: [
          { date: '2025-11-12', day_offset: 0, gross_enrolled: 100, enrolled: 100, cancelled: 0 },
          {
            date: '2026-08-01',
            day_offset: 262,
            gross_enrolled: priorFinal,
            enrolled: priorFinal,
            cancelled: 0,
          },
        ],
        weekly: [],
      },
    ],
    phase_markers: [],
    current_day_offset: 90,
    prior_day_offset: 90,
    today_day_offset: 90,
  } as unknown as VelocityResponse
}

function live(stored: number, enrolled: number): LivePoint {
  return {
    enrolled,
    stored,
    added: enrolled - stored,
    storedDay: 90,
    x: 90.4,
    at: '2027-02-09T22:05:00Z',
    storedDate: null,
  }
}

const num = (el: Element, attr: string) => Number(el.getAttribute(attr))

/** The y-axis tick labels (right-aligned at the plot's left edge), as numbers. */
function axisTicks(container: HTMLElement): number[] {
  return [...container.querySelectorAll('svg text[text-anchor="end"]')]
    .filter((t) => /^[\d,]+$/.test(t.textContent))
    .map((t) => Number(t.textContent.replace(/,/g, '')))
}

describe('PaceCard axis', () => {
  // Enrollment fell after 3 a.m.: the live count is far below the stored one. The axis used to be sized
  // from the live count and last year's final only, so the stored point and the line were clipped at the top.
  it('covers the stored count when the live count fell below it', () => {
    const { container } = render(
      <PaceCard data={velocity(951, 280)} year={2027} fold={null} live={live(951, 300)} />
    )
    expect(Math.max(...axisTicks(container))).toBeGreaterThanOrEqual(951)
  })

  it('covers the stored count with no live point drawn', () => {
    const { container } = render(
      <PaceCard data={velocity(951, 280)} year={2027} fold={null} live={null} />
    )
    expect(Math.max(...axisTicks(container))).toBeGreaterThanOrEqual(951)
  })
})

describe('PaceCard label', () => {
  // It keeps the same place beside the point it reads: the stored dot without a live point, the live dot with one.
  it('sits by the live dot when the live point is drawn', () => {
    const plain = render(
      <PaceCard data={velocity(951, 2900)} year={2027} fold={null} live={null} />
    )
    const storedOnly = plain.container.querySelector('svg circle.fill-forest-700')!
    const offset = num(plain.getByText('951 today'), 'y') - num(storedOnly, 'cy')
    plain.unmount()

    const { container, getByText } = render(
      <PaceCard data={velocity(951, 2900)} year={2027} fold={null} live={live(951, 2800)} />
    )
    const liveDot = container.querySelector('[data-live-dot="live"]')!
    expect(num(getByText('2,800 today'), 'y') - num(liveDot, 'cy')).toBeCloseTo(offset, 1)
  })
})

// ub:PR#3283:5 / OD-48: after a missed nightly, with no live point drawn, "N today" would pass a days-old
// count off as today's. It names the stored date instead; the normal wording is unchanged.
describe('PaceCard after a missed nightly', () => {
  it('names the stored date beside the count when the live point is hidden', () => {
    const { getByText, queryByText } = render(
      <PaceCard
        data={velocity(951, 1211)}
        year={2027}
        fold={null}
        live={null}
        storedDate="2027-02-09"
      />
    )
    expect(getByText('951 · Feb 9, 3 a.m. count')).toBeInTheDocument()
    expect(queryByText('951 today')).toBeNull()
  })

  it('keeps "N today" when the stored count is fresh', () => {
    const { getByText } = render(
      <PaceCard data={velocity(951, 1211)} year={2027} fold={null} live={null} storedDate={null} />
    )
    expect(getByText('951 today')).toBeInTheDocument()
  })
})
