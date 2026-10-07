import { describe, expect, it } from 'vitest'

import type { ApiAidPromotionPreview } from '../../../../types/api-types'
import { allConfirmed, lockedWords, standingAcks, warningWords } from './promotionModel'

const PREVIEW: ApiAidPromotionPreview = {
  code: 'A1',
  origin_version: 3,
  base_version: 4,
  sections: [
    {
      section: 'award_tables',
      changes: [
        { path: ['general', 'tiers', '2', 'r1_pct'], kind: 'changed', before: '55', after: '58' },
      ],
      warning: {
        kind: 'unapproved_edit',
        by: 'Test User',
        at: '2027-01-21T17:00:00Z',
        via: 'B2',
        token: 'tok-1',
      },
    },
    {
      section: 'awards',
      changes: [{ path: ['minimum'], kind: 'changed', before: '100', after: '150' }],
      warning: null,
    },
  ],
  unchanged: ['income'],
}

describe('making a kept option the rules draft (D39; Decision 21)', () => {
  it('names whose unapproved change it replaces, and a later approval it undoes', () => {
    expect(warningWords(PREVIEW.sections[0]!)).toBe(
      'Replaces an unapproved change in the rules draft (Test User, Jan 21, 2027, from B2).'
    )
    expect(warningWords(PREVIEW.sections[1]!)).toBeNull()
    expect(
      warningWords({
        ...PREVIEW.sections[0]!,
        warning: { kind: 'changed_since', by: 'Test User', at: null, via: null, token: 't' },
      })
    ).toBe("Undoes a change approved since this option's starting point (Test User).")
  })

  it("counts a tick only while its token is the preview's own", () => {
    expect(standingAcks(PREVIEW, new Map([['award_tables', 'tok-1']]))).toEqual({
      award_tables: 'tok-1',
    })
    expect(standingAcks(PREVIEW, new Map([['award_tables', 'tok-old']]))).toEqual({})
    expect(allConfirmed(PREVIEW, new Map())).toBe(false)
    expect(allConfirmed(PREVIEW, new Map([['award_tables', 'tok-1']]))).toBe(true)
  })
})

describe('the warning names the edit on camp time, and a locked section says what a new version does', () => {
  it('reads an evening edit as that camp day, not the UTC next one', () => {
    const section = {
      ...PREVIEW.sections[0]!,
      warning: { ...PREVIEW.sections[0]!.warning!, at: '2027-01-22T03:00:00Z' },
    }
    expect(warningWords(section)).toBe(
      'Replaces an unapproved change in the rules draft (Test User, Jan 21, 2027, from B2).'
    )
  })

  it('says a posted round locks the section, that a new version may start, and that posted amounts stand', () => {
    expect(lockedWords('award_tables')).toBe(
      'Round 1 award table is locked by a posted round: making this the rules draft may start a new version of it. Posted amounts stand.'
    )
  })
})
