import { describe, expect, it } from 'vitest'

import type { BunkingRequest } from '../../types/lodging'
import {
  BUNKING_ANCHOR_CLASS,
  changeCaption,
  comingWithLabel,
  requestChanged,
  resolveBunkingRequestRuns,
  shortDate,
  wordDiff,
} from './bunkingRequest'
import { ANCHOR_CLASS } from './shareMarks'

const request = (overrides: Partial<BunkingRequest> = {}): BunkingRequest => ({
  state: 'request',
  current_text: 'Emma Johnson, Liam Garcia',
  submitted: ['2026-08-31 09:00:00'],
  coming_with: [],
  ...overrides,
})

describe('resolveBunkingRequestRuns', () => {
  it('draws the family anchor tones: solid, muted, dotted', () => {
    expect(BUNKING_ANCHOR_CLASS.request).toBe(ANCHOR_CLASS.yes)
    expect(BUNKING_ANCHOR_CLASS.none).toBe(ANCHOR_CLASS.no)
    expect(BUNKING_ANCHOR_CLASS.no_form).toBe(ANCHOR_CLASS.unanswered)
  })

  it('glows ONLY on a request', () => {
    expect(resolveBunkingRequestRuns(request())[0]?.hot).toBe(true)
    expect(resolveBunkingRequestRuns(request({ state: 'none', current_text: '' }))[0]?.hot).toBe(
      false
    )
    expect(resolveBunkingRequestRuns(request({ state: 'no_form', current_text: '' }))[0]?.hot).toBe(
      false
    )
  })

  it('puts the request in the anchor tooltip', () => {
    expect(resolveBunkingRequestRuns(request())[0]?.marks[0]?.tooltip).toBe(
      'Bunking request: Emma Johnson, Liam Garcia'
    )
  })

  it('dots the anchor when the request changed, never when re-filed identically', () => {
    const changed = request({
      changed: true,
      change: { kind: 'list', items: [], from_date: '2026-08-03', to_date: '2026-08-31' },
    })
    expect(resolveBunkingRequestRuns(changed)[0]?.dotTestId).toBe('bunking-request-changed-dot')
    const same = request({ changed: false, change: { kind: 'identical', count: 2 } })
    expect(resolveBunkingRequestRuns(same)[0]?.dotTestId).toBeUndefined()
  })

  it('reads the server `changed` flag, not the net change kind (D2/P15)', () => {
    // Moved and moved back (A -> A+B -> A): the net markup is all keep, but
    // the request DID change across filings.
    const movedBack = request({
      changed: true,
      change: {
        kind: 'list',
        items: [{ text: 'Emma Johnson', op: 'keep' }],
        from_date: '2026-08-03',
        to_date: '2026-08-31',
      },
    })
    expect(requestChanged(movedBack)).toBe(true)
    expect(resolveBunkingRequestRuns(movedBack)[0]?.dotTestId).toBe('bunking-request-changed-dot')
    // A net `list` change with `changed` false (never on the wire, but the
    // flag is the one authority) draws no dot.
    expect(requestChanged(request({ changed: false, change: { kind: 'list', items: [] } }))).toBe(
      false
    )
    expect(requestChanged(request())).toBe(false)
  })

  it('names the number of submissions in a changed tooltip', () => {
    const changed = request({
      changed: true,
      versions: [
        { submitted_at: '2026-08-03 09:00:00', text: 'Emma Johnson' },
        { submitted_at: '2026-08-31 09:00:00', text: 'Emma Johnson, Liam Garcia' },
      ],
    })
    expect(resolveBunkingRequestRuns(changed)[0]?.marks[0]?.tooltip).toBe(
      'Bunking request: Emma Johnson, Liam Garcia · Changed across 2 submissions'
    )
  })

  it('draws coming-with as its own never-hot capsule, one circle per tick, in order', () => {
    const runs = resolveBunkingRequestRuns(request({ coming_with: ['family', 'friends'] }))
    expect(runs.map((r) => r.key)).toEqual(['bunking-anchor', 'coming-with'])
    expect(runs[1]?.hot).toBe(false)
    expect(runs[1]?.marks.map((m) => m.key)).toEqual(['family', 'friends'])
    expect(runs[1]?.marks[0]?.tooltip).toBe('Coming with family')
  })

  it('draws no coming-with run when nothing was ticked', () => {
    expect(resolveBunkingRequestRuns(request()).map((r) => r.key)).toEqual(['bunking-anchor'])
  })
})

describe('labels and dates', () => {
  it('shortDate reads Jotform stamps without a timezone slip', () => {
    expect(shortDate('2026-08-31 23:59:59')).toBe('Aug 31')
    expect(shortDate('')).toBe('')
  })

  it('comingWithLabel joins every tick', () => {
    expect(comingWithLabel(['family', 'friends'])).toBe('Coming with family + with friends')
  })

  it('changeCaption names the span or the identical count', () => {
    expect(
      changeCaption(
        request({
          change: {
            kind: 'list',
            from_date: '2026-08-31 09:00:00',
            to_date: '2026-09-16 10:00:00',
          },
        })
      )
    ).toBe('Changed · Aug 31 → Sep 16')
    expect(changeCaption(request({ change: { kind: 'identical', count: 3 } }))).toBe(
      'Filed 3 times · identical'
    )
    expect(changeCaption(request())).toBe('')
  })
})

describe('wordDiff', () => {
  it('marks added and dropped words, case-insensitively', () => {
    expect(wordDiff('Emma Johnson please', 'emma Johnson and Liam')).toEqual([
      { op: 'same', text: 'emma' },
      { op: 'same', text: 'Johnson' },
      { op: 'del', text: 'please' },
      { op: 'add', text: 'and' },
      { op: 'add', text: 'Liam' },
    ])
  })
})
