/**
 * Decision 16 (2026-10-14): the waitlist change reads in neutral grey, not green. A longer
 * waitlist is not good news, and a shorter one is not bad news. RegistrationOverview has no
 * render test (its data hooks are many), so this pins the one prop at the source.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

function metricCardBlock(file: string, title: string): string {
  const src = readFileSync(resolve(__dirname, file), 'utf8')
  const at = src.indexOf(`title="${title}"`)
  expect(at, `${file} has a "${title}" MetricCard`).toBeGreaterThan(-1)
  const start = src.lastIndexOf('<MetricCard', at)
  const end = src.indexOf('/>', at)
  return src.slice(start, end)
}

describe('Total Waitlisted delta is grey', () => {
  it('on Registration › Overview', () => {
    expect(metricCardBlock('RegistrationOverview.tsx', 'Total Waitlisted')).toContain(
      'sentiment="muted"'
    )
  })

  // Owner Q5 (recommended, pending): the same number on the Waitlist page reads the same colour.
  // To flip: drop this case and the prop in WaitlistAnalysis.tsx.
  it('on Registration › Waitlist', () => {
    expect(metricCardBlock('WaitlistAnalysis.tsx', 'Total Waitlisted')).toContain(
      'sentiment="muted"'
    )
  })
})
