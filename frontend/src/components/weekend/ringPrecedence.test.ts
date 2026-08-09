import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

import { resolveRingPrecedence } from './ringPrecedence'
import type { RingPrecedenceInputs } from './ringPrecedence'

describe('resolveRingPrecedence', () => {
  it('is plain when nothing is set', () => {
    expect(resolveRingPrecedence({ dropTarget: false, consentFlagged: false })).toBe('plain')
  })

  it('is consentFlagged when only consentFlagged is set', () => {
    expect(resolveRingPrecedence({ dropTarget: false, consentFlagged: true })).toBe(
      'consentFlagged'
    )
  })

  it('is dropTarget when only dropTarget is set', () => {
    expect(resolveRingPrecedence({ dropTarget: true, consentFlagged: false })).toBe('dropTarget')
  })

  it('prefers dropTarget over consentFlagged when both are set', () => {
    expect(resolveRingPrecedence({ dropTarget: true, consentFlagged: true })).toBe('dropTarget')
  })

  /**
   * kindred#2183 — the map is a reference surface with no placement, so it
   * OMITS `dropTarget` rather than passing a hard-coded `false` the reader has
   * to interpret. An absent drop target must resolve exactly as `false` did.
   */
  describe('a caller with no placement affordance at all', () => {
    it('is plain when nothing else is set either', () => {
      expect(resolveRingPrecedence({ consentFlagged: false })).toBe('plain')
    })

    it('is consentFlagged when the sharing was never consented to', () => {
      expect(resolveRingPrecedence({ consentFlagged: true })).toBe('consentFlagged')
    })
  })

  /**
   * kindred#2179 — the `shared` tier is STRUCK, and the table is three states
   * rather than four.
   *
   * The ring fired on the units DESIGNED to hold several families, so it was
   * on almost all the time; a constant is not a signal. There is no
   * replacement tier — not a subtler ring, not a different colour. The one
   * warning that survives (a second party in a unit classified one-family) is
   * a CHIP in the badge row, on a channel of its own, and deliberately does
   * not come back through this table.
   *
   * Part source read, because part of the deletion is of an INPUT that a
   * removed property cannot be probed for through the signature: passing it is
   * a compile error, and calling with it absent returns 'plain' whether the
   * branch was deleted or merely unreachable. The source anchors are on
   * SYNTAX, never the bare word, so the header can still say in prose what was
   * removed and why — but the behavioural check below is the one that matters,
   * because no regex catches every spelling of a returning tier.
   */
  describe('no shared tier (kindred#2179)', () => {
    const source = readFileSync(resolve(__dirname, 'ringPrecedence.ts'), 'utf-8')

    it('declares no `shared` input, optional or otherwise', () => {
      // `?` sits BETWEEN the identifier and the colon on an optional property,
      // so `shared:` alone is not an anchor: it waves through `shared?:
      // boolean` — which is the shape `dropTarget` already has one line above,
      // and therefore the shape a reintroduction would most naturally take.
      expect(source).not.toMatch(/\bshared\s*\??\s*:/)
    })

    it('names no `shared` state', () => {
      // The union member and any comparison against it. Prose may still name
      // the struck tier in backticks; the string LITERAL may not come back.
      expect(source).not.toMatch(/'shared'/)
    })

    it('ignores a `shared` input even when some caller still passes one', () => {
      // The behavioural half, which no source read can give. A stray input
      // must not resurrect a tier, however the property ends up spelled — and
      // this goes RED the moment `if (shared) return 'shared'` is back,
      // whether or not the regexes above happen to notice the declaration.
      const stale: RingPrecedenceInputs & Record<string, unknown> = {
        dropTarget: false,
        consentFlagged: false,
        shared: true,
      }
      expect(resolveRingPrecedence(stale)).toBe('plain')
    })

    it('resolves to one of exactly three states, whatever it is given', () => {
      const reachable = new Set(
        [
          { dropTarget: false, consentFlagged: false },
          { dropTarget: false, consentFlagged: true },
          { dropTarget: true, consentFlagged: false },
          { dropTarget: true, consentFlagged: true },
        ].map(resolveRingPrecedence)
      )
      expect(reachable).toEqual(new Set(['plain', 'consentFlagged', 'dropTarget']))
    })
  })
})
