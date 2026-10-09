/** The family footer's words and the Ledger's pickers (final UX: ★11 total row, §3 pickers, §5 one row). */
import { describe, expect, it } from 'vitest'

import {
  familiesWords,
  footNoteWords,
  linesHeading,
  sourcePickerOptions,
  totalOpenTitle,
  TOTALS_TIP,
  unclassifiedNote,
  withAllAndSent,
} from './ledgerFamiliesModel'

describe('unclassifiedNote', () => {
  // Final UX (mock money-ledger.html `unclWords`): the note now starts "Outside grants" because it
  // sits in the total row's last cell, not after a sentence.
  it('names the summary figure when no filter is on', () => {
    expect(unclassifiedNote(300, false)).toBe('Outside grants incl. $300 not yet classified')
    expect(unclassifiedNote(300.5, false)).toBe('Outside grants incl. $300.50 not yet classified')
  })

  it('gives no amount when any filter is on, as the summary is season-wide', () => {
    expect(unclassifiedNote(300, true)).toBe('Outside grants may include money not yet classified')
  })

  it('says nothing when there is no unclassified money or no summary yet', () => {
    expect(unclassifiedNote(0, false)).toBeNull()
    expect(unclassifiedNote(0, true)).toBeNull()
    expect(unclassifiedNote(undefined, false)).toBeNull()
    expect(unclassifiedNote(null, true)).toBeNull()
  })
})

describe('the total row (★11)', () => {
  it('counts the families, singular for one', () => {
    expect(familiesWords(4)).toBe('4 families')
    expect(familiesWords(1)).toBe('1 family')
  })

  it("titles each opening total with its name; the totals' tip is the label's", () => {
    expect(totalOpenTitle('in_campminder_net')).toBe(
      'In CampMinder (net): open the lines behind it'
    )
    expect(totalOpenTitle('outside_grants')).toBe('Outside grants: open the lines behind it')
    expect(TOTALS_TIP).toBe(
      'Each total opens its lines. The totals follow the filters, not the search.'
    )
  })

  it('puts the unclassified note in the last cell, else the muted hint', () => {
    expect(footNoteWords(300, false)).toEqual({
      words: 'Outside grants incl. $300 not yet classified',
      title: `Outside grants incl. $300 not yet classified. ${TOTALS_TIP}`,
    })
    expect(footNoteWords(0, false)).toEqual({
      words: 'each total opens its lines',
      title: TOTALS_TIP,
    })
  })
})

describe('the lines card heading (★13)', () => {
  it('names the total and its amount, then the lines behind it', () => {
    expect(linesHeading('in_campminder_net', 6400, 5, 2)).toEqual({
      title: 'In CampMinder (net) $6,400',
      desc: 'the 5 lines behind it, 2 reversed (struck, not counted)',
    })
    expect(linesHeading('outside_grants', 250, 1, 0)).toEqual({
      title: 'Outside grants $250',
      desc: 'the 1 line behind it',
    })
  })
})

describe('the Source picker (§3, item 2)', () => {
  const families = [
    { value: 'camp_fa', label: 'Camp financial aid' },
    { value: 'named_fund', label: 'Named funds' },
    { value: 'other_outside', label: 'Other outside grants' },
    { value: 'unclassified', label: 'Not yet classified' },
  ]

  it("groups: All, the camp's own, Every outside grant then each outside family, Not classified last", () => {
    expect(sourcePickerOptions(families, null, true)).toEqual([
      { value: '', label: 'All' },
      { value: 'camp_fa', label: 'Camp financial aid', group: "The camp's own" },
      { value: 'outside', label: 'Every outside grant', group: 'Outside grants' },
      { value: 'named_fund', label: 'Named funds', group: 'Outside grants' },
      { value: 'other_outside', label: 'Other outside grants', group: 'Outside grants' },
      { value: 'unclassified', label: 'Not yet classified', group: 'Not classified' },
    ])
  })

  it('leaves Not classified out while the season has none', () => {
    const values = sourcePickerOptions(families, null, false).map((o) => o.value)
    expect(values).not.toContain('unclassified')
    expect(values).toContain('outside')
  })

  it('offers Every outside grant even before the registry has loaded', () => {
    expect(sourcePickerOptions([], null, false).map((o) => o.value)).toEqual(['', 'outside'])
  })

  it('keeps a sent unclassified choice, so the picker never says All over a filtered read', () => {
    const values = sourcePickerOptions(families, 'unclassified', false).map((o) => o.value)
    expect(values).toContain('unclassified')
  })
})

describe('withAllAndSent', () => {
  const options = [
    { value: '', label: 'All' },
    { value: 'summer', label: 'Session 2' },
  ]
  it('adds a stale sent value right after All, in its own words', () => {
    expect(withAllAndSent(options, 'old', () => 'Old words')).toEqual([
      { value: '', label: 'All' },
      { value: 'old', label: 'Old words' },
      { value: 'summer', label: 'Session 2' },
    ])
  })
  it('adds nothing for a value on the list or none sent', () => {
    expect(withAllAndSent(options, 'summer', () => 'x')).toEqual(options)
    expect(withAllAndSent(options, null, () => 'x')).toEqual(options)
  })
})
