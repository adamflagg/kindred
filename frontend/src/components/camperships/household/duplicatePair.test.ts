/** Item 11 (owner ruling 10-05): the two requests of a duplicate pair, each able to reach the other. */
import { describe, expect, it } from 'vitest'

import { gridRow } from '../requests/gridFixtures'
import { duplicatePair } from './duplicatePair'
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
