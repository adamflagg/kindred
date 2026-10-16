/**
 * The change figure on Retention's breakdowns (#3207 PR 11, rulings #86, #91): one cell, one header
 * and one legend for every chart and table that compares with last year.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RetentionChange, RetentionCompareHeader, RetentionCompareLegend } from './RetentionChange'
import { describeRowChange, retentionCompareView } from '../../utils/retentionCompare'
import type { RetentionBasis } from '../../utils/retentionCompare'

const liveBasis: RetentionBasis = {
  live: true,
  label: 'vs same point last year',
  text: '',
  notes: [{ n: 1, text: '' }],
  pending: false,
}
const finalBasis: RetentionBasis = {
  live: false,
  label: "vs last year's final",
  text: '',
  notes: [{ n: 1, text: '' }],
  pending: false,
}
const live = retentionCompareView(liveBasis, 2026)
const final = retentionCompareView(finalBasis, 2026)

describe('retentionCompareView', () => {
  it('names both series while live and after', () => {
    expect(live).toMatchObject({
      live: true,
      noteN: 1,
      nowLegend: '2026 so far',
      priorLegend: '2025 at this registration day',
    })
    expect(final).toMatchObject({ live: false, nowLegend: '2026 final', priorLegend: '2025 final' })
  })
})

describe('RetentionChange', () => {
  it('reads a change in points with its arrow, in the delta ink', () => {
    render(<RetentionChange rate={0.672} priorRate={0.65} baseCount={612} compare={live} />)
    const cell = screen.getByText('▲ +2.2 pts')
    expect(cell.className).toMatch(/text-forest-700/)
  })

  it('a fall reads red with the true minus', () => {
    render(<RetentionChange rate={0.584} priorRate={0.602} baseCount={166} compare={live} />)
    expect(screen.getByText('▼ −1.8 pts').className).toMatch(/text-red-700/)
  })

  it('shows a small row muted, never hidden (#91)', () => {
    render(<RetentionChange rate={0.556} priorRate={0.495} baseCount={18} compare={live} />)
    const cell = screen.getByText('+6.1 pts')
    expect(cell.className).toMatch(/text-muted-foreground/)
    expect(screen.queryByText(/too few/)).not.toBeInTheDocument()
  })

  it('adds the count only where the row shows its base nowhere', () => {
    render(
      <RetentionChange rate={0.556} priorRate={0.495} baseCount={18} compare={live} showCount />
    )
    expect(screen.getByText('+6.1 pts · 18 campers')).toBeInTheDocument()
  })

  it('drops the unit on a narrow chart face', () => {
    const { rerender } = render(
      <RetentionChange rate={0.672} priorRate={0.65} baseCount={612} compare={live} compact />
    )
    expect(screen.getByText('▲ +2.2')).toBeInTheDocument()
    rerender(
      <RetentionChange
        rate={0.556}
        priorRate={0.495}
        baseCount={18}
        compare={live}
        compact
        showCount
      />
    )
    expect(screen.getByText('+6.1 · 18')).toBeInTheDocument()
  })

  it('reads a dash for a row last year did not have', () => {
    render(<RetentionChange rate={0.6} priorRate={null} baseCount={40} compare={live} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('waits a day on the priority date (ruling 9)', () => {
    render(
      <RetentionChange
        rate={0.6}
        priorRate={0.5}
        baseCount={40}
        compare={{ ...live, pending: true }}
      />
    )
    expect(screen.getByText('updates tomorrow')).toBeInTheDocument()
  })
})

describe('describeRowChange (the tooltip words)', () => {
  it('says what the change is against', () => {
    expect(describeRowChange(0.556, 0.495, live)).toBe('+6.1 pts vs 2025 at this registration day')
    expect(describeRowChange(0.556, 0.495, final)).toBe('+6.1 pts vs 2025 final')
    expect(describeRowChange(0.556, null, final)).toBe('2025 had no such row')
  })
})

describe('header and legend', () => {
  it('heads the change with its basis and note mark', () => {
    const { container } = render(<RetentionCompareHeader compare={live} />)
    expect(container).toHaveTextContent('Change vs same point last year1')
  })

  it("after registration heads it vs last year's final", () => {
    const { container } = render(<RetentionCompareHeader compare={final} />)
    expect(container).toHaveTextContent("Change vs last year's final1")
  })

  it('names both series', () => {
    render(<RetentionCompareLegend compare={live} />)
    expect(screen.getByText('2026 so far')).toBeInTheDocument()
    expect(screen.getByText('2025 at this registration day')).toBeInTheDocument()
  })
})
