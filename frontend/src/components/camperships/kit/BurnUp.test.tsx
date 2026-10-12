import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AidBurnUp } from './BurnUp'

describe('AidBurnUp', () => {
  it('draws the posted line, the dashed budget line and the committed step', () => {
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

  it("starts the committed step at the line's last point, tops it with a dot and labels the dot (audit N2)", () => {
    const { container } = render(
      <AidBurnUp
        budget={1111125}
        committed={983995}
        points={[
          { week_of: '2026-01-05', posted: 0 },
          { week_of: '2026-03-09', posted: 843380 },
        ]}
      />
    )
    const num = (el: Element | null, attr: string) => Number(el?.getAttribute(attr))
    const step = container.querySelector('line[data-line="committed"]')
    const posted = container.querySelector('circle[data-dot="posted"]')
    const top = container.querySelector('circle[data-dot="committed"]')
    // No float: the step stands on the posted dot, whatever today is.
    expect(num(step, 'x1')).toBe(num(posted, 'cx'))
    expect(num(step, 'x2')).toBe(num(posted, 'cx'))
    expect(num(step, 'y1')).toBe(num(posted, 'cy'))
    // Its top carries an amber dot of its own, at the committed total.
    expect(num(top, 'cx')).toBe(num(posted, 'cx'))
    expect(num(top, 'cy')).toBe(num(step, 'y2'))
    expect(num(top, 'r')).toBe(3)
    expect(top?.getAttribute('fill')).toBe('var(--color-amber-600)')
    // The label reads beside the dot it names, its first line level with it.
    const label = container.querySelector('text[data-label="committed"]')
    expect(num(label, 'y')).toBeCloseTo(num(top, 'cy') + 3.5, 1)
    // The posted label sits below the committed label, so the two never overlap.
    const postedLabel = container.querySelector('text[data-label="posted"]')
    expect(num(postedLabel, 'y')).toBeGreaterThanOrEqual(num(label, 'y') + 12 + 12)
  })

  it('keeps both labels above the axis when the line runs along the bottom (audit N2)', () => {
    const { container } = render(
      <AidBurnUp
        budget={1200000}
        committed={215000}
        points={[
          { week_of: '2026-01-05', posted: 0 },
          { week_of: '2026-03-09', posted: 100000 },
        ]}
      />
    )
    const zero = Number(
      [...container.querySelectorAll('line')]
        .find((l) => l.nextElementSibling?.textContent === '$0')
        ?.getAttribute('y1')
    )
    const postedLabel = container.querySelector('text[data-label="posted"]')
    expect(Number(postedLabel?.getAttribute('y'))).toBeLessThan(zero)
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
