/**
 * The filters a link carries (?live, ?op, ?report, ?figure) as removable toolbar chips (design-language
 * §6; answers 1a R3–R6): the old sentence is each chip's title, a failed read is an amber chip with
 * its Try Again, and nothing sits as a row above the grid.
 */
import { describe, expect, it } from 'vitest'

import { linkChips } from './linkChips'

const base = {
  live: false,
  figure: null,
  op: { on: false, state: 'ready', count: 0 },
  report: { on: false, state: 'ready', kind: 'statistics', count: 0, missing: 0 },
} as const

describe('linkChips', () => {
  it('draws nothing with no link filter', () => {
    expect(linkChips(base)).toEqual([])
  })

  it('draws Live only, its sentence in the title', () => {
    expect(linkChips({ ...base, live: true })).toEqual([
      {
        key: 'live',
        label: 'Live only',
        title:
          'Live requests only, as the budget counts them (from Season › Rounds & budget). ✕ shows all.',
        warn: false,
        retry: false,
      },
    ])
  })

  it('draws a History operation with its count, and says while it reads', () => {
    const op = (state: 'ready' | 'reading' | 'missing' | 'failed', count = 3) => ({
      ...base,
      op: { on: true, state, count },
    })
    expect(linkChips(op('ready'))[0]).toMatchObject({
      key: 'op',
      label: 'History operation · 3',
      title: 'The 3 requests in one History operation (from Season › History). ✕ shows all.',
      warn: false,
    })
    expect(linkChips(op('reading'))[0]?.label).toBe('Reading History operation…')
    expect(linkChips(op('missing'))[0]?.title).toBe(
      "That History operation isn't in the log you can read. ✕ shows all."
    )
  })

  it('draws a failed operation read as an amber chip that can Try Again', () => {
    const [chip] = linkChips({ ...base, op: { on: true, state: 'failed', count: 0 } })
    expect(chip).toEqual({
      key: 'op',
      label: "Couldn't read · Try Again",
      title: "Couldn't read that History operation. Try Again, or ✕ to show all.",
      warn: true,
      retry: true,
    })
  })

  it('draws a Reports count, naming the ones this list does not hold in the title', () => {
    const [chip] = linkChips({
      ...base,
      report: { on: true, state: 'ready', kind: 'statistics', count: 8, missing: 2 },
    })
    expect(chip).toMatchObject({
      key: 'report',
      label: 'Statistics count · 8',
      title:
        "The 8 requests behind one Statistics count · 2 of them aren't in this list. ✕ shows all.",
    })
    const [by] = linkChips({
      ...base,
      report: { on: true, state: 'ready', kind: 'programs', count: 1, missing: 0 },
    })
    expect(by?.label).toBe('Statistics by session count · 1')
    expect(by?.title).toBe('The 1 request behind one Statistics by session count. ✕ shows all.')
  })

  it('draws a failed Reports read amber with Try Again', () => {
    const [chip] = linkChips({
      ...base,
      report: { on: true, state: 'failed', kind: 'statistics', count: 0, missing: 0 },
    })
    expect(chip).toMatchObject({ warn: true, retry: true, label: "Couldn't read · Try Again" })
  })

  it('draws a Season figure', () => {
    const [chip] = linkChips({ ...base, figure: { measure: 'posted', round: 1 } })
    expect(chip).toEqual({
      key: 'figure',
      label: 'Posted in Round 1',
      title: 'Posted in Round 1: the requests behind one Season figure. ✕ shows all.',
      warn: false,
      retry: false,
    })
  })

  it('keeps them in order when several are on', () => {
    const keys = linkChips({
      ...base,
      live: true,
      figure: { measure: 'accepted', round: 'all' },
    }).map((c) => c.key)
    expect(keys).toEqual(['live', 'figure'])
  })
})
