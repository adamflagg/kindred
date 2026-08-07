/**
 * Pins the flat-config layering fix from kindred#2098 (root cause of
 * kindred#2063 / kindred#2068, which #2097's jsx-a11y gate should have
 * caught and didn't).
 *
 * ESLint flat config merges a LATER matching config object's severity-only
 * rule value onto an EARLIER matching object's options for that rule — but
 * only across separate config objects in the array. A later key inside the
 * SAME object literal replaces the earlier value outright (plain JS object
 * semantics, nothing ESLint-specific). The 7 jsx-a11y severity overrides in
 * `eslint.config.js` must therefore live in their own config object, layered
 * after the object that spreads `jsxA11y.flatConfigs.recommended.rules` —
 * not folded back into that object's `rules` block alongside the spread.
 *
 * If they're ever folded back in, the options these rules carry (e.g.
 * `no-static-element-interactions`'s `allowExpressionValues`) silently
 * vanish: the rule falls back to its default options, which are stricter,
 * and the effective violation count on unrelated code jumps (42 -> 50 for
 * that rule, at the time of writing) — with no error, no warning, nothing
 * but a bigger warning count next time someone happens to run `eslint`.
 *
 * This runs the real ESLint Node API against the project's actual
 * `eslint.config.js` and inspects the resolved rule config directly — a
 * jsdom render can't see config-resolution behavior, same rationale as
 * `WeekendRosterPage.chunkGraph.test.ts` for the build's chunk graph.
 */
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { ESLint } from 'eslint'

const FRONTEND_ROOT = resolve(import.meta.dirname, '../..')
const CONFIG_PATH = resolve(FRONTEND_ROOT, 'eslint.config.js')

async function calculateRules(): Promise<Record<string, unknown>> {
  const eslint = new ESLint({ overrideConfigFile: CONFIG_PATH, cwd: FRONTEND_ROOT })
  const config = (await eslint.calculateConfigForFile('src/App.tsx')) as {
    rules: Record<string, unknown>
  }
  return config.rules
}

describe('eslint.config.js: jsx-a11y severity overrides layer onto recommended options', () => {
  it('keeps no-static-element-interactions at warn without losing allowExpressionValues', async () => {
    const rules = await calculateRules()
    const rule = rules['jsx-a11y/no-static-element-interactions']
    expect(Array.isArray(rule)).toBe(true)
    const [severity, options] = rule as [number, Record<string, unknown> | undefined]
    expect(severity).toBe(1) // warn — the override object's severity took effect
    expect(options).toMatchObject({ allowExpressionValues: true }) // recommended's options survived it
  })

  it('keeps no-noninteractive-element-interactions at warn without losing its handlers option', async () => {
    const rules = await calculateRules()
    const rule = rules['jsx-a11y/no-noninteractive-element-interactions']
    expect(Array.isArray(rule)).toBe(true)
    const [severity, options] = rule as [number, Record<string, unknown> | undefined]
    expect(severity).toBe(1)
    expect(options).toHaveProperty('handlers')
  })
})
