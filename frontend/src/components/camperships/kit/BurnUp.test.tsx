import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AidBurnUp } from './BurnUp'

describe('AidBurnUp', () => {
  it('draws the posted line, the dashed budget line and the committed step at today', () => {
    const { container } = render(
      <AidBurnUp
        budget={1111125}
        committed={983995}
        points={[
          { week_of: '2031-01-06', posted: 0 },
          { week_of: '2031-03-10', posted: 843380 },
        ]}
      />
    )
    expect(container.querySelector('path[data-line="posted"]')).not.toBeNull()
    expect(container.querySelector('line[data-line="budget"]')).not.toBeNull()
    expect(container.querySelector('line[data-line="committed"]')).not.toBeNull()
    expect(screen.getByText('$843k posted')).toBeInTheDocument()
    // One compact formatter (kit/money formatMoneyCompact): thousands round toward zero, as the hero's figures do.
    // Ruling V6: a season total, so it says what it is.
    expect(container.querySelector('text[data-label="committed"]')?.textContent).toBe(
      '$983k committed once waiting is offered'
    )
    // Millions on the budget label and the axis only (formatMoneyScale, controller ruling).
    expect(screen.getByText('Budget $1.11M')).toBeInTheDocument()
  })

  it('labels money as the hero does, rounding toward zero ($116,600 is "$116k", never "$117k")', () => {
    render(
      <AidBurnUp
        budget={null}
        committed={null}
        points={[{ week_of: '2031-01-06', posted: 116600 }]}
      />
    )
    expect(screen.getByText('$116k posted')).toBeInTheDocument()
  })

  it('labels an axis tick past a million in millions', () => {
    render(
      <AidBurnUp
        budget={2400000}
        committed={null}
        points={[{ week_of: '2031-01-06', posted: 1000 }]}
      />
    )
    // Ruling V5: round ticks. 2,400,000 / 3 rounds up to a $1M step, so the axis tops out at $3M.
    expect(screen.getByText('$1M')).toBeInTheDocument()
    expect(screen.getByText('$3M')).toBeInTheDocument()
  })

  it('keeps the budget on the scale with round ticks, the top one labelled (ruling V5)', () => {
    const { container } = render(
      <AidBurnUp
        budget={1111000}
        committed={215243}
        points={[
          { week_of: '2031-08-17', posted: 20000 },
          { week_of: '2031-10-05', posted: 116266 },
        ]}
      />
    )
    const ticks = [...container.querySelectorAll('text[data-tick]')].map((t) => t.textContent)
    expect(ticks).toEqual(['$0', '$400k', '$800k', '$1.2M'])
    expect(container.querySelector('line[data-line="budget"]')).not.toBeNull()
  })

  it('draws the posted line heavier, in forest, with its labels in bold ink (audit F16)', () => {
    const { container } = render(
      <AidBurnUp
        budget={1111000}
        committed={215243}
        points={[
          { week_of: '2031-08-17', posted: 20000 },
          { week_of: '2031-10-05', posted: 116266 },
        ]}
      />
    )
    const line = container.querySelector('path[data-line="posted"]')!
    expect(line.getAttribute('stroke-width')).toBe('2.5')
    expect(line.getAttribute('stroke')).toContain('forest-700')
    expect(screen.getByText('$116k posted').getAttribute('font-weight')).toBe('700')
    expect(screen.getByText('Budget $1.11M').getAttribute('font-weight')).toBe('700')
  })

  it('carries no ARIA role: the chart is not a test handle (frontend/CLAUDE.md)', () => {
    const { container } = render(
      <AidBurnUp
        budget={null}
        committed={null}
        points={[{ week_of: '2031-01-06', posted: 5000 }]}
      />
    )
    expect(container.querySelector('svg')?.getAttribute('role')).toBeNull()
  })

  it('draws no budget line without an allocation, and nothing for an empty season', () => {
    const { container } = render(<AidBurnUp budget={null} committed={null} points={[]} />)
    expect(container.textContent).toContain('Nothing posted yet')
    expect(container.querySelector('line[data-line="budget"]')).toBeNull()
  })

  it('draws a posted line but no budget line when the season has no allocation', () => {
    const { container } = render(
      <AidBurnUp
        budget={null}
        committed={null}
        points={[{ week_of: '2031-01-06', posted: 5000 }]}
      />
    )
    expect(container.querySelector('path[data-line="posted"]')).not.toBeNull()
    expect(container.querySelector('line[data-line="budget"]')).toBeNull()
  })

  it('draws no budget line, and no "Budget $0" label, when the budget is 0', () => {
    const { container } = render(
      <AidBurnUp budget={0} committed={null} points={[{ week_of: '2031-01-06', posted: 5000 }]} />
    )
    expect(container.querySelector('line[data-line="budget"]')).toBeNull()
    expect(screen.queryByText(/Budget/)).toBeNull()
  })

  it("labels the first point's month too, and drops it when the next month is too close to fit", () => {
    const early = render(
      <AidBurnUp
        budget={null}
        committed={null}
        points={[{ week_of: '2031-01-06', posted: 5000 }]}
      />
    )
    expect(early.getByText('Jan')).toBeInTheDocument()
    expect(early.getByText('Feb')).toBeInTheDocument()
    early.unmount()
    render(
      <AidBurnUp
        budget={null}
        committed={null}
        points={[{ week_of: '2031-01-29', posted: 5000 }]}
      />
    )
    expect(screen.queryByText('Jan')).toBeNull()
    expect(screen.getByText('Feb')).toBeInTheDocument()
  })
})
