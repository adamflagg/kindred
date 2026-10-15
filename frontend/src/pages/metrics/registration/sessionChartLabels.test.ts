/**
 * The by-session charts on Cancellations and Waitlist (PR 4, board 6, owner 2026-10-14): bars are
 * labelled with the shared sessionName() SHORT form, not CampMinder's raw names, and no label is
 * cut. No two-line labels, no tooltip. The ruling's "about 150px" was the means; 150 still cut
 * the longest real quest/teen names, so every by-session chart shares one width that fits them.
 * And a long scope (All Summer) grows the chart so no row is clipped (board 6 finding).
 */
import { describe, it, expect } from 'vitest'
import { sessionName } from '../../../utils/sessionName'
import { SESSION_LABEL_WIDTH, calculateBarSizing } from '../../../components/metrics/cssChartUtils'
import { cancelSessionChartHeight, transformCancelSessionData } from './CancellationAnalysis'
import { transformWaitlistSessionData, waitlistSessionChartHeight } from './WaitlistAnalysis'

/** Every row of an n-row chart fits in the height chosen for it, for n = 1..40. */
function expectEveryRowFits(heightFor: (rows: number) => number) {
  for (let n = 1; n <= 40; n++) {
    const h = heightFor(n)
    const { barHeight, rowGap, axisArea } = calculateBarSizing(h, n)
    // A row is never shorter than its 20px label, whatever the bar height.
    const rows = n * Math.max(barHeight, 20) + (n - 1) * rowGap
    expect(rows, `${n} rows in ${h}px`).toBeLessThanOrEqual(h - axisArea)
  }
}

const AG_RAW = 'All-Gender Session 2 (7th & 8th grades)'

/**
 * The longest session labels these charts show across 2019-2026 and every view (At Camp, All
 * Summer, Quests, Teens), with the width each renders at in the label's own style (text-sm,
 * DM Sans), measured in Chromium on 2026-10-14. Each entry is [raw name, session type, px].
 */
const LONGEST_REAL_LABELS: Array<[string, string, number]> = [
  ['Women of the Wild Quest', 'quest', 163],
  ['Northwest Canada Quest', 'quest', 160],
  ['Teen Leadership Institute', 'tli', 159],
  ['A Taste of Camp 2021', 'main', 137],
  ['TLI: Camp to Portland', 'tli', 136],
  ['Counselor In-Training', 'scit', 135],
  ['Specialist In-Training', 'scit', 131],
  ['All-Gender Cabin-Session 3 (9th & 10th grades)', 'ag', 73],
]

/** Room for subpixel rounding and the metric-matched fallback font. */
const HEADROOM_PX = 8

describe('session label width (no label is cut)', () => {
  it.each(LONGEST_REAL_LABELS)('fits %s whole', (raw, type, px) => {
    // The short form never cuts a name itself, so the column has to fit it whole.
    expect(sessionName(raw, type, 'short')).not.toMatch(/(\.\.\.|…)$/)
    expect(SESSION_LABEL_WIDTH).toBeGreaterThanOrEqual(px + HEADROOM_PX)
  })

  it('the short form of the longest real names is the full name (nothing to measure but it)', () => {
    expect(sessionName('Teen Leadership Institute', 'tli', 'short')).toBe(
      'Teen Leadership Institute'
    )
    expect(sessionName('Northwest Canada Quest', 'quest', 'short')).toBe('Northwest Canada Quest')
    expect(sessionName('Women of the Wild Quest', 'quest', 'short')).toBe('Women of the Wild Quest')
    expect(sessionName('All-Gender Cabin-Session 3 (9th & 10th grades)', 'ag', 'short')).toBe(
      'AG 3 (9-10)'
    )
  })

  it('stays a column, not most of the card', () => {
    expect(SESSION_LABEL_WIDTH).toBeLessThanOrEqual(192)
  })
})
const types = { 'Session 1': 'main', [AG_RAW]: 'ag' }
const dates = { 'Session 1': '2026-06-15', [AG_RAW]: '2026-07-01' }

const cancelRow = (session_cm_id: number, session_name: string) => ({
  session_cm_id,
  session_name,
  total_cancelled: 3,
  was_enrolled: 2,
  was_waitlisted: 1,
  was_applied: 0,
  other_prior_status: 0,
})

describe('Cancellations by Session', () => {
  it('labels each bar with the short session name', () => {
    const { data, sorted } = transformCancelSessionData(
      [cancelRow(1, 'Session 1'), cancelRow(2, AG_RAW)] as never,
      dates,
      types
    )
    const ag = data[sorted.findIndex((s) => s.session_name === AG_RAW)]
    expect(ag?.name).toBe(sessionName(AG_RAW, 'ag', 'short'))
    expect(ag?.name).not.toBe(AG_RAW)
  })

  it('keeps the sorted rows in step with the bars, so a click opens the right session', () => {
    const { data, sorted } = transformCancelSessionData(
      [cancelRow(2, AG_RAW), cancelRow(1, 'Session 1')] as never,
      dates,
      types
    )
    expect(data).toHaveLength(sorted.length)
    data.forEach((d, i) => {
      expect(d.name).toBe(
        sessionName(
          sorted[i]?.session_name ?? '',
          types[sorted[i]?.session_name as keyof typeof types],
          'short'
        )
      )
    })
  })

  it('grows so every row of a long scope fits (no row clipped)', () => {
    expect(cancelSessionChartHeight(6)).toBe(300)
    expectEveryRowFits(cancelSessionChartHeight)
  })
})

describe('Waitlist by Session', () => {
  it('labels bars and the enrolled-in segments with short session names', () => {
    const { data, segments } = transformWaitlistSessionData(
      [
        {
          session_cm_id: 2,
          session_name: AG_RAW,
          no_enrollment: 1,
          has_enrollment: 1,
          enrolled_in: [{ session_cm_id: 1, session_name: AG_RAW, count: 1 }],
        },
      ] as never,
      dates,
      types
    )
    expect(data[0]?.name).toBe(sessionName(AG_RAW, 'ag', 'short'))
    expect(segments.find((s) => s.key === 'session_1')?.label).toBe(
      sessionName(AG_RAW, 'ag', 'short')
    )
  })

  it('keeps its 340px for a short scope and grows so every row of a long one fits', () => {
    expect(waitlistSessionChartHeight(6)).toBe(340)
    expectEveryRowFits(waitlistSessionChartHeight)
  })
})
