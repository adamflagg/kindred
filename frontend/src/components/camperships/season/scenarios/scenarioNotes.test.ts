import { describe, expect, it } from 'vitest'

import { RULES_FOOTNOTES } from '../rules/rulesLayout'
import { PAGE_NOTE, REGISTRY_NOTE, SCENARIO_PAGE_NOTES } from './scenarioNotes'

describe('the notes (§S5 K)', () => {
  it('numbers the four registry notes first, then the page notes 5–11', () => {
    expect(Object.values(REGISTRY_NOTE)).toEqual([1, 2, 3, 4])
    expect(SCENARIO_PAGE_NOTES.map((n) => n.n)).toEqual([5, 6, 7, 8, 9, 10, 11])
    expect(PAGE_NOTE.colours).toBe(11)
  })

  it('takes notes 6–8 from the Rules tab verbatim, so the two tabs cannot drift', () => {
    const rules = (n: number) => RULES_FOOTNOTES.find((note) => note.n === n)?.text
    expect(SCENARIO_PAGE_NOTES.slice(1, 4).map((n) => n.text)).toEqual([
      rules(2),
      rules(3),
      rules(7),
    ])
  })

  it('says "priced", never "projected", for a kept option’s line, and the colours rule', () => {
    expect(SCENARIO_PAGE_NOTES[5]?.text).toBe(
      "In Compare, amber marks a setting that differs from the rules in effect. Every column is priced on the same applications, now; a kept option's 'kept …' line is what it priced the day it was kept."
    )
    expect(SCENARIO_PAGE_NOTES[6]?.text).toBe(
      'Change colours: a money change against the starting point is green when it leaves more money (Remaining up, spend down) and amber when it leaves less. A changed setting stays amber: it only marks an edit. The dotted mark on a bar is where the starting point sits.'
    )
  })
})
