import { describe, expect, it } from 'vitest'

import { gridRow, ROW_EMMA } from '../requests/gridFixtures'
import {
  caseworkOffers,
  correctionValue,
  duplicateSurvivors,
  fieldKind,
  headcountOf,
  parseCount,
  parsePercent,
  namedHolder,
} from './caseworkModel'
import { applicationOut, householdPage, householdRequest, requestOut } from './householdFixtures'

const answer = (field: string, synced: string) => ({
  field,
  synced,
  effective: synced,
  corrected: false,
  changed_since_correction: false,
  history: [],
})

describe('reading what staff type', () => {
  it('knows each answer’s kind; the income override is not a typed figure (Decision 37)', () => {
    expect(fieldKind(answer('total_rent', '1200.00'))).toBe('money')
    expect(fieldKind(answer('num_children', '2'))).toBe('count')
    expect(fieldKind(answer('single_parent', 'true'))).toBe('flag')
    expect(fieldKind(answer('income_override', 'confirmed_prior_year'))).toBe('override')
  })

  it('reads counts, percentages and corrections strictly', () => {
    expect(parseCount('4', 50)).toEqual({ kind: 'ok', value: 4 })
    expect(parseCount('4.5', 50)).toEqual({ kind: 'invalid', reason: 'A whole number' })
    expect(parseCount('51', 50)).toEqual({ kind: 'invalid', reason: 'At most 50' })
    expect(parsePercent('62.5%')).toEqual({ kind: 'ok', value: '62.5' })
    expect(parsePercent('140')).toEqual({ kind: 'invalid', reason: 'At most 100%' })
    expect(parsePercent('0')).toEqual({ kind: 'invalid', reason: 'More than 0%' })
    expect(parsePercent('100')).toEqual({ kind: 'ok', value: '100' })
    expect(correctionValue('money', '$85,000')).toEqual({ kind: 'ok', value: '85000' })
    expect(correctionValue('money', '85,00')).toEqual({ kind: 'invalid', reason: 'Not an amount' })
    expect(correctionValue('flag', 'false')).toEqual({ kind: 'ok', value: 'false' })
  })

  it("lets an income figure go to the server's own ceiling, $10,000,000, not the aid-amount $1,000,000 (MONEY_CEILING)", () => {
    expect(correctionValue('money', '1,200,000')).toEqual({ kind: 'ok', value: '1200000' })
    expect(correctionValue('money', '10000000')).toEqual({ kind: 'ok', value: '10000000' })
    expect(correctionValue('money', '10000000.01')).toEqual({
      kind: 'invalid',
      reason: 'More than $10,000,000',
    })
  })

  it('a blank money correction asks for a figure; going back to the form is a null, never ""', () => {
    expect(correctionValue('money', '  ')).toEqual({ kind: 'invalid', reason: 'Enter the figure' })
    // The restore path: the server's parser 422s on '' for every kind and reads only null as "revert".
    expect(correctionValue('money', null)).toEqual({ kind: 'ok', value: null })
    expect(correctionValue('count', null)).toEqual({ kind: 'ok', value: null })
    expect(correctionValue('flag', null)).toEqual({ kind: 'ok', value: null })
  })
})

describe('what the forms offer', () => {
  it('offers as the one to keep only an active request for the same camper and session', () => {
    const duplicate = householdRequest(
      gridRow({ request_id: 'reqemmadup00009', request_status: 'duplicate_pending' })
    )
    const page = householdPage({ requests: [householdRequest(ROW_EMMA), duplicate] })
    expect(duplicateSurvivors(page, duplicate).map((r) => r.row.request_id)).toEqual([
      'reqemma00000001',
    ])
  })

  it("follows the server's duplicate rule: same program, a session still unnamed matches any, a family request pairs by household", () => {
    const survivor = householdRequest(ROW_EMMA)
    const unnamed = householdRequest(
      gridRow({
        request_id: 'reqemmadup00009',
        request_status: 'duplicate_pending',
        session_cm_id: 0,
      })
    )
    expect(
      duplicateSurvivors(householdPage({ requests: [survivor, unnamed] }), unnamed).map(
        (r) => r.row.request_id
      )
    ).toEqual(['reqemma00000001'])

    const otherProgram = householdRequest(
      gridRow({
        request_id: 'reqemmadup00009',
        request_status: 'duplicate_pending',
        program_key: 'quest',
      })
    )
    expect(
      duplicateSurvivors(householdPage({ requests: [survivor, otherProgram] }), otherProgram)
    ).toEqual([])

    const family = (id: string, status: string) =>
      householdRequest(
        gridRow({
          request_id: id,
          person_cm_id: 0,
          camper_name: '',
          program_key: 'family_camp',
          request_status: status,
        })
      )
    const kept = family('reqfamily000010', 'active')
    const dup = family('reqfamily000011', 'duplicate_pending')
    expect(
      duplicateSurvivors(householdPage({ requests: [kept, dup, survivor] }), dup).map(
        (r) => r.row.request_id
      )
    ).toEqual(['reqfamily000010'])
  })

  it('reads the holder intake named for a duplicate from the application', () => {
    const app = applicationOut({
      requests: [requestOut({ id: 'reqemmadup00009', duplicate_of: 'reqemmaother01' })],
    })
    expect(namedHolder(app, 'reqemmadup00009')).toBe('reqemmaother01')
    expect(namedHolder(app, 'reqother0000099')).toBe('')
    expect(namedHolder(undefined, 'reqemmadup00009')).toBe('')
  })

  it("reads a Family Camp request's headcount from the application", () => {
    const app = applicationOut({
      requests: [
        requestOut({
          id: 'reqfamily000010',
          person_cm_id: 0,
          headcount_non_infant: 2,
          headcount_infant: 1,
        }),
      ],
    })
    expect(headcountOf(app, 'reqfamily000010')).toEqual({ nonInfant: 2, infant: 1 })
    expect(headcountOf(app, 'reqother0000099')).toBeNull()
  })
})

describe('which casework buttons a request takes (the server’s own refusals)', () => {
  const offers = (over: Parameters<typeof gridRow>[0]) => caseworkOffers(gridRow(over))

  // Owner ruling: shares are hidden on a cancelled request and on a pending duplicate, though the
  // server allows both (it refuses only a duplicate or withdrawn request).
  it('payer shares: hidden on a cancelled request and a pending duplicate; offered on the rest', () => {
    expect(offers({}).shares).toBe(true)
    expect(offers({ request_status: 'unmatched_session' }).shares).toBe(true)
    expect(offers({ request_status: 'duplicate_pending' }).shares).toBe(false)
    expect(offers({ request_status: 'duplicate' }).shares).toBe(false)
    expect(offers({ request_status: 'withdrawn' }).shares).toBe(false)
    const kindred = { by: 'kindred', on: '2027-06-02', reason: 'medical', note: '' } as const
    const campminder = { by: 'campminder', on: null, reason: null, note: '' } as const
    expect(offers({ cancellation: kindred }).shares).toBe(false)
    expect(offers({ cancellation: campminder }).shares).toBe(false)
  })

  it('settle session only while unmatched; keep-the-other only while a duplicate is pending', () => {
    expect(offers({ request_status: 'unmatched_session' })).toMatchObject({
      session: true,
      duplicate: false,
    })
    expect(offers({ request_status: 'duplicate_pending' })).toMatchObject({
      session: false,
      duplicate: true,
    })
    expect(offers({})).toMatchObject({ session: false, duplicate: false })
  })

  it('a headcount belongs to a Family Camp household request that is not closed', () => {
    const family = { person_cm_id: 0, program_key: 'family_camp' }
    expect(offers(family).headcount).toBe(true)
    expect(offers({ ...family, request_status: 'withdrawn' }).headcount).toBe(false)
    expect(offers({ person_cm_id: 0, program_key: 'summer' }).headcount).toBe(false)
    expect(offers({ program_key: 'family_camp' }).headcount).toBe(false)
  })
})
