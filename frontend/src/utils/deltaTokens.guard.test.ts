/**
 * Ruling #16 (a), owner 2026-10-15: the shared good/bad/neutral tokens (`utils/deltaTokens.ts`) reach every
 * Analytics change figure. Overview's emerald (and Velocity's green) migrate to forest, New Campers' blue to
 * grey (#17), and a waitlist change is grey either way (decision 16).
 *
 * Source-level, like index.css.guard.test.ts: the old class is on the DOM node or not, and no render test of
 * a private helper can see every page. Status colours that are not changes (a fill %, a utilization band, a
 * count, an icon) are out of scope and stay.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf-8')

const OLD_NEUTRAL_BLUE = 'text-blue-600 dark:text-blue-400'

/** Files whose every emerald, green and blue text ink was a change figure. */
const ALL_CHANGE_FIGURES = [
  'components/metrics/MetricCard.tsx',
  'components/metrics/ComparisonTable.tsx',
  'components/metrics/ComparisonSummaryTable.tsx',
  'components/metrics/geo/GeoComparisonDetailList.tsx',
  'components/metrics/RetentionNotableOutliers.tsx',
  'pages/metrics/trends/VelocityPage.tsx',
  'pages/metrics/trends/CancellationVelocityPage.tsx',
]

describe('Analytics change figures use the shared delta tokens', () => {
  it.each(ALL_CHANGE_FIGURES)('%s has no emerald, green or blue change ink', (path) => {
    const src = read(path)
    expect(src).not.toMatch(/text-(emerald|green)-\d{3}/)
    expect(src).not.toContain(OLD_NEUTRAL_BLUE)
    expect(src).toMatch(/deltaTokens'/)
  })

  it('Session Details colours its vs-last-year change with the tokens', () => {
    const src = read('components/metrics/SessionDetailsTable.tsx')
    expect(src).not.toContain("if (delta && delta > 0) return 'text-emerald-600")
    expect(src).toMatch(/deltaInk\(/)
  })

  it('Forecast colours its changes with the tokens (its % of goal is a status, not a change, and stays)', () => {
    const src = read('pages/metrics/registration/ForecastPage.tsx')
    expect(src).not.toContain("return value > 0 ? 'text-emerald-600")
    expect(src).toMatch(/deltaInk\(/)
  })

  it('Waitlist colours its per-session change grey either way (decision 16)', () => {
    const src = read('pages/metrics/registration/WaitlistAnalysis.tsx')
    expect(src).not.toContain("delta && delta > 0 ? 'text-emerald-600")
    expect(src).toMatch(/deltaInk\(delta \?\? 0, 'neutral'\)/)
  })

  it('Cancellations colours its per-session change red when it rises', () => {
    const src = read('pages/metrics/registration/CancellationAnalysis.tsx')
    expect(src).not.toContain("delta && delta < 0 ? 'text-emerald-600")
    expect(src).toMatch(/deltaInk\(delta \?\? 0, 'up-bad'\)/)
  })

  it("Retention's trend words use the tokens", () => {
    const src = read('utils/metricsTransforms.ts')
    expect(src).not.toContain("colorClass: 'text-emerald-500'")
    expect(src).toMatch(/DELTA_INK\.good/)
  })

  it('Day 1 draws its change in forest on the card gradient', () => {
    const src = read('pages/metrics/registration/Day1Page.tsx')
    expect(src).not.toContain("diff > 0 ? 'text-emerald-300'")
  })
})
