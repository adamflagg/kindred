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

describe('index.css — motion groundwork (spec 1a/1b, 2026-08-21)', () => {
  it('narrows .card-lodge to the properties that actually animate — never transition-all (1a)', () => {
    // `transition-all` covered `transform` and geometry, so ANY future card
    // movement (auto-animate, a FLIP, a grid reflow) fought a competing
    // 300ms transition — the smear. The narrowed list keeps every fade that
    // ships today: border-color + box-shadow (the :hover lift), and
    // background-color + opacity, which kindred#2528's drag-signal wash
    // (`bg-primary/20`) and dim (`opacity-40`) animate through on this very
    // class. Dropping either of those two turns a shipping fade into a snap.
    const rule = css.match(/\.card-lodge\s*{([\s\S]*?)\n {2}}/)?.[1] ?? ''
    // Strip comments first — the declaration is what must not say `all`;
    // the comment above it explains WHY and names the phrase.
    const declarations = rule.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(declarations).not.toContain('transition-all')
    expect(declarations).toContain('transition-[border-color,box-shadow,background-color,opacity]')
  })

  it('carries no dead motion CSS (1b sweep)', () => {
    // Each of these had zero references in any .tsx (audited 2026-08-21):
    // .animate-out + fadeOut, the react-hot-toast leftovers (the library
    // animates itself), and the orphaned shimmer keyframes.
    expect(css).not.toMatch(/@keyframes fadeOut/)
    expect(css).not.toMatch(/\.animate-out(?![\w-])/)
    expect(css).not.toMatch(/\.toast-enter(?![\w-])/)
    expect(css).not.toMatch(/\.toast-exit(?![\w-])/)
    expect(css).not.toMatch(/@keyframes toastSlideIn/)
    expect(css).not.toMatch(/@keyframes toastSlideOut/)
    expect(css).not.toMatch(/@keyframes shimmer/)
  })

  it('has no prefers-reduced-motion block (D2/D10 — reduced motion is out of scope by policy)', () => {
    // The one block that existed guarded only .sparkle-material — orphaned
    // and inconsistent with the app's deliberate zero-reduced-motion policy
    // (CLAUDE.md §4 accessibility). If that policy ever changes, remove this
    // assertion in the same PR that adds real reduced-motion support.
    expect(css).not.toMatch(/prefers-reduced-motion/)
  })

  it('drops listbox pointer events for the leave (2530 review finding 1)', () => {
    // Same hazard as the modal: a dropdown fading out at absolute z-50 kept
    // swallowing clicks for 150ms. data-leave is stamped by Headless UI only
    // while the leave transition runs.
    const rule = css.match(/\.listbox-options\s*{([\s\S]*?)\n {2}}/)?.[1] ?? ''
    expect(rule).toContain('data-leave:pointer-events-none')
  })

  it('keeps the live animations the sweep must not touch (D5 fence)', () => {
    // The sparkle ships unchanged (D5), and pulse-glow is referenced by five
    // .tsx files. If this fails, the sweep took a live rule with the dead.
    expect(css).toMatch(/@keyframes sparkle-anim/)
    expect(css).toMatch(/\.sparkle-material(?![\w-])/)
    expect(css).toMatch(/@keyframes pulse-glow/)
    expect(css).toMatch(/\.pending-lock-glow(?![\w-])/)
  })
})
