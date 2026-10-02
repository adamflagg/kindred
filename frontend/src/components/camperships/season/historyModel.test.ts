/** Season › History's filters and paging (spec §7.6; D15, D49, D76). Pure. */
import { describe, expect, it } from 'vitest'

import { PAGE } from './historyFixtures'
import {
  PER_PAGE,
  chipKinds,
  historyQuery,
  lastPage,
  pageWords,
  parseHistoryFilters,
  parseOpen,
  toggleOpen,
  withFilter,
} from './historyModel'

const parse = (search: string, rules = true) =>
  parseHistoryFilters(new URLSearchParams(search), rules)

describe('History filters from the URL (D15, D49)', () => {
  it('reads every filter the read takes', () => {
    expect(
      parse(
        'kind=holds&actor=registrar%40example.com&since=2027-03-01&until=2027-04-10&q=phone&intake=1&page=3'
      )
    ).toEqual({
      kind: 'holds',
      actor: 'registrar@example.com',
      since: '2027-03-01',
      until: '2027-04-10',
      q: 'phone',
      intake: true,
      page: 3,
    })
  })

  it('reads the default view from an empty URL', () => {
    expect(parse('')).toEqual({
      kind: null,
      actor: null,
      since: null,
      until: null,
      q: '',
      intake: false,
      page: 1,
    })
  })

  it('drops what the router would refuse, so a pasted link never fails the read', () => {
    expect(parse('kind=scenarios&since=2027-02-30&until=April&page=0')).toMatchObject({
      kind: null,
      since: null,
      until: null,
      page: 1,
    })
    expect(parse('page=2.5').page).toBe(1)
    expect(parse('page=10001').page).toBe(1)
    expect(parse(`q=${'x'.repeat(250)}`).q).toHaveLength(200)
    expect(parse(`actor=${'a'.repeat(400)}`).actor).toHaveLength(320)
    expect(parse('q=%20%20phone%20').q).toBe('phone')
    // A year typed halfway (a date box's 0202-03-01) is a real day but no season's.
    expect(parse('since=0202-03-01&until=2016-12-31').since).toBeNull()
    expect(parse('since=0202-03-01&until=2016-12-31').until).toBeNull()
    expect(parse('since=2017-01-01').since).toBe('2017-01-01')
  })

  it('never asks for Rules without `rules` (D49, D76)', () => {
    expect(parse('kind=rules', false).kind).toBeNull()
    expect(parse('kind=rules', true).kind).toBe('rules')
    expect(chipKinds(false)).toEqual(['offers', 'money', 'holds', 'grants'])
    expect(chipKinds(true)).toEqual(['rules', 'offers', 'money', 'holds', 'grants'])
  })

  it('never takes intake as a chip: intake runs are the tick (D49)', () => {
    expect(parse('kind=intake').kind).toBeNull()
  })
})

describe("the read's query", () => {
  it('sends only what is set, in the router names, and always the page size', () => {
    expect(historyQuery(parse(''))).toEqual({ per_page: String(PER_PAGE) })
    expect(
      historyQuery(
        parse(
          'kind=money&actor=a%40example.com&since=2027-03-01&until=2027-03-31&q=email&intake=1&page=2'
        )
      )
    ).toEqual({
      kind: 'money',
      actor: 'a@example.com',
      since: '2027-03-01',
      until: '2027-03-31',
      q: 'email',
      include_intake: 'true',
      page: '2',
      per_page: '50',
    })
  })
})

describe('writing one filter', () => {
  it('sets or clears it and goes back to page 1, keeping the season, the as-of and the open lines', () => {
    const before = new URLSearchParams(
      'year=2027&as_of=2027-03-15&page=4&open=op0000000000003&kind=money'
    )
    expect(withFilter(before, 'kind', 'holds').toString()).toBe(
      'year=2027&as_of=2027-03-15&open=op0000000000003&kind=holds'
    )
    expect(withFilter(before, 'kind', null).toString()).toBe(
      'year=2027&as_of=2027-03-15&open=op0000000000003'
    )
    expect(withFilter(before, 'q', '').has('q')).toBe(false)
    expect(withFilter(before, 'page', '5').get('page')).toBe('5')
    // The input is never changed: the caller hands it to setSearchParams' updater.
    expect(before.get('page')).toBe('4')
  })
})

describe('open lines (`open=`)', () => {
  it('reads operation ids only, once each', () => {
    expect(parseOpen('op0000000000003,bad,op0000000000003,op0000000000005')).toEqual([
      'op0000000000003',
      'op0000000000005',
    ])
    expect(parseOpen(null)).toEqual([])
    expect(parseOpen('')).toEqual([])
  })

  it('toggles one line, and clears the parameter when none is left open', () => {
    expect(toggleOpen([], 'op0000000000003')).toBe('op0000000000003')
    expect(toggleOpen(['op0000000000003', 'op0000000000005'], 'op0000000000003')).toBe(
      'op0000000000005'
    )
    expect(toggleOpen(['op0000000000003'], 'op0000000000003')).toBeNull()
  })
})

describe('the count line and paging', () => {
  it('says which operations the page holds', () => {
    expect(PAGE.operations).toHaveLength(3)
    expect(pageWords(PAGE)).toBe('1–3 of 3 operations')
    expect(pageWords({ ...PAGE, total: 312, page: 2 })).toBe('51–53 of 312 operations')
    expect(pageWords({ ...PAGE, total: 1, operations: PAGE.operations.slice(0, 1) })).toBe(
      '1–1 of 1 operation'
    )
  })

  it('says when nothing matches, and when a page is past the end', () => {
    expect(pageWords({ ...PAGE, total: 0, operations: [] })).toBe('No operations match.')
    expect(pageWords({ ...PAGE, page: 9, total: 60, operations: [] })).toBe(
      'Nothing on page 9: 60 operations match.'
    )
  })

  it('knows the last page, which is 1 when nothing matches', () => {
    expect(lastPage({ ...PAGE, total: 101 })).toBe(3)
    expect(lastPage({ ...PAGE, total: 100 })).toBe(2)
    expect(lastPage({ ...PAGE, total: 0 })).toBe(1)
  })
})
