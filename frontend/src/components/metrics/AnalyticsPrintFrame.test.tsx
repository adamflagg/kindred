import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AnalyticsPrintFrame } from './AnalyticsPrintFrame'
import { formatPrintStamp } from './printStamp'

describe('formatPrintStamp (#68)', () => {
  it('reads as "Thu Oct 15, 2026, 4:12 PM" in camp time', () => {
    expect(formatPrintStamp(new Date('2026-10-15T23:12:00Z'))).toBe('Thu Oct 15, 2026, 4:12 PM')
  })
})

describe('AnalyticsPrintFrame', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark')
  })

  it('carries the page path, season, scope and print date in a header line for paper', () => {
    render(
      <AnalyticsPrintFrame
        path="Analytics › Registration › Overview"
        season={2026}
        scope="Summer only: all sessions"
      >
        <p>content</p>
      </AnalyticsPrintFrame>
    )
    const head = document.querySelector('[data-print-head]')!
    expect(head).toHaveTextContent('Analytics › Registration › Overview')
    expect(head).toHaveTextContent('Season 2026')
    expect(head).toHaveTextContent('Summer only: all sessions')
    expect(head).toHaveTextContent(/Printed /)
    expect(screen.getByText('content')).toBeInTheDocument()
    expect(document.querySelector('[data-print-analytics]')).not.toBeNull()
  })

  it('prints in the light colours whatever the screen theme, and puts the theme back after', () => {
    document.documentElement.classList.add('dark')
    render(
      <AnalyticsPrintFrame path="p" season={2026} scope="s">
        <p>x</p>
      </AnalyticsPrintFrame>
    )
    window.dispatchEvent(new Event('beforeprint'))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    window.dispatchEvent(new Event('afterprint'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})

describe('Analytics print CSS (#68)', () => {
  it('keeps the app chrome off the paper with its own rule, beside print-alone', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf-8').replace(/\s+/g, ' ')
    expect(css).toContain(
      '@media print { body:has([data-print-analytics]) [data-app-chrome] { display: none !important; }'
    )
    expect(css).toContain(
      '@media print { body:has([data-print-alone]) [data-app-chrome] { display: none !important; } }'
    )
  })
})
