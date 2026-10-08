/**
 * Money › Sources fixtures (slice 3): an invented 2027 registry in the shape of `AidSourcesResponse`
 * with `?year=2027` (each row's lines and $ this season). Funders are "Grantor A–E" (tests/CLAUDE.md's
 * generic names); every key, figure, date and note is invented. Reclassify's targets (part 1b) and
 * Money › Sources (part 2a) both read these, so every `AidSourceRow` field is set on some row.
 */
import type { ApiAidSourceRow, ApiAidSources } from '../../../types/api-types'

function source(
  over: Partial<ApiAidSourceRow> & Pick<ApiAidSourceRow, 'id' | 'description'>
): ApiAidSourceRow {
  return {
    description_key: over.id.replace('src', 'key'),
    source_name: 'Camp aid',
    source_family: 'camp_fa',
    funder_type: 'camp',
    counts_as_aid: true,
    counts_toward_budget: true,
    grantor_key: '',
    implied_program_families: ['summer'],
    classified_by: 'config',
    note: '',
    needs_group: false,
    who_paid: 'the camp',
    incentive: false,
    grantor_name: '',
    lines: 0,
    amount: 0,
    last_change: null,
    ...over,
  }
}

/** The camp's own aid for summer sessions: the line most To place lines carry. */
export const CAMP_SUMMER = source({
  id: 'srccampsummer01',
  description: 'Camp aid · Summer',
  lines: 612,
  amount: 1_284_300,
  last_change: { by: 'test@example.com', at: '2026-11-02T17:00:00Z', note: 'Seeded' },
})

export const CAMP_QUEST = source({
  id: 'srccampquest002',
  description: 'Camp aid · Quest',
  implied_program_families: ['quest'],
  lines: 48,
  amount: 96_500,
})

/** An outside grant, mapped to its grantor, and an incentive (D88: the flag, never the funder type). */
export const GRANTOR_A_GRANT = source({
  id: 'srcgrantora0003',
  description: 'Grantor A grant',
  source_name: 'Grantor A',
  source_family: 'other_outside',
  funder_type: 'outside',
  counts_toward_budget: false,
  grantor_key: 'grantor_a',
  grantor_name: 'Grantor A',
  classified_by: 'staff',
  note: 'Funds summer families',
  who_paid: 'another funder',
  incentive: true,
  lines: 22,
  amount: 18_700,
  last_change: {
    by: 'test@example.com',
    at: '2027-03-14T18:30:00Z',
    note: 'Marked as an incentive',
  },
})

/** A named fund that pays in full (the grantor carries its terms, owner 10-06). */
export const GRANTOR_C_FULL_RIDE = source({
  id: 'srcgrantorc0004',
  description: 'Grantor C full-ride program',
  source_name: 'Grantor C',
  source_family: 'named_fund',
  funder_type: 'outside',
  counts_toward_budget: false,
  grantor_key: 'grantor_c',
  grantor_name: 'Grantor C',
  classified_by: 'staff',
  who_paid: 'another funder',
  lines: 3,
  amount: 21_600,
})

/** An outside grant with no grantor yet and no reporting group: "needs a group" (D100; ruling H). */
export const GRANTOR_E_NEW = source({
  id: 'srcgrantore0005',
  description: 'Grantor E grant 2027',
  source_name: 'Grantor E',
  source_family: 'other_outside',
  funder_type: 'outside',
  counts_toward_budget: false,
  implied_program_families: [],
  classified_by: 'staff',
  needs_group: true,
  who_paid: 'another funder',
  lines: 4,
  amount: 3_200,
})

/** New this season and unclassified: the sync added it from an aid category (D128). */
export const UNCLASSIFIED = source({
  id: 'srcbonus0000006',
  description: 'Returning-family bonus 2027',
  source_name: '',
  source_family: 'unclassified',
  funder_type: 'unknown',
  counts_as_aid: false,
  counts_toward_budget: false,
  implied_program_families: [],
  classified_by: 'unclassified',
  who_paid: null,
  lines: 2,
  amount: 400,
})

/** Not aid: a discount CampMinder posts in an aid category. No lines this season. */
export const NOT_AID = source({
  id: 'srcdiscount0007',
  description: 'Sibling discount',
  source_name: 'Sibling discount',
  source_family: 'placeholder',
  funder_type: 'camp',
  counts_as_aid: false,
  counts_toward_budget: false,
  implied_program_families: [],
  lines: null,
  amount: null,
})

export const SOURCES: ApiAidSources = {
  year: 2027,
  sources: [
    CAMP_SUMMER,
    CAMP_QUEST,
    GRANTOR_A_GRANT,
    GRANTOR_C_FULL_RIDE,
    GRANTOR_E_NEW,
    UNCLASSIFIED,
    NOT_AID,
  ],
}
