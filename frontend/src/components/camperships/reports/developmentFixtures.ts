/**
 * Reports › Development fixtures (slice 4): an invented report in the shape of `DevelopmentResponse`.
 * Groups and funders carry invented labels ("Pool A", "Grantor A"); every figure is invented. No row
 * names a family (D66): the shapes carry none.
 */
import type {
  ApiAidDevelopment,
  ApiAidDevelopmentColumn,
  ApiAidDevelopmentRow,
} from '../../../types/api-types'

const column = (over: Partial<ApiAidDevelopmentColumn>): ApiAidDevelopmentColumn => ({
  season: 2027,
  basis: 'P',
  as_of: '2027-06-03',
  basis_unconfirmed: false,
  label: '2027',
  not_rebuilt: [],
  ...over,
})

const row = (over: Partial<ApiAidDevelopmentRow>): ApiAidDevelopmentRow => ({
  key: 'total_awards',
  section: 'money',
  label: 'Total Awards Granted',
  group: null,
  unit: 'dollars',
  definition: '',
  values: [null, null, null, null],
  ...over,
})

export const DEVELOPMENT: ApiAidDevelopment = {
  year: 2027,
  figures_on: '2027-06-03',
  groups: [
    { key: 'pool_a', label: 'Pool A', kind: 'summer' },
    { key: 'pool_b', label: 'Pool B', kind: 'families' },
  ],
  columns: [
    column({
      season: 2025,
      basis: 'r',
      as_of: '2025-09-29',
      basis_unconfirmed: true,
      label: '2025 (as reported)',
    }),
    column({ season: 2026, basis: 'r', as_of: '2026-09-29', label: '2026 (as reported)' }),
    column({ season: 2027, basis: 'P', as_of: '2027-06-03', label: '2027' }),
    column({
      season: 2027,
      basis: 'P',
      as_of: '2027-03-09',
      label: '2027 as of Mar 9',
      not_rebuilt: ['declined_insufficient'],
    }),
  ],
  rows: [
    row({ key: 'total_awards', group: 'pool_a', values: [800000, 820000, 2000, 1500] }),
    row({ key: 'total_awards', group: 'pool_b', values: [100000, 110000, 500, 300] }),
    row({
      key: 'total_awards',
      group: null,
      definition: 'Every award, the camp’s and outside grants',
      values: [900000, 930000, 2500, 1800],
    }),
    row({
      key: 'camp_awards',
      label: 'Camp awards',
      group: 'pool_a',
      values: [700000, 720000, 1800, 1300],
    }),
    row({
      key: 'camp_awards',
      label: 'Camp awards',
      group: null,
      values: [800000, 820000, 2200, 1600],
    }),
    row({
      key: 'incentive_awards',
      label: 'Incentive awards',
      group: null,
      values: [50000, 60000, 100, 80],
    }),
    row({
      key: 'need_met',
      label: '% of need met',
      group: 'pool_a',
      unit: 'percent',
      values: [null, 76.5, 61.2, 54],
    }),
    row({
      key: 'recipients',
      section: 'counts',
      label: 'Recipients',
      group: 'pool_a',
      unit: 'count',
      definition: 'People with an award this season',
      values: [10, 11, 12, 9],
    }),
    row({
      key: 'recipients',
      section: 'counts',
      label: 'Recipients',
      group: 'pool_b',
      unit: 'count',
      definition: 'People with an award this season',
      values: [4, 5, 6, 3],
    }),
    row({
      key: 'recipients',
      section: 'counts',
      label: 'Recipients',
      group: null,
      unit: 'count',
      definition: 'People with an award this season',
      values: [14, 16, 18, 12],
    }),
    row({
      key: 'first_time',
      section: 'counts',
      label: 'First-time',
      group: 'pool_a',
      unit: 'count',
      definition: 'No summer session at camp in any earlier season from 2017',
      values: [null, null, 1, 1],
    }),
    row({
      key: 'first_time',
      section: 'counts',
      label: 'First-time',
      group: 'pool_b',
      unit: 'count',
      definition: 'No family camp in any earlier season',
      values: [null, null, 2, 2],
    }),
    row({
      key: 'gender_recipients',
      section: 'counts',
      label: 'Gender, campers who got money: girl',
      group: 'pool_a',
      unit: 'count',
      values: [null, null, 5, 4],
    }),
    row({
      key: 'declined_insufficient',
      section: 'appeals',
      label: 'Declined enrollment for insufficient aid',
      group: null,
      unit: 'count',
      values: [0, 0, 3, null],
    }),
    row({
      key: 'cancelled_after_award',
      section: 'appeals',
      label: 'Cancelled after an award',
      group: null,
      unit: 'count',
      values: [1, 1, 2, null],
    }),
  ],
  sources: [
    {
      source_key: '',
      name: "The camp's awards",
      who_paid: 'the camp',
      incentive: false,
      group: 'pool_a',
      group_label: 'Pool A',
      amount: 1500,
      awards: 1,
    },
    {
      source_key: 'funder:grantor_a',
      name: 'Grantor A',
      who_paid: 'another funder',
      incentive: true,
      group: 'pool_a',
      group_label: 'Pool A',
      amount: 500,
      awards: 1,
    },
  ],
  not_built: [
    {
      figure: 'rebuild',
      reason:
        "The dashboard's approximate rebuild of 2022–2025 (≈) waits on the 2017–2024 ledger backfill; those seasons show as reported, except their age lines, which are the dashboard's by age (D158)",
    },
  ],
}

/** The live read: no on-demand column, so the first three columns only (the fourth is `?column=`'s). */
export const DEVELOPMENT_LIVE: ApiAidDevelopment = {
  ...DEVELOPMENT,
  columns: DEVELOPMENT.columns.slice(0, 3),
  rows: DEVELOPMENT.rows.map((r) => ({ ...r, values: r.values.slice(0, 3) })),
}

/** The budget row the Development read sends beside the money lines (API proposal 2): dollars, no group. */
export const BUDGET_ROW: ApiAidDevelopmentRow = row({
  key: 'budget',
  label: 'Budget',
  group: null,
  values: [1000000, 1050000, 1200000],
})
