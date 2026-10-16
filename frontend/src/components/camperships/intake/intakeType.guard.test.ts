/**
 * Form intake's type comes from the kit (kit/csType.ts; design-language §19): a raw `text-[13.5px]` or a bare
 * `text-xs` in intake/ is a size the kit already names (CS_BODY, CS_PMETA / CS_SMALL), and drifts from it when the
 * kit's line-height or ink moves. Source-level, like the other *.guard tests.
 */
import { describe, expect, it } from 'vitest'

const SOURCES = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** A raw pixel font size (`text-[13.5px]`) or a bare `text-xs` in a class string. */
const RAW_SIZE = /(?<![\w-])text-(?:\[\d+(?:\.\d+)?px\]|xs)(?![\w-])/

describe('Form intake sizes its type with the kit', () => {
  it('reads the intake sources (the glob is not empty)', () => {
    expect(Object.keys(SOURCES)).toContain('./IntakeTable.tsx')
  })

  it('draws no raw pixel size and no bare text-xs (use kit/csType.ts)', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([, source]) => RAW_SIZE.test(source))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })
})
