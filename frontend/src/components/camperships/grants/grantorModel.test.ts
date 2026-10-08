/** Grants › Grantors' words and edits (§8.2; D86, D143, D160; owner 10-06, rulings:676). */
import { describe, expect, it } from 'vitest'

import {
  GRANTOR_A,
  GRANTOR_C,
  GRANTOR_E,
  GRANTOR_F_RETIRED,
  GRANTOR_K,
} from './grantorDirectoryFixtures'
import {
  canteenCell,
  draftOfGrantor,
  EMPTY_GRANTOR,
  fullCoverageCell,
  grantorsCsvName,
  isRetired,
  paysAfterCell,
  readCreate,
  readSave,
  retireBlocked,
  seasonAmount,
  seasonCount,
  suggestKey,
  termsWords,
} from './grantorModel'

describe('grantorModel', () => {
  it('suggests a key the route accepts', () => {
    expect(suggestKey('Grantor A')).toBe('grantor_a')
    expect(suggestKey('  2027 Fund!  ')).toBe('g_2027_fund')
  })

  it("says a named fund's award terms in words (owner 10-06)", () => {
    expect(termsWords(GRANTOR_K)).toBe('pays the rest after camp aid · no canteen')
    expect(termsWords(GRANTOR_C)).toBe('covers the full cost · canteen not known')
    expect(termsWords(GRANTOR_A)).toBe('')
  })

  it('fills the three term columns, "n/a" where only full coverage has the fact', () => {
    expect([fullCoverageCell(GRANTOR_A), canteenCell(GRANTOR_A), paysAfterCell(GRANTOR_A)]).toEqual(
      ['—', 'n/a', 'n/a']
    )
    expect([fullCoverageCell(GRANTOR_K), canteenCell(GRANTOR_K), paysAfterCell(GRANTOR_K)]).toEqual(
      ['yes', 'no', 'yes']
    )
    expect(canteenCell(GRANTOR_C)).toBe('not known')
  })

  it("⚠ sends the whole record, keeping full coverage's two facts to the server's rule", () => {
    const draft = {
      ...draftOfGrantor(GRANTOR_K),
      fullCoverage: false,
      note: 'Not full coverage after all',
    }
    expect(readSave(draft)).toEqual({
      ok: true,
      body: {
        name: 'Grantor K gap-filler award',
        aliases: [],
        full_coverage: false,
        covers_canteen: 'unknown',
        pays_after_camp_aid: false,
        eligibility: 'Fills the gap last',
        contacts: '',
        note: 'Not full coverage after all',
      },
    })
  })

  it('creates with a key, splitting aliases by commas, and says what is missing', () => {
    expect(
      readCreate({
        ...EMPTY_GRANTOR,
        key: 'grantor_g',
        name: 'Grantor G',
        aliases: 'G fund, G program ',
        note: 'New',
      })
    ).toMatchObject({ ok: true, body: { key: 'grantor_g', aliases: ['G fund', 'G program'] } })
    expect(readCreate({ ...EMPTY_GRANTOR, key: '2bad', name: 'X', note: 'n' })).toEqual({
      ok: false,
      problem: 'The key is a letter, then letters, digits or _ (60 at most)',
    })
    expect(readSave({ ...EMPTY_GRANTOR, name: 'X' })).toEqual({
      ok: false,
      problem: 'A note is required (it is logged)',
    })
    expect(readSave({ ...EMPTY_GRANTOR, note: 'n' })).toEqual({
      ok: false,
      problem: 'Name the grantor',
    })
  })

  it('says why Retire… waits, only for what the read can see (a mapped description)', () => {
    expect(retireBlocked(GRANTOR_A)).toBe(
      '1 CampMinder description still maps to it. Map it to another grantor first.'
    )
    expect(
      retireBlocked({
        ...GRANTOR_A,
        descriptions: [...GRANTOR_A.descriptions, ...GRANTOR_C.descriptions],
      })
    ).toBe('2 CampMinder descriptions still map to it. Map them to another grantor first.')
    // Grants this season don't block it (the server counts open commitments, not ledger lines).
    expect(retireBlocked(GRANTOR_K)).toBeNull()
    expect(retireBlocked(GRANTOR_E)).toBeNull()
  })

  it('reads the season: "—" where no line names the grantor', () => {
    expect([seasonCount(GRANTOR_A), seasonAmount(GRANTOR_A)]).toEqual([61, 44100])
    expect([seasonCount(GRANTOR_E), seasonAmount(GRANTOR_E)]).toEqual([0, null])
    expect(seasonCount({ ...GRANTOR_E, season: null })).toBeNull()
  })

  it('knows a retired grantor and names the CSV', () => {
    expect(isRetired(GRANTOR_F_RETIRED)).toBe(true)
    expect(isRetired(GRANTOR_A)).toBe(false)
    expect(grantorsCsvName(2027)).toBe('camperships-grants-grantors-2027.csv')
  })
})
