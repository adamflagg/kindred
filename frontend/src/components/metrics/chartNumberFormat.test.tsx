/**
 * Decision 43 (#3207): every number a chart draws is a count with separators or a
 * one-decimal percentage, and a negative is a true minus.
 */
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

import { CssHorizontalBarChart } from './CssHorizontalBarChart'
import { CssStackedHorizontalBarChart } from './CssStackedHorizontalBarChart'
import { CssVerticalBarChart } from './CssVerticalBarChart'
import { CssVerticalStackedBarChart } from './CssVerticalStackedBarChart'
import { CssVerticalGroupedBarChart } from './CssVerticalGroupedBarChart'

const text = (c: HTMLElement) => c.textContent

describe('CssHorizontalBarChart numbers', () => {
  const data = [{ name: 'Alpha', value: 1293, percentage: 67.94 }]

  it('separates the value label and the axis ticks', () => {
    const { container } = render(<CssHorizontalBarChart data={data} />)
    const spans = Array.from(container.querySelectorAll<HTMLElement>('.tabular-nums')).map((e) =>
      e.textContent.trim()
    )
    expect(spans).toContain('1,293')
    expect(spans.some((t) => /^\d,\d{3}$/.test(t) && t !== '1,293')).toBe(true)
  })

  it('writes the tooltip count and percentage in the shared format', () => {
    const { container } = render(<CssHorizontalBarChart data={data} />)
    const row = container.querySelector('.rounded.flex') as HTMLElement
    fireEvent.mouseEnter(row)
    fireEvent.mouseMove(row, { clientX: 10, clientY: 10 })
    expect(text(container)).toContain('Count: 1,293')
    expect(text(container)).toContain('67.9%')
  })
})

describe('CssStackedHorizontalBarChart numbers', () => {
  const segments = [
    { key: 'enrolled', label: 'Enrolled', color: '#4CAF50' },
    { key: 'waitlisted', label: 'Waitlisted', color: '#FFC107' },
  ]
  const data = [{ name: 'Session A', total: 1293, enrolled: 1000, waitlisted: 293 }]

  it('separates the row total and writes tooltip shares to one decimal', () => {
    const { container } = render(<CssStackedHorizontalBarChart data={data} segments={segments} />)
    expect(text(container)).toContain('1,293')
    const row = container.querySelector('.rounded.flex') as HTMLElement
    fireEvent.mouseEnter(row)
    fireEvent.mouseMove(row, { clientX: 10, clientY: 10 })
    expect(text(container)).toContain('1,000 (77.3%)')
    expect(text(container)).toContain('293 (22.7%)')
    expect(text(container)).toContain('Total: 1,293')
  })
})

describe('CssVerticalBarChart numbers', () => {
  it('separates the default bar label and the axis ticks', () => {
    const { container } = render(<CssVerticalBarChart data={[{ name: 'Alpha', value: 2400 }]} />)
    expect(text(container)).toContain('2,400')
    expect(text(container)).not.toMatch(/(^|[^,\d])2400/)
  })
})

describe('CssVerticalStackedBarChart numbers', () => {
  const segments = [
    { key: 'female_count', label: 'Female', color: 'red' },
    { key: 'male_count', label: 'Male', color: 'blue' },
  ]
  const data = [{ name: 'Grade 3', total: 1293, male_count: 1000, female_count: 293 }]

  it('separates the total label and writes tooltip shares to one decimal', () => {
    const { container } = render(<CssVerticalStackedBarChart data={data} segments={segments} />)
    expect(text(container)).toContain('1,293')
    const bars = container.querySelector('.border-l') as HTMLElement
    const column = bars.querySelector(':scope > div:not([class*="absolute"])') as HTMLElement
    fireEvent.mouseEnter(column)
    fireEvent.mouseMove(column, { clientX: 10, clientY: 10 })
    expect(text(container)).toContain('1,000 (77.3%)')
    expect(text(container)).toContain('293 (22.7%)')
    expect(text(container)).toContain('Total: 1,293')
  })
})

describe('CssVerticalGroupedBarChart numbers', () => {
  const series = [
    { key: 'a', label: 'This year', color: 'red' },
    { key: 'b', label: 'Last year', color: 'blue' },
  ]
  const data = [{ name: 'Session A', a: 1293, b: 12 }]

  it('separates tooltip values and axis ticks', () => {
    const { container } = render(<CssVerticalGroupedBarChart data={data} series={series} />)
    const bars = container.querySelector('.border-l') as HTMLElement
    const column = bars.querySelector(':scope > .items-center') as HTMLElement
    fireEvent.mouseEnter(column)
    fireEvent.mouseMove(column, { clientX: 10, clientY: 10 })
    expect(text(container)).toContain('This year: 1,293')
  })
})
