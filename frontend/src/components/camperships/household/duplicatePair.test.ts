/** Item 11 (owner ruling 10-05): the two requests of a duplicate pair, each able to reach the other. */
import { describe, expect, it } from 'vitest'

import { gridRow } from '../requests/gridFixtures'
import { duplicatePair, withdrawnPair } from './duplicatePair'
import { applicationOut, householdPage, householdRequest, requestOut } from './householdFixtures'

const PENDING = householdRequest(
  gridRow({ request_id: 'reqpending00001', request_status: 'duplicate_pending' })
)
const KEPT = householdRequest(gridRow({ request_id: 'reqkept00000001', request_status: 'active' }))
const APPLICATION = applicationOut({
  requests: [
    requestOut({
      id: 'reqpending00001',
      status: 'duplicate_pending',
      duplicate_of: 'reqkept00000001',
    }),
    requestOut({ id: 'reqkept00000001', status: 'active' }),
  ],
})

describe('duplicatePair', () => {
  it('pairs a pending duplicate with the request intake named, when that one is on the page', () => {
    const page = householdPage({ requests: [PENDING, KEPT] })
    expect(duplicatePair(page, APPLICATION, PENDING)).toEqual({
      otherId: 'reqkept00000001',
      other: KEPT,
      keepThis: false,
    })
  })

  it("names a holder on another household's page by its id alone", () => {
    const page = householdPage({ requests: [PENDING] })
    expect(duplicatePair(page, APPLICATION, PENDING)).toEqual({
      otherId: 'reqkept00000001',
      other: null,
      keepThis: false,
    })
  })

  it('pairs the request kept with the pending duplicate that names it, and lets it keep itself', () => {
    const page = householdPage({ requests: [PENDING, KEPT] })
    expect(duplicatePair(page, APPLICATION, KEPT)).toEqual({
      otherId: 'reqpending00001',
      other: PENDING,
      keepThis: true,
    })
  })

  it('pairs nothing for a request no duplicate names, a pending one naming none, or no read yet', () => {
    const lone = householdRequest(
      gridRow({ request_id: 'reqlone00000001', request_status: 'active' })
    )
    const page = householdPage({ requests: [PENDING, KEPT, lone] })
    expect(duplicatePair(page, APPLICATION, lone)).toBeNull()
    const unnamed = applicationOut({
      requests: [
        requestOut({ id: 'reqpending00001', status: 'duplicate_pending', duplicate_of: '' }),
      ],
    })
    expect(duplicatePair(page, unnamed, PENDING)).toBeNull()
    expect(duplicatePair(page, undefined, PENDING)).toBeNull()
    expect(duplicatePair(page, undefined, KEPT)).toBeNull()
  })
})

// Item 4c (owner ruling 10-05): a revived duplicate's hold names the withdrawn request it was the
// duplicate of (intake's `duplicate_survivor_withdrawn` flag, detail.withdrawn_survivor).
describe('withdrawnPair', () => {
  const REVIVED = householdRequest(
    gridRow({
      request_id: 'reqrevived00001',
      request_status: 'active',
      holds: [{ code: 'duplicate_survivor_withdrawn', severity: 'hold', message: 'm' }],
    })
  )
  const WITHDRAWN = householdRequest(
    gridRow({ request_id: 'reqwithdrawn001', request_status: 'withdrawn' })
  )
  const naming = (survivor: unknown) =>
    applicationOut({
      requests: [
        requestOut({
          id: 'reqrevived00001',
          status: 'active',
          flags: [
            { code: 'duplicate_survivor_withdrawn', detail: { withdrawn_survivor: survivor } },
          ],
        }),
      ],
    })

  it('names the withdrawn request, and its card when it is on the page', () => {
    const page = householdPage({ requests: [REVIVED, WITHDRAWN] })
    expect(withdrawnPair(page, naming('reqwithdrawn001'), REVIVED)).toEqual({
      otherId: 'reqwithdrawn001',
      other: WITHDRAWN,
      keepThis: false,
    })
    const alone = householdPage({ requests: [REVIVED] })
    expect(withdrawnPair(alone, naming('reqwithdrawn001'), REVIVED)?.other).toBeNull()
  })

  it('names nothing without the flag, without a survivor, or before the read', () => {
    const page = householdPage({ requests: [REVIVED, WITHDRAWN] })
    expect(withdrawnPair(page, APPLICATION, REVIVED)).toBeNull()
    expect(withdrawnPair(page, naming(''), REVIVED)).toBeNull()
    expect(withdrawnPair(page, naming(7), REVIVED)).toBeNull()
    expect(withdrawnPair(page, undefined, REVIVED)).toBeNull()
  })
})
