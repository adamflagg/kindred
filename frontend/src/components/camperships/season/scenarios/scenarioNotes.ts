/**
 * Scenarios' notes (final mock: six, in ONE list): 1-4 are the registry's (`season-scenarios`: Spend, Remaining,
 * Projected, Below the line), 5 and 6 the page's own (Locked, Change colours). The tier, ceiling, equity-class and
 * current-year definitions ride in their headers' and fields' titles now, not in numbered notes.
 */
import type { DefinitionNote } from '../../kit/DefinitionNotes'
import { RULES_FOOTNOTES } from '../rules/rulesLayout'

export const REGISTRY_NOTE = { spend: 1, remaining: 2, projected: 3, below: 4 } as const
export const PAGE_NOTE = { locked: 5, colours: 6 } as const

export const SCENARIO_PAGE_NOTES: readonly DefinitionNote[] = [
  {
    n: PAGE_NOTE.locked,
    text: 'Locked: a posted round read it. Round 1 locks the bands, Round 1 %, minimum, equity and income counting; Round 2 locks the cap.',
  },
  {
    n: PAGE_NOTE.colours,
    text: 'Change colours: green leaves more money, amber less. An edited setting is amber, its old value in its title. In Compare, amber marks a setting unlike the rules in effect.',
  },
]

const rules = (n: number) => RULES_FOOTNOTES.find((note) => note.n === n)?.text ?? ''

/** The words that left the notes for a header's or field's native title (the mock's story): read from the Rules tab's
 * own footnotes, so the two tabs say the same thing and cannot drift. */
export const TITLE_WORDS = {
  tier: rules(2),
  ceiling: `${rules(3)} Empty = no ceiling.`,
  equityClass: rules(6),
} as const
