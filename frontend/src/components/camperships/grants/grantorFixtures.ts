/**
 * Grantor directory fixtures (slice 3), invented: "Grantor A–F". Grantor C is a full-coverage
 * grantor; Grantor F is retired. Ids and keys are made up; no real funder is named.
 */
import type { ApiAidGrantor, ApiAidGrantors } from '../../../types/api-types'

export function grantor(
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
    season: null,
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
})
export const GRANTOR_C = grantor({
  key: 'grantor_c',
  name: 'Grantor C',
  full_coverage: true,
  covers_canteen: 'no',
  pays_after_camp_aid: true,
  descriptions: [
    {
      source_id: 'srcgrantorc0004',
      description_key: 'keygrantorc0004',
      description: 'Grantor C full-ride program',
      source_family: 'named_fund',
    },
  ],
})
export const GRANTOR_E = grantor({ key: 'grantor_e', name: 'Grantor E' })
export const GRANTOR_F_RETIRED = grantor({
  key: 'grantor_f',
  name: 'Grantor F',
  retired_at: '2026-10-03',
})

export const GRANTORS: ApiAidGrantors = { grantors: [GRANTOR_A, GRANTOR_C, GRANTOR_E] }
export const GRANTORS_ALL: ApiAidGrantors = {
  grantors: [...GRANTORS.grantors, GRANTOR_F_RETIRED],
}
