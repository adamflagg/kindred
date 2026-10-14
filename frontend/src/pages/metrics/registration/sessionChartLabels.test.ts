/**
 * The by-session charts on Cancellations and Waitlist (PR 4, board 6, owner 2026-10-14): bars are
 * labelled with the shared sessionName() SHORT form, not CampMinder's raw names. Cancellations'
 * label column widens to about 150px; Waitlist keeps 140. No two-line labels, no tooltip. And a
 * long scope (All Summer) grows the Cancellations chart so no row is clipped (board 6 finding).
 */
import { describe, it, expect } from 'vitest'
import { sessionName } from '../../../utils/sessionName'
import { calculateBarSizing } from '../../../components/metrics/cssChartUtils'
import {
  CANCEL_SESSION_LABEL_WIDTH,
  cancelSessionChartHeight,
  transformCancelSessionData,
} from './CancellationAnalysis'
import { transformWaitlistSessionData } from './WaitlistAnalysis'

const AG_RAW = 'All-Gender Session 2 (7th & 8th grades)'
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

  it('widens the label column to about 150px', () => {
    expect(CANCEL_SESSION_LABEL_WIDTH).toBe(150)
  })

  it('grows so every row of a long scope fits (no row clipped)', () => {
    expect(cancelSessionChartHeight(6)).toBe(300)
    for (let n = 1; n <= 40; n++) {
      const h = cancelSessionChartHeight(n)
      const { barHeight, rowGap, axisArea } = calculateBarSizing(h, n)
      // A row is never shorter than its 20px label, whatever the bar height.
      const rows = n * Math.max(barHeight, 20) + (n - 1) * rowGap
      expect(rows, `${n} rows in ${h}px`).toBeLessThanOrEqual(h - axisArea)
    }
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
})
