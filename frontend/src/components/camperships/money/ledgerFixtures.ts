/**
 * The Ledger tab's posted totals (F10), invented, in the shape of `SummaryResponse`, and an
 * approved-rules read whose programs name themselves differently from their keys, so a test can
 * tell the rules' words from a key spelled out.
 */
import type { ApiAidApprovedRules, ApiAidSummary } from '../../../types/api-types'
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
