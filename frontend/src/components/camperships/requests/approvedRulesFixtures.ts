/**
 * An approved-rules read in the shape the server sends (`ApprovedRulesOut`): the `programs` section's
 * content is the rules' `programs` map of `ProgramProfile`s, each naming itself with a `label`; the
 * `budget` section's `pools` name the budget pools the same way.
 * Program keys and labels are the 2026 rules'; every figure is invented.
 */
import type { ApiAidApprovedRules } from '../../../types/api-types'

const profile = (label: string, pool: string) => ({
  label,
  session_cm_ids: [],
  session_types: [],
  r1_table: 'general',
  equity_class: null,
  budget_pool: pool,
  cost_source: 'catalog',
  open_to_aid: true,
})

export const APPROVED_RULES_2026: ApiAidApprovedRules = {
  year: 2026,
  version: 3,
  sections: [
    {
      section: 'income',
      version: 3,
      state: 'locked',
      approved_by: 'Test User',
      approved_at: '2026-01-10T12:00:00Z',
      note: null,
      locked_at: '2026-02-01T12:00:00Z',
      content: { basis: 'gross' },
    },
    {
      section: 'programs',
      version: 3,
      state: 'approved',
      approved_by: 'Test User',
      approved_at: '2026-01-10T12:00:00Z',
      note: null,
      locked_at: null,
      content: {
        summer: profile('Summer', 'pool_a'),
        tbm: profile('TBM', 'pool_a'),
        family_camp: profile('Family camp', 'pool_b'),
        womens_weekend: profile("Women's weekend", 'pool_b'),
        mens_weekend: profile("Men's weekend", 'pool_b'),
      },
    },
    {
      section: 'budget',
      version: 3,
      state: 'approved',
      approved_by: 'Test User',
      approved_at: '2026-01-10T12:00:00Z',
      note: null,
      locked_at: null,
      content: {
        total: 100000,
        pools: {
          pool_a: { label: 'Pool A', share_pct: 80 },
          pool_b: { label: 'Pool B', share_pct: 20 },
        },
      },
    },
    {
      section: 'milestones',
      version: null,
      state: 'draft',
      approved_by: null,
      approved_at: null,
      note: null,
      locked_at: null,
      content: null,
    },
  ],
}
