/**
 * A rules document for the sandbox's tests: RULES_DOCUMENT's uneven bands ($0–$40,000, $40,001–$70,000, $70,001 and
 * up), a "general" table that is its own (90/60/20; cap 95/80/50) and a "teen" table that inherits it with its own
 * tier-3 Round 1 % (25), and two criteria. Every value is invented.
 */
import type { ApiAidRulesDocument } from '../../../../types/api-types'
import { RULES_DOCUMENT } from '../rules/rulesFixtures'

const criterion = (key: string, label: string, enabled: boolean) => ({
  key,
  label,
  source: 'household',
  field: key,
  also_fields: [],
  match: 'equals_any',
  values: ['yes'],
  min_value: null,
  enabled,
})

export const SANDBOX_DOC = {
  ...RULES_DOCUMENT,
  equity: {
    criteria: [
      criterion('unemployment', 'Unemployment', true),
      criterion('single_parent', 'Single parent', false),
    ],
    weights: {
      general: { unemployment: '0.5', single_parent: '1' },
      teen: { unemployment: '0.5', single_parent: '0.5' },
    },
    aggregation: 'ceil',
    max_shift: null,
  },
  award_tables: {
    general: {
      inherits: null,
      tiers: { '1': { r1_pct: '90' }, '2': { r1_pct: '60' }, '3': { r1_pct: '20' } },
      overrides: {},
    },
    teen: { inherits: 'general', tiers: {}, overrides: { '3': { r1_pct: '25' } } },
  },
  round2: {
    ...RULES_DOCUMENT.round2,
    tables: {
      general: {
        inherits: null,
        tiers: { '1': { total_pct: '95' }, '2': { total_pct: '80' }, '3': { total_pct: '50' } },
        overrides: {},
      },
      teen: { inherits: 'general', tiers: {}, overrides: {} },
    },
  },
} as ApiAidRulesDocument
