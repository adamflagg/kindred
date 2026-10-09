/** The Register's filters (§8.2; ruling G): chips, grantor and program, from and for the URL. */
import { describe, expect, it } from 'vitest'

import { GRANTS, NEVER_APPLIED_HOUSEHOLD, OLIVIA_AFTER_OFFER } from './grantsFixtures'
import {
  filterRegister,
  grantorChoices,
  programChoices,
  readRegisterFilters,
  REGISTER_SHOWS,
  registerCsvName,
  showCounts,
} from './registerFilters'
import { needsCamperIds } from './registerModel'

const read = (query: string) => readRegisterFilters(new URLSearchParams(query))
const NEEDS = needsCamperIds(GRANTS.needs_camper)

describe('the Show switcher (design-language §18; money-grants.html)', () => {
  it("runs All · In CM · Committed · not in CM · Household level · Didn't apply · Cancelled · After the offer · Not counted", () => {
    expect(REGISTER_SHOWS.map((s) => s.label)).toEqual([
      'All',
      'In CM',
      'Committed · not in CM',
      'Household level',
      "Didn't apply",
      'Cancelled',
      'After the offer',
      'Not counted',
    ])
  })

  it('"In CM" lists the ledger lines, a reversed one too', () => {
    const rows = filterRegister(GRANTS.grants, read('show=in-cm'), NEEDS)
    expect(rows.every((r) => r.kind === 'ledger')).toBe(true)
    expect(rows).toHaveLength(6)
  })

  it('★17 "Not counted" lists what the total leaves out: reversed, waiting, a cancelled camper\'s commitment', () => {
    const rows = filterRegister(GRANTS.grants, read('show=not-counted'), NEEDS)
    expect(rows.map((r) => String(r.transaction_cm_id || r.commitment_id)).sort()).toEqual(
      ['cmtsamuel000001', 4000002, 4000004].map(String).sort()
    )
    // A never-applied household's line counts, so it is not here.
    expect(filterRegister([NEVER_APPLIED_HOUSEHOLD], read('show=not-counted'), NEEDS)).toEqual([])
  })
})

describe('the Register filters', () => {
  it('reads the URL, an unknown chip as All', () => {
    expect(read('show=cancelled&grantor=grantor_b&program=summer')).toEqual({
      show: 'cancelled',
      grantor: 'grantor_b',
      program: 'summer',
    })
    expect(read('show=bogus').show).toBe('all')
  })

  it('counts each chip over the grantor and program picked', () => {
    expect(showCounts(GRANTS.grants, read(''), NEEDS)).toEqual({
      all: 8,
      // money-grants.html: "In CM" (a ledger line carries it) and ★17's "Not counted" join the switcher.
      'in-cm': 6,
      committed: 2,
      household: 1,
      'didnt-apply': 1,
      cancelled: 2,
      'after-offer': 1,
      'not-counted': 3,
    })
    expect(showCounts(GRANTS.grants, read('grantor=grantor_b'), NEEDS)).toMatchObject({
      all: 2,
      cancelled: 1,
    })
  })

  it('"Didn\'t apply" takes a never-applied household\'s line that stays at household level (R5-2)', () => {
    const rows = [...GRANTS.grants, NEVER_APPLIED_HOUSEHOLD]
    expect(showCounts(rows, read(''), NEEDS)).toMatchObject({ household: 2, 'didnt-apply': 2 })
    expect(filterRegister(rows, read('show=didnt-apply'), NEEDS)).toContain(NEVER_APPLIED_HOUSEHOLD)
  })

  it('"After the offer" shows the grants known after Round 1 posted (ruling G)', () => {
    expect(filterRegister(GRANTS.grants, read('show=after-offer'), NEEDS)).toEqual([
      OLIVIA_AFTER_OFFER,
    ])
  })

  it('"none" picks the lines whose description names no grantor yet', () => {
    expect(filterRegister(GRANTS.grants, read('grantor=none'), NEEDS)).toEqual([OLIVIA_AFTER_OFFER])
  })

  it('offers the grantors by name and the programs in the rules’ words', () => {
    expect(grantorChoices(GRANTS.grants).map((c) => c.label)).toEqual([
      'Grantor A',
      'Grantor B',
      'Grantor C',
      'Grantor D',
      'No grantor yet',
    ])
    expect(programChoices(GRANTS.grants)).toEqual([{ value: 'summer', label: 'Summer Camp' }])
  })

  it('names the file as D70 does', () => {
    expect(registerCsvName(2027, read('show=cancelled&grantor=grantor_b'))).toBe(
      'camperships-money-grants-cancelled-grantor-b-2027.csv'
    )
  })
})

describe('the Program filter (program_label, #3090)', () => {
  it('offers the label the rows send, and "Other program" for a family with none', () => {
    const quest = { ...GRANTS.grants[0]!, program_family: 'quest', program_label: '' }
    expect(programChoices([quest])).toEqual([{ value: 'quest', label: 'Other program' }])
  })
})
