/**
 * Parity: the board's name -> filing match (kindred#2839 follow-up) against
 * the shared vectors in `tests/fixtures/jotform_filer_match_cases.json`.
 *
 * The server folds each filing's names into `suggest_write_in`'s exact tiers
 * and sends them; this side folds what staff type, scores it with the same
 * Jaro-Winkler, and decides. `test_jotform_filer_match_parity.py` reads the
 * same file and checks the server's half, so neither side can drift.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { SIMILAR_THRESHOLD, foldName, jaroWinkler, matchFiler } from './filerMatch'

interface FixtureFiling {
  first: string
  last: string
  nametag: string
  tiers: string[][]
}

interface Fixture {
  similar_threshold: number
  fold: Array<[string, string]>
  jaro_winkler: Array<[string, string, number]>
  match: Array<{
    name: string
    typed: string
    filings: string[]
    expect: { kind: 'exact' | 'similar'; filing: number } | { kind: 'none' }
  }>
  filings: Record<string, FixtureFiling>
}

const FIXTURE_PATH = resolve(__dirname, '../../../../tests/fixtures/jotform_filer_match_cases.json')
const cases = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as Fixture

describe('filerMatch — parity with the server', () => {
  it("uses the server's similar-name threshold", () => {
    expect(SIMILAR_THRESHOLD).toBe(cases.similar_threshold)
  })

  it.each(cases.fold)('folds %j', (raw, folded) => {
    expect(foldName(raw)).toBe(folded)
  })

  it.each(cases.jaro_winkler)('scores %j against %j', (a, b, score) => {
    expect(jaroWinkler(a, b)).toBeCloseTo(score, 12)
  })

  it.each(cases.match)('$name', (c) => {
    const filings = c.filings.map((key, index) => {
      const filing = cases.filings[key]
      if (filing === undefined) throw new Error(`no fixture filing ${key}`)
      return { submissionId: `f${String(index)}`, nameTiers: filing.tiers }
    })
    const result = matchFiler(c.typed, filings)
    if (c.expect.kind === 'none') {
      expect(result).toBeNull()
    } else {
      expect(result).toEqual({ kind: c.expect.kind, submissionId: `f${String(c.expect.filing)}` })
    }
  })
})
