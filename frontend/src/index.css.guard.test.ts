/**
 * Guards two "dead Tailwind utility" defects in index.css (#1894, #2027).
 *
 * Both bugs share a shape: a class string exists in source but Tailwind v4
 * generates no rule for it, so the element silently keeps whatever styling
 * it already had. Neither bug fails a render test — the class is present on
 * the DOM node either way — so the only place that can catch it is the
 * stylesheet source itself. This is a source-level assertion for the same
 * reason manageTabs.guard.test.ts is: see reference_frontend_source_grep_tests.
 *
 * #1894 — the forest palette stops at --color-forest-900, so every
 * `forest-950` utility (bg-forest-950, hover:bg-forest-950, etc.) across the
 * 10 consumer files generates nothing.
 *
 * #2027 — .shadow-lodge-sm / .shadow-lodge / .shadow-lodge-lg / .shadow-lodge-xl
 * are hand-written plain-CSS class rules inside @layer utilities, not
 * Tailwind @utility declarations, so v4 has no definition to build a
 * hover:/dark:/etc. variant from. hover:shadow-lodge-lg and friends resolve
 * to no selector at all.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const css = readFileSync(resolve(__dirname, './index.css'), 'utf-8')

function themeBlock(): string {
  const match = css.match(/@theme\s*{([\s\S]*?)\n}/)
  expect(match).not.toBeNull()
  const captured = match?.[1]
  expect(captured).toBeDefined()
  return captured as string
}

describe('index.css — forest-950 token (#1894)', () => {
  it('defines --color-forest-950 inside @theme so forest-950 utilities generate', () => {
    expect(themeBlock()).toMatch(/--color-forest-950:\s*oklch\(/)
  })
})

describe('index.css — lodge-shadow utilities (#2027)', () => {
  const names = ['shadow-lodge-sm', 'shadow-lodge', 'shadow-lodge-lg', 'shadow-lodge-xl']

  names.forEach((name) => {
    it(`declares .${name} with @utility, not a plain class rule, so variants like hover: generate`, () => {
      // Must be an @utility declaration...
      expect(css).toMatch(new RegExp(`@utility ${name}\\s*{`))
      // ...not left behind as a hand-written class selector. The negative
      // lookahead keeps `shadow-lodge` from matching inside
      // `shadow-lodge-sm`/`-lg`/`-xl`.
      expect(css).not.toMatch(new RegExp(`\\n\\s*\\.${name}(?![\\w-])\\s*{`))
    })
  })
})
