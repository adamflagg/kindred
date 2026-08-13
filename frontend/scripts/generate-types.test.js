/**
 * Tests for generate-types.js — the generator behind the pocketbase-types
 * freshness gate (kindred#2278).
 *
 * These exist because the gate is only as trustworthy as this script: every
 * path below that returns normally instead of throwing is a path where CI
 * reports "types are stale, regenerate" for something that is not staleness,
 * or — worse — reports success having written an unformatted file over the
 * tracked one. Both are false signals from a check whose entire job is to be
 * a true one.
 *
 * The two pure functions are exported specifically so the convergence
 * behaviour can be driven with synthetic formatter sequences; reproducing a
 * genuine prettier oscillation on demand is not something a test can do.
 */

import { describe, it, expect } from 'vitest'
import { resolve } from 'path'

import { parsePathArg, formatToFixedPoint, CliError, MAX_PASSES } from './generate-types.js'

describe('parsePathArg', () => {
  it('returns the fallback when the flag is absent', () => {
    expect(parsePathArg([], '--db', '/default/data.db')).toBe('/default/data.db')
    expect(parsePathArg(['--output', 'x.ts'], '--db', '/default/data.db')).toBe('/default/data.db')
  })

  it('returns an absolute path unchanged', () => {
    expect(parsePathArg(['--db', '/tmp/scratch/data.db'], '--db', '/default/data.db')).toBe(
      '/tmp/scratch/data.db'
    )
  })

  it('resolves a relative path against the supplied cwd, not the script directory', () => {
    // The CI step passes `--db pocketbase/pb_test_data/data.db` from the repo
    // root while the child process runs with cwd=frontend/. Resolving at parse
    // time against the *caller's* cwd is what makes that work.
    expect(
      parsePathArg(['--db', 'pocketbase/pb_test_data/data.db'], '--db', '/default', '/repo/root')
    ).toBe(resolve('/repo/root', 'pocketbase/pb_test_data/data.db'))
  })

  it('throws CliError with exit code 2 when the flag has no value', () => {
    let caught
    try {
      parsePathArg(['--db'], '--db', '/default/data.db')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(CliError)
    expect(caught.code).toBe(2)
  })
})

describe('formatToFixedPoint', () => {
  /** Drives the loop with a canned sequence of file contents, one per pass. */
  function harness(contents, { statuses = null } = {}) {
    let pass = -1
    return {
      runFormatter: () => {
        pass += 1
        return statuses ? statuses[pass] : 0
      },
      readOutput: () => contents[pass],
      passes: () => pass + 1,
    }
  }

  it('stops as soon as two consecutive passes agree (the real prettier case)', () => {
    // Empirically verified against pocketbase-typegen 1.5.0 + prettier 3.9.6:
    // pass 1 != pass 2, pass 2 == pass 3. Detecting that costs three runs.
    const h = harness(['A', 'B', 'B'])
    expect(formatToFixedPoint(h)).toBe(3)
    expect(h.passes()).toBe(3)
  })

  it('accepts convergence that lands exactly on the last allowed pass', () => {
    const h = harness(['A', 'B', 'C', 'D', 'D'])
    expect(formatToFixedPoint(h)).toBe(5)
    expect(h.passes()).toBe(MAX_PASSES)
  })

  it('throws rather than returning when the output never settles', () => {
    let caught
    try {
      formatToFixedPoint(harness(['A', 'B', 'C', 'D', 'E']))
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(CliError)
    expect(caught.code).toBe(1)
    expect(caught.message).toMatch(/did not settle/)
  })

  it('throws on a period-2 oscillation, which never has two equal neighbours', () => {
    // The scenario the fixed-point comment names: a formatter that flips
    // between two states forever. Returning the last one would make the gate
    // pass or fail on parity alone.
    let caught
    try {
      formatToFixedPoint(harness(['A', 'B', 'A', 'B', 'A']))
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(CliError)
    expect(caught.message).toMatch(/did not settle/)
  })

  it('throws when the formatter itself fails, instead of emitting unformatted output', () => {
    // Row 5: the old code logged "non-fatal" and let the script exit 0, so a
    // prettier crash surfaced in CI as a bogus "types are stale" diff and
    // locally overwrote the tracked file with raw generator output under a
    // "Types generated successfully" banner.
    let caught
    try {
      formatToFixedPoint(harness(['A', 'A'], { statuses: [1, 0] }))
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(CliError)
    expect(caught.code).toBe(1)
    expect(caught.message).toMatch(/prettier/i)
  })

  it('does not read the output after a failed formatter run', () => {
    // Reading it would compare against a half-written file.
    let reads = 0
    let caught
    try {
      formatToFixedPoint({
        runFormatter: () => 1,
        readOutput: () => {
          reads += 1
          return 'A'
        },
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(CliError)
    expect(reads).toBe(0)
  })
})
