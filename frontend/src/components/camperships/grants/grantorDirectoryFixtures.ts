/**
 * The grantor directory's fixtures (slice 3, Money › Funders), invented, in the shape of
 * `GrantorsResponse` read with `?include_retired=true&year=2027`. Grantor A is in use (one description,
 * grants this season); Grantor C covers the full cost; Grantor E maps nothing and has no grants;
 * Grantor K is a named fund (full coverage, pays the rest after camp aid, no canteen); Grantor F is retired.
 */
import type { ApiAidGrantor, ApiAidGrantors } from '../../../types/api-types'

function grantor(
  over: Partial<ApiAidGrantor> & Pick<ApiAidGrantor, 'key' | 'name'>
): ApiAidGrantor {
  return {
    aliases: [],
    full_coverage: false,
    covers_canteen: 'unknown',
    pays_after_camp_aid: false,
    eligibility: '',
    contacts: '',
    retired_at: '',
    descriptions: [],
    season: { year: 2027, count: 0, amount: 0 },
    ...over,
  }
}

export const GRANTOR_A = grantor({
  key: 'grantor_a',
  name: 'Grantor A',
  aliases: ['Grantor A program'],
  eligibility: 'First and second summers',
  contacts: 'Test User, test@example.com, 555-0100',
  descriptions: [
    {
      source_id: 'srcgrantora0003',
      description_key: 'keygrantora0003',
      description: 'Grantor A grant',
      source_family: 'other_outside',
    },
  ],
  season: { year: 2027, count: 61, amount: 44100 },
})
export const GRANTOR_C = grantor({
  key: 'grantor_c',
  name: 'Grantor C',
  full_coverage: true,
  eligibility: 'By referral',
  descriptions: [
    {
      source_id: 'srcgrantorc0004',
      description_key: 'keygrantorc0004',
      description: 'Grantor C full-ride program',
      source_family: 'named_fund',
    },
  ],
  season: { year: 2027, count: 4, amount: 27080.5 },
})
export const GRANTOR_E = grantor({ key: 'grantor_e', name: 'Grantor E' })
export const GRANTOR_K = grantor({
  key: 'grantor_k',
  name: 'Grantor K gap-filler award',
  full_coverage: true,
  covers_canteen: 'no',
  pays_after_camp_aid: true,
  eligibility: 'Fills the gap last',
  season: { year: 2027, count: 2, amount: 5400 },
})
export const GRANTOR_F_RETIRED = grantor({
  key: 'grantor_f',
  name: 'Grantor F',
  retired_at: '2026-10-03 17:04:11.000Z',
})

/** The directory's read: retired included (the directory filters them on screen). */
export const GRANTORS_ALL: ApiAidGrantors = {
  grantors: [GRANTOR_A, GRANTOR_C, GRANTOR_E, GRANTOR_F_RETIRED, GRANTOR_K],
}
