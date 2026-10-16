/**
 * MetricCard's change ink is the app-wide delta tokens (#3207 PR 8, rulings #16 and #17): forest for
 * good news, the kit red for bad, grey for neither. Colour only: the figure and arrow are unchanged.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetricCard } from './MetricCard'
import { DELTA_INK } from '../../utils/deltaTokens'

function changeInk(): string {
  return screen.getByText(/vs 2026/).className
}

describe('MetricCard change ink', () => {
  it('a rise is forest by default', () => {
    render(<MetricCard title="Total Enrolled" value={120} compareValue={100} compareYear={2026} />)
    expect(changeInk()).toContain(DELTA_INK.good)
    expect(screen.getByText(/vs 2026/)).toHaveTextContent('+20 vs 2026')
  })

  it('a fall is the kit red by default', () => {
    render(<MetricCard title="Total Enrolled" value={80} compareValue={100} compareYear={2026} />)
    expect(changeInk()).toContain(DELTA_INK.bad)
  })

  it('inverse: a rise is red (Total Cancelled)', () => {
    render(
      <MetricCard
        title="Total Cancelled"
        value={12}
        compareValue={10}
        compareYear={2026}
        sentiment="inverse"
      />
    )
    expect(changeInk()).toContain(DELTA_INK.bad)
  })

  it('inverse: a fall is forest', () => {
    render(
      <MetricCard
        title="Total Cancelled"
        value={8}
        compareValue={10}
        compareYear={2026}
        sentiment="inverse"
      />
    )
    expect(changeInk()).toContain(DELTA_INK.good)
  })

  it('neutral (New Campers) is grey either way, no longer blue (ruling #17)', () => {
    render(
      <MetricCard
        title="New Campers"
        value={120}
        compareValue={100}
        compareYear={2026}
        sentiment="neutral"
      />
    )
    expect(changeInk()).toContain(DELTA_INK.neutral)
    expect(changeInk()).not.toContain('blue')
  })

  it('muted (the waitlist) is grey either way', () => {
    render(
      <MetricCard
        title="Total Waitlisted"
        value={80}
        compareValue={100}
        compareYear={2026}
        sentiment="muted"
      />
    )
    expect(changeInk()).toContain(DELTA_INK.neutral)
  })
})
