/**
 * The Ledger tab's posted totals (F10), invented, in the shape of `SummaryResponse`, and an
 * approved-rules read whose programs name themselves differently from their keys, so a test can
 * tell the rules' words from a key spelled out.
 */
import type {
  ApiAidApprovedRules,
  ApiAidLedgerLines,
  ApiAidMoneyLedger,
  ApiAidSummary,
} from '../../../types/api-types'
import { APPROVED_RULES_2026 } from '../requests/approvedRulesFixtures'

export const SUMMARY: ApiAidSummary = {
  year: 2027,
  as_of: null,
  basis: 'posted',
  total_aid: 734500,
  counts_toward_budget: 612540,
  by_level: { decision: 640180, override: 12400, ambiguous: 9800, novel_level: 100 },
  by_level_basis: 'placements',
  cells: [
    { program: 'summer', source_family: 'camp_fa', amount: 541200, postings: 612, households: 301 },
    {
      program: 'summer',
      source_family: 'other_outside',
      amount: 98400,
      postings: 61,
      households: 58,
    },
    {
      program: 'family_camp',
      source_family: 'camp_fa',
      amount: 48500,
      postings: 22,
      households: 20,
    },
  ],
  undated_postings: 0,
  // PR A's F10 split (money-v2's pivot): per program by who paid, and the camp-aid shares. The
  // server's sort is by program key; the screen orders by the rules (R3-10). Shapes as
  // `ProgramSplit` / `CampAidLevel`; every figure invented.
  by_program: [
    {
      program: 'ambiguous',
      camp_aid: 9800,
      outside_grants: 0,
      unclassified: 0,
      total: 9800,
      postings: 14,
      households: 12,
    },
    {
      program: 'family_camp',
      camp_aid: 48500,
      outside_grants: 16300,
      unclassified: 0,
      total: 64800,
      postings: 40,
      households: 31,
    },
    {
      program: 'summer',
      camp_aid: 541200,
      outside_grants: 98400,
      unclassified: 0,
      total: 639600,
      postings: 673,
      households: 320,
    },
    {
      program: 'unattributed',
      camp_aid: 0,
      outside_grants: 20300,
      unclassified: 0,
      total: 20300,
      postings: 9,
      households: 8,
    },
  ],
  camp_aid: 599500,
  outside_grants: 135000,
  unclassified: 0,
  camp_aid_levels: [
    { group: 'placed', amount: 545545, share: 0.91 },
    { group: 'household', amount: 41965, share: 0.07 },
    { group: 'not_placed', amount: 11990, share: 0.02 },
  ],
}

/** A past day reads Go's attribution, not the dashboard's placements (`by_level_basis`). */
export const SUMMARY_PAST: ApiAidSummary = {
  ...SUMMARY,
  as_of: '2027-05-01',
  by_level_basis: 'attribution',
  undated_postings: 2,
}

/** A season with a line nobody classified yet: the pivot shows its Unclassified column. */
export const SUMMARY_UNCLASSIFIED: ApiAidSummary = {
  ...SUMMARY,
  total_aid: 734900,
  unclassified: 400,
  by_program: (SUMMARY.by_program ?? []).map((row) =>
    row.program === 'unattributed'
      ? { ...row, unclassified: 400, total: row.total + 400, postings: row.postings + 2 }
      : row
  ),
}

const programs = APPROVED_RULES_2026.sections.find((s) => s.section === 'programs')

/** 2027's approved rules, naming summer "Summer Sessions" and family_camp "Family Camp Weekends". */
export const RULES_2027: ApiAidApprovedRules = {
  ...APPROVED_RULES_2026,
  year: 2027,
  sections:
    programs === undefined
      ? []
      : [
          {
            ...programs,
            content: {
              summer: { label: 'Summer Sessions', budget_pool: 'pool_a' },
              family_camp: { label: 'Family Camp Weekends', budget_pool: 'pool_b' },
            },
          },
        ],
}
/**
 * Money › Ledger's family read (part 2b), invented: names from tests/CLAUDE.md, ids from 1000001. The
 * server's totals are NOT the rows' sum (the other families aren't drawn), so a test can tell a
 * figure read from one added up.
 */
export const LEDGER: ApiAidMoneyLedger = {
  year: 2027,
  as_of: null,
  as_of_axis: null,
  rows: [
    {
      household_cm_id: 1000001,
      family_households: [1000001],
      display_name: 'Johnson',
      label: 'Pat Johnson',
      label_tiebreak: 'Riverside, CA',
      campers: ['Emma Johnson', 'Samuel Johnson'],
      in_campminder_net: 3920,
      outside_grants: 250,
      lines: 6,
      reversed_lines: 2,
      level: 'household',
    },
    {
      household_cm_id: 1000002,
      family_households: [1000002],
      display_name: 'Garcia',
      label: 'Liam & Olivia Garcia',
      label_tiebreak: '',
      campers: ['Liam Garcia'],
      in_campminder_net: 1820,
      outside_grants: 1000,
      lines: 4,
      reversed_lines: 0,
      level: 'left',
    },
    {
      household_cm_id: 1000003,
      family_households: [1000003],
      display_name: 'Chen',
      label: '',
      label_tiebreak: '',
      campers: ['Olivia Chen'],
      in_campminder_net: 3100,
      outside_grants: 0,
      lines: 3,
      reversed_lines: 1,
      level: null,
    },
    {
      household_cm_id: 1000004,
      family_households: [1000004],
      display_name: 'Sam',
      label: 'Pat Johnson',
      label_tiebreak: 'Lakeside, CA',
      campers: ['Riley Sam'],
      in_campminder_net: 900,
      outside_grants: 0,
      lines: 1,
      reversed_lines: 0,
      level: 'no_request',
    },
  ],
  in_campminder_net: 615460,
  outside_grants: 141450,
}

/** The lines behind In CampMinder (net), as `GET …/ledger/lines?total=in_campminder_net` sends them. */
export const LEDGER_LINES: ApiAidLedgerLines = {
  year: 2027,
  as_of: null,
  as_of_axis: null,
  total: 'in_campminder_net',
  amount: 615460,
  lines: [
    {
      transaction_cm_id: 3000001,
      household_cm_id: 1000001,
      family_household_cm_id: 1000001,
      family_name: 'Johnson',
      camper: '',
      description: 'Camp aid · Summer',
      source_family: 'camp_fa',
      program: 'summer',
      amount: 3620,
      posted_on: '2027-05-14',
      is_reversed: false,
      reversed_on: null,
      level: 'household',
    },
    {
      transaction_cm_id: 3000002,
      household_cm_id: 1000001,
      family_household_cm_id: 1000001,
      family_name: 'Johnson',
      camper: 'Emma Johnson',
      description: 'Camp aid · Summer',
      source_family: 'camp_fa',
      program: 'summer',
      amount: 1420,
      posted_on: '2027-03-01',
      is_reversed: true,
      reversed_on: '2027-03-09',
      level: null,
    },
  ],
}
