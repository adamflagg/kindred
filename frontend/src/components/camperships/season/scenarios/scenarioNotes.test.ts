import { describe, expect, it } from 'vitest'

import { RULES_FOOTNOTES } from '../rules/rulesLayout'
import { PAGE_NOTE, REGISTRY_NOTE, SCENARIO_PAGE_NOTES, TITLE_WORDS } from './scenarioNotes'

// The approved final mock: six notes in ONE list (Spend, Remaining, Projected, Below the line, Locked, Change colours).
describe('the notes (final mock: 11 → 6)', () => {
  it('numbers the four registry notes first, then the two page notes 5 and 6', () => {
    expect(Object.values(REGISTRY_NOTE)).toEqual([1, 2, 3, 4])
    expect(REGISTRY_NOTE).toEqual({ spend: 1, remaining: 2, projected: 3, below: 4 })
    expect(PAGE_NOTE).toEqual({ locked: 5, colours: 6 })
    expect(SCENARIO_PAGE_NOTES.map((n) => n.n)).toEqual([5, 6])
  })

  it("says Locked and Change colours in the mock's words, one line each with a bold term first", () => {
    expect(SCENARIO_PAGE_NOTES.map((n) => n.text)).toEqual([
      'Locked: a posted round read it. Round 1 locks the bands, Round 1 %, minimum, equity and income counting; Round 2 locks the cap.',
      'Change colours: green leaves more money, amber less. An edited setting is amber, its old value in its title. In Compare, amber marks a setting unlike the rules in effect.',
    ])
    for (const note of SCENARIO_PAGE_NOTES) expect(note.text).toMatch(/^[A-Z][a-z ]+:/)
  })

  it("takes the Tier, Income ceiling and equity-class title words from the Rules tab's own footnotes", () => {
    const rules = (n: number) => RULES_FOOTNOTES.find((note) => note.n === n)?.text
    expect(TITLE_WORDS.tier).toBe(rules(2))
    expect(TITLE_WORDS.ceiling).toBe(`${rules(3)} Empty = no ceiling.`)
    expect(TITLE_WORDS.equityClass).toBe(rules(6))
  })
})
