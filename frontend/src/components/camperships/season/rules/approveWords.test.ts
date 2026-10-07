import { describe, expect, it } from 'vitest'

import { approvedNotice, sectionChangeWords } from './approveWords'

describe('approveWords (spec §4)', () => {
  it('keeps the reviewed approval words (interim S8-⚠1)', () => {
    expect(approvedNotice({ pricing: 'moved', warnings: [] })).toBe(
      'Approved. Requests not yet posted are priced on the new rules; a posted amount stands.'
    )
    expect(approvedNotice({ pricing: 'waiting', warnings: ['Pool B sets no share'] })).toBe(
      'Approved. Nothing is re-priced until every section that prices the season is approved. A posted amount stands.\n\nPool B sets no share'
    )
  })

  it("joins a section's changes with a middle dot", () => {
    expect(
      sectionChangeWords([
        { path: ['pools', 'pool_a', 'share_pct'], kind: 'changed', before: '90', after: '89' },
        { path: ['total'], kind: 'changed', before: '500000', after: '510000' },
      ])
    ).toBe('Pools › Pool a › Share %: 90% → 89% · Total budget: $500,000 → $510,000')
  })
})
