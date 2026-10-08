/** The family footer's note on money not yet classified (coordinator ruling 2026-10-08). */
import { describe, expect, it } from 'vitest'

import { unclassifiedNote } from './ledgerFamiliesModel'

describe('unclassifiedNote', () => {
  it('names the summary figure when no filter is on', () => {
    expect(unclassifiedNote(300, false)).toBe('includes $300 not yet classified')
    expect(unclassifiedNote(300.5, false)).toBe('includes $300.50 not yet classified')
  })

  it('gives no amount when any filter is on, as the summary is season-wide', () => {
    expect(unclassifiedNote(300, true)).toBe('may include money not yet classified')
  })

  it('says nothing when there is no unclassified money or no summary yet', () => {
    expect(unclassifiedNote(0, false)).toBeNull()
    expect(unclassifiedNote(0, true)).toBeNull()
    expect(unclassifiedNote(undefined, false)).toBeNull()
    expect(unclassifiedNote(null, true)).toBeNull()
  })
})
