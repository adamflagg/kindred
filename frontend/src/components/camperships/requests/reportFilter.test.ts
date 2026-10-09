/** Requests' `?report=` (slice 4 J; D20): the requests behind one Reports count, from the server's list. */
import { describe, expect, it } from 'vitest'

import { bothIds, parseReportParam, reportParam, reportRequestIds } from './reportFilter'

const READ = {
  year: 2027,
  as_of: null,
  as_of_axis: null,
  figures_on: '2027-04-10',
  request_set: null,
  request_ids: ['reqemma00000001', 'reqliam00000002'],
}

describe('a Reports count in the URL', () => {
  it('round-trips a count’s address through the one parameter', () => {
    const address = {
      report: 'statistics' as const,
      query: { part: 'tier', tier: '1', count: 'apps', round: '1' },
    }
    expect(reportParam(address)).toBe('statistics?part=tier&tier=1&count=apps&round=1')
    expect(parseReportParam(reportParam(address))).toEqual(address)
  })

  it('drops what the route doesn’t take, so a hand-edited link never sends it', () => {
    expect(
      parseReportParam('programs?part=session&block=1&count=apps&session=1000102&as_of=x')
    ).toEqual({
      report: 'programs',
      query: { part: 'session', block: '1', count: 'apps', session: '1000102' },
    })
  })

  it("keeps RPT-9's appeals_count, which the statistics route takes", () => {
    expect(parseReportParam('statistics?part=tier_appeals&tier=2&appeals_count=appeals')).toEqual({
      report: 'statistics',
      query: { part: 'tier_appeals', tier: '2', appeals_count: 'appeals' },
    })
  })

  it('reads a malformed address as no filter at all', () => {
    expect(parseReportParam(null)).toBeNull()
    expect(parseReportParam('ledger?part=tier')).toBeNull()
    expect(parseReportParam('statistics')).toBeNull() // no part
    expect(parseReportParam('programs?part=total&count=apps')).toBeNull() // no block
  })
})

describe('the rows a count opens', () => {
  it('is the ids the server sent, and nothing until they land', () => {
    expect(reportRequestIds(undefined)).toBeNull()
    expect(reportRequestIds(READ)).toEqual(new Set(READ.request_ids))
  })

  it('takes the rows in both when a History operation narrows too', () => {
    const a = new Set(['x', 'y'])
    expect(bothIds(null, a)).toBe(a)
    expect(bothIds(a, null)).toBe(a)
    expect(bothIds(a, new Set(['y', 'z']))).toEqual(new Set(['y']))
  })
})
