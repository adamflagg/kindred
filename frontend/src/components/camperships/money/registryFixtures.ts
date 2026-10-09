/**
 * Money › Funders' reads, invented, in the server's shapes (`AidSourcesResponse` with `?year=2027`,
 * `FundingSourcesResponse`). Part 2a's own set: it does not lean on part 1b's `sourcesFixtures.ts`.
 * "Grantor A–F", "Pool A/B"; ids made up. Needs a group: Grantor E (4 lines this season) and
 * Grantor C (none), so the chip reads "Needs a group 2 · 1 with lines this season".
 */
import type {
  ApiAidFundingSource,
  ApiAidFundingSources,
  ApiAidSourceRow,
  ApiAidSources,
} from '../../../types/api-types'

function source(over: Partial<ApiAidSourceRow> & Pick<ApiAidSourceRow, 'id' | 'description'>) {
  const row: ApiAidSourceRow = {
    description_key: `key${over.id}`,
    source_name: '',
    source_family: 'other_outside',
    funder_type: 'outside',
    counts_as_aid: true,
    counts_toward_budget: false,
    grantor_key: '',
    implied_program_families: [],
    classified_by: 'staff',
    note: '',
    needs_group: false,
    who_paid: 'another funder',
    incentive: false,
    grantor_name: '',
    lines: 0,
    amount: 0,
    last_change: null,
    ...over,
  }
  return row
}

export const REG_CAMP_SUMMER = source({
  id: 'srccampsummer01',
  description: 'Camp aid · Summer',
  source_name: 'Camp aid',
  source_family: 'camp_fa',
  funder_type: 'camp',
  counts_toward_budget: true,
  implied_program_families: ['summer'],
  classified_by: 'config_file',
  who_paid: 'the camp',
  lines: 612,
  amount: 541200,
})
export const REG_GRANTOR_A_GRANT = source({
  id: 'srcgrantora0003',
  description: 'Grantor A grant',
  source_name: 'Grantor A',
  grantor_key: 'grantor_a',
  grantor_name: 'Grantor A',
  implied_program_families: ['summer'],
  note: 'Funds summer families',
  incentive: true,
  lines: 61,
  amount: 98400,
  last_change: {
    by: 'finance@example.com',
    at: '2026-09-30T17:00:00Z',
    note: 'funds weekend families too',
  },
})
export const GRANTOR_C_PROGRAM = source({
  id: 'srcgrantorc0004',
  description: 'Grantor C full-ride program',
  source_name: 'Grantor C',
  source_family: 'named_fund',
  grantor_key: 'grantor_c',
  grantor_name: 'Grantor C',
  needs_group: true,
})
export const REG_GRANTOR_E_NEW = source({
  id: 'srcgrantore0005',
  description: 'Grantor E grant 2027',
  source_name: 'Grantor E',
  needs_group: true,
  lines: 4,
  amount: 3200,
})
export const REG_NOT_AID = source({
  id: 'srcsiblingdisc1',
  description: 'Sibling discount',
  source_name: 'Sibling discount',
  source_family: 'placeholder',
  funder_type: 'camp',
  counts_as_aid: false,
  who_paid: 'the camp',
  classified_by: 'config_file',
  lines: 30,
  amount: 9000,
})
export const REG_UNCLASSIFIED = source({
  id: 'srcunclassified',
  description: 'Returning-family bonus 2027',
  source_family: 'unclassified',
  funder_type: 'unknown',
  counts_as_aid: false,
  classified_by: 'unclassified',
  who_paid: null,
  lines: 2,
  amount: 400,
})

export const SOURCES_2027: ApiAidSources = {
  year: 2027,
  sources: [
    REG_CAMP_SUMMER,
    REG_GRANTOR_A_GRANT,
    GRANTOR_C_PROGRAM,
    REG_GRANTOR_E_NEW,
    REG_NOT_AID,
    REG_UNCLASSIFIED,
  ],
}

function funding(
  row: ApiAidSourceRow,
  over: Partial<ApiAidFundingSource> = {}
): ApiAidFundingSource {
  return {
    source_id: row.id,
    description_key: row.description_key,
    name: row.source_name,
    funder_type: 'outside',
    editable: true,
    incentive: row.incentive ?? false,
    group: null,
    group_label: '',
    needs_group: row.needs_group ?? false,
    families: [...row.implied_program_families],
    lines: row.lines ?? null,
    amount: row.amount ?? null,
    last_change: row.last_change ?? null,
    ...over,
  }
}

/** The pools are the rules' (labels from the rules' budget section); only outside sources are listed. */
export const FUNDING_SOURCES_2027: ApiAidFundingSources = {
  year: 2027,
  groups: [
    { key: 'pool_a', label: 'Pool A', kind: 'summer' },
    { key: 'pool_b', label: 'Pool B', kind: 'families' },
  ],
  sources: [
    funding(REG_GRANTOR_A_GRANT, { group: 'pool_a', group_label: 'Pool A' }),
    funding(GRANTOR_C_PROGRAM),
    funding(REG_GRANTOR_E_NEW),
  ],
  // The server's D159 sentence exactly as main sends it once PR A has merged (PR A trues up
  // "tonight's sync" to "the next ledger sync"; review R3-19; owner-approved V1 wording).
  group_change_warning: 'Changing this re-places household-level lines on the next ledger sync.',
}
