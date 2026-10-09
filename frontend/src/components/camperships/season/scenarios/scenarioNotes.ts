/**
 * Scenarios' notes (§S5 K): 1–4 are the registry's (`season-scenarios`: Spend, Remaining, Projected, Below the
 * line), 5–11 the page's own. Notes 6–8 are the Rules tab's notes 2, 3 and 6, read from RULES_FOOTNOTES, so the
 * two tabs say the same thing and can't drift. The mock's note 12 ("Illustrative figures") is mock-only.
 */
import type { DefinitionNote } from '../../kit/DefinitionNotes'
import { RULES_FOOTNOTES } from '../rules/rulesLayout'

export const REGISTRY_NOTE = { spend: 1, remaining: 2, projected: 3, below: 4 } as const
export const PAGE_NOTE = {
  locked: 5,
  tier: 6,
  ceiling: 7,
  equityClass: 8,
  readOnly: 9,
  compare: 10,
  colours: 11,
} as const

const rules = (n: number) => RULES_FOOTNOTES.find((note) => note.n === n)?.text ?? ''

export const SCENARIO_PAGE_NOTES: readonly DefinitionNote[] = [
  {
    n: PAGE_NOTE.locked,
    text: "Locked: a posted round read it, so the sections it read are locked in the rules (the Rules tab's Locked pill). Here, the Round 1 %, the bands, the minimum, equity and income counting grey out once Round 1 posts, and the Round 1 + 2 cap once Round 2 posts.",
  },
  { n: PAGE_NOTE.tier, text: rules(2) },
  { n: PAGE_NOTE.ceiling, text: rules(3) },
  { n: PAGE_NOTE.equityClass, text: rules(6) },
  {
    n: PAGE_NOTE.readOnly,
    text: 'Read-only: the current-year weight is 100% less the prior-year weight.',
  },
  {
    n: PAGE_NOTE.compare,
    text: "In Compare, amber marks a setting that differs from the rules in effect. Every column is priced on the same applications, now; a kept option's 'kept …' line is what it priced the day it was kept.",
  },
  {
    n: PAGE_NOTE.colours,
    text: 'Change colours: a money change against the starting point is green when it leaves more money (Remaining up, spend down) and amber when it leaves less. A changed setting stays amber: it only marks an edit. The dotted mark on a bar is where the starting point sits.',
  },
]
