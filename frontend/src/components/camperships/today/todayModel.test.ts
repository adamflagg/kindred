import { describe, expect, it } from 'vitest'

import type { ApiAidTodayLine } from '../../../types/api-types'
import {
  countWords,
  detailWords,
  isTodayKey,
  LINE_NAMES,
  openHref,
  reasonWords,
  todaySections,
} from './todayModel'

const VIEW = { year: 2027, asOf: { kind: 'live' } as const }

function line(over: Partial<ApiAidTodayLine> & Pick<ApiAidTodayLine, 'key'>): ApiAidTodayLine {
  return {
    families: 0,
    items: 0,
    item_kind: 'requests',
    reasons: [],
    amount: null,
    oldest_days: null,
    over_14_days: null,
    largest_gap: null,
    request_ids: [],
    ...over,
  }
}

describe('Today’s words (§6.4; D24; Decision 30)', () => {
  it('names every line the server sends', () => {
    // The server's TodayKey has 16 keys (equity_field_never_true arrived with #2950).
    expect(Object.keys(LINE_NAMES)).toHaveLength(16)
    expect(LINE_NAMES.cancel_reason).toBe('Cancelled: give a reason')
    expect(LINE_NAMES.equity_field_never_true).toBe('Equity question never answered yes')
    expect(isTodayKey('would_change')).toBe(true)
    expect(isTodayKey('equity_field_never_true')).toBe(true)
    expect(isTodayKey('bogus')).toBe(false)
  })

  it('counts families and requests, grants, sections, descriptions or fields', () => {
    expect(countWords(line({ key: 'holds', families: 5, items: 7 }))).toBe('5 fam · 7 req')
    expect(countWords(line({ key: 'grants', items: 1, item_kind: 'grants', families: 1 }))).toBe(
      '1 grant'
    )
    expect(
      countWords(line({ key: 'rules_sections', items: 2, item_kind: 'sections', families: null }))
    ).toBe('2 sections')
    expect(
      countWords(line({ key: 'sources', items: 3, item_kind: 'descriptions', families: null }))
    ).toBe('3 descriptions')
    expect(
      countWords(
        line({ key: 'equity_field_never_true', items: 1, item_kind: 'fields', families: null })
      )
    ).toBe('1 field')
    expect(
      countWords(
        line({ key: 'equity_field_never_true', items: 2, item_kind: 'fields', families: null })
      )
    ).toBe('2 fields')
  })

  it('breaks the reasons down inline, in the words the grid uses', () => {
    const holds = line({
      key: 'holds',
      reasons: [
        { code: 'payer_shares_incomplete', families: 2, items: 2 },
        { code: 'placeholder_income', families: 1, items: 1 },
      ],
    })
    expect(reasonWords(holds)).toBe('Payer shares 2 · Placeholder income 1')
    expect(
      reasonWords(
        line({
          key: 'needs_offer',
          reasons: [
            { code: 'r1', families: 4, items: 4 },
            { code: 'r2', families: 2, items: 2 },
          ],
        })
      )
    ).toBe('R1 4 · R2 2')
    expect(
      reasonWords(
        line({ key: 'rules_sections', reasons: [{ code: 'budget', families: null, items: 1 }] })
      )
    ).toBe('budget 1')
    // The grid's own word for an intake hold, not a second spelling.
    expect(
      reasonWords(
        line({
          key: 'intake',
          reasons: [{ code: 'awaiting_approved_rules', families: 2, items: 2 }],
        })
      )
    ).toBe('Awaiting rules 2')
    // Grant reasons the server sends.
    expect(
      reasonWords(
        line({
          key: 'grants',
          item_kind: 'grants',
          reasons: [
            { code: 'needs_camper', families: 1, items: 1 },
            { code: 'camper_cancelled', families: 1, items: 1 },
          ],
        })
      )
    ).toBe('needs a camper 1 · camper cancelled 1')
  })

  it('shows the equity fields as the server sent them, never re-worded', () => {
    const equity = line({
      key: 'equity_field_never_true',
      items: 2,
      item_kind: 'fields',
      families: null,
      reasons: [
        { code: 'home_is_rented', families: null, items: 1 },
        { code: 'single_parent', families: null, items: 1 },
      ],
    })
    expect(reasonWords(equity)).toBe('home_is_rented 1 · single_parent 1')
    expect(detailWords(equity)).toBe('home_is_rented 1 · single_parent 1')
  })

  it("adds each line's own facts: oldest and over 14 days, the largest gap, the amount awaiting finance", () => {
    expect(detailWords(line({ key: 'waiting_on_family', oldest_days: 23, over_14_days: 6 }))).toBe(
      'oldest 23 days · 6 over 14 days'
    )
    expect(
      detailWords(
        line({
          key: 'not_reconciled',
          reasons: [{ code: 'not_in_campminder', families: 1, items: 1 }],
          largest_gap: 1800,
        })
      )
    ).toBe('not in CampMinder 1 · largest $1,800')
    expect(detailWords(line({ key: 'pending_approval', amount: 0 }))).toBe('$0 awaiting finance')
    expect(detailWords(line({ key: 'late_full_coverage', items: 1 }))).toBe('contact the family')
    // Owner ruling S1 Q1: the posted amounts stand; the line is information only.
    expect(detailWords(line({ key: 'would_change', items: 3 }))).toBe(
      'information only · posted amounts stand'
    )
  })

  it("opens a queue's Requests view, a listed line's own rows, and the other surfaces; nothing at zero", () => {
    expect(openHref(line({ key: 'holds', items: 7 }), VIEW)).toBe(
      '/aid/requests?view=holds&year=2027'
    )
    expect(openHref(line({ key: 'would_change', items: 3 }), VIEW)).toBe(
      '/aid/requests?view=all&today=would_change&year=2027'
    )
    expect(openHref(line({ key: 'grants', items: 2 }), VIEW)).toBe(
      '/aid/grants/needs-attention?year=2027'
    )
    expect(openHref(line({ key: 'rules_sections', items: 1 }), VIEW)).toBe(
      '/aid/season/rules?year=2027'
    )
    expect(openHref(line({ key: 'sources', items: 1 }), VIEW)).toBe('/aid/money/sources?year=2027')
    expect(openHref(line({ key: 'holds', items: 0 }), VIEW)).toBeNull()
    // No view lists the equity fields: no Open ›.
    expect(
      openHref(line({ key: 'equity_field_never_true', items: 2, item_kind: 'fields' }), VIEW)
    ).toBeNull()
  })

  it('opens every Requests-view queue the server counts', () => {
    for (const [key, slug] of [
      ['needs_offer', 'needs-offer'],
      ['waiting_on_family', 'waiting'],
      ['not_reconciled', 'not-reconciled'],
      ['to_reverse', 'to-reverse'],
      ['session_not_settled', 'session-not-settled'],
      ['duplicates', 'duplicates'],
      ['cancel_reason', 'cancel-reason'],
      ['pending_approval', 'pending-approval'],
    ] as const) {
      expect(openHref(line({ key, items: 1 }), VIEW)).toBe(`/aid/requests?view=${slug}&year=2027`)
    }
  })

  it('shows the sections the server sent: casework, finance, or both', () => {
    const casework = [line({ key: 'holds' })]
    expect(todaySections({ year: 2027, casework, finance: null }).map((s) => s.title)).toEqual([
      'Casework',
    ])
    expect(
      todaySections({ year: 2027, casework, finance: [line({ key: 'sources' })] }).map(
        (s) => s.title
      )
    ).toEqual(['Casework', 'Finance'])
    expect(todaySections({ year: 2027, casework: null, finance: null })).toEqual([])
  })
})
