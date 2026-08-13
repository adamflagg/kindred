#!/usr/bin/env node
/**
 * Generate TypeScript types from the PocketBase schema.
 *
 * Run via:
 *   npm run generate-types                                   (from frontend/)
 *   node scripts/generate-types.js
 *   node scripts/generate-types.js --db <path> --output <path>
 *
 * --db and --output default to the existing local-dev behavior (read the
 * worktree's own PocketBase data dir, write the checked-in types file), but
 * the pb-types-freshness CI check (kindred#2278) overrides both to point at
 * a scratch, migrations-only database and a temp output path so it can diff
 * without mutating anything on disk.
 *
 * Note that the defaults describe the *paths*, not the output bytes: unlike
 * the pre-kindred#2278 version, this script also runs prettier, so a bare
 * `npm run generate-types` now normalizes formatting as well as schema.
 *
 * The two pure helpers below are exported for scripts/generate-types.test.js.
 * Everything with an exit code in it lives in main().
 */

import { spawnSync } from 'child_process'
import { join, dirname, isAbsolute, resolve } from 'path'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FRONTEND_DIR = join(__dirname, '..')

const DEFAULT_DB_PATH = join(FRONTEND_DIR, '..', 'pocketbase', 'pb_data', 'data.db')
const DEFAULT_OUTPUT_PATH = join(FRONTEND_DIR, 'src', 'types', 'pocketbase-types.ts')

export const MAX_PASSES = 5

/** An expected failure with a chosen process exit code. */
export class CliError extends Error {
  constructor(message, code = 1) {
    super(message)
    this.name = 'CliError'
    this.code = code
  }
}

// ── Parse --db <path> / --output <path> ────────────────────────────────────
// Relative values resolve against the CALLER's cwd, here, before anything
// spawns. The CI step passes `--db pocketbase/pb_test_data/data.db` from the
// repo root while the child processes below run with cwd=FRONTEND_DIR, so
// resolving late would silently look in the wrong place.
export function parsePathArg(argv, flag, fallback, cwd = process.cwd()) {
  const i = argv.indexOf(flag)
  if (i === -1) return fallback
  const v = argv[i + 1]
  if (!v) {
    throw new CliError(`${flag} requires a path argument`, 2)
  }
  return isAbsolute(v) ? v : resolve(cwd, v)
}

// ── Format to a fixed point ────────────────────────────────────────────────
// Run the formatter until two consecutive passes produce identical bytes,
// rather than trusting a single --write.
//
// pocketbase-typegen's static utility-type boilerplate (the
// `ProcessCreateAndUpdateFields` mapped type with its "Convert FileNameString
// to File" comment) hits a real prettier non-idempotency: one pass on the raw
// generator output lands on a different stable state than a second pass on
// that same output, moving the comment between a leading and a trailing
// placement. Verified empirically against pocketbase-typegen 1.5.0 and
// prettier 3.9.6 (kindred#2278): pass 1 != pass 2, but pass 2 == pass 3 ==
// the checked-in file. It is pure formatter behavior on tool boilerplate, not
// schema-derived, so it reproduces on every regeneration regardless of which
// collections exist. Without this loop the freshness check would be
// permanently red on zero actual drift.
//
// Both abnormal exits THROW rather than returning the last result. This
// script exists to feed a merge gate, and a gate that reports success on
// output it could not actually normalize is worse than no gate: in CI the
// diff would surface as a bogus "types are stale, regenerate" (sending
// someone to fix a schema that is fine), and locally it would overwrite the
// tracked file with unformatted generator output under a success banner.
export function formatToFixedPoint({ runFormatter, readOutput, maxPasses = MAX_PASSES }) {
  let previous = null
  for (let pass = 1; pass <= maxPasses; pass++) {
    if (runFormatter() !== 0) {
      throw new CliError('prettier failed — refusing to emit unformatted types', 1)
    }
    const current = readOutput()
    if (current === previous) return pass
    previous = current
  }
  throw new CliError(
    `prettier did not settle after ${maxPasses} passes — the generated output is oscillating, ` +
      `so this run cannot produce a stable file to diff against`,
    1
  )
}

function main(argv) {
  const dbPath = parsePathArg(argv, '--db', DEFAULT_DB_PATH)
  const outputPath = parsePathArg(argv, '--output', DEFAULT_OUTPUT_PATH)

  console.log('Generating PocketBase types...')
  console.log(`  db:     ${dbPath}`)
  console.log(`  output: ${outputPath}`)

  // ── Step 1: Run pocketbase-typegen against the SQLite schema ─────────────
  // Note: --use-const flag removed; upstream pocketbase-typegen 1.5.0+ generates the Collections enum by default.
  const genResult = spawnSync('npx', ['pocketbase-typegen', '--db', dbPath, '--out', outputPath], {
    cwd: FRONTEND_DIR,
    stdio: 'inherit',
  })
  if (genResult.status !== 0) {
    throw new CliError('pocketbase-typegen failed', genResult.status ?? 1)
  }

  // ── Step 2: Normalize formatting ─────────────────────────────────────────
  // --config is passed explicitly so a run targeting a temp path outside the
  // project tree still gets the repo's own formatting rules.
  const prettierConfig = join(FRONTEND_DIR, '.prettierrc.json')
  console.log('Formatting generated types with prettier...')
  const passes = formatToFixedPoint({
    runFormatter: () =>
      spawnSync('npx', ['prettier', '--config', prettierConfig, '--write', outputPath], {
        cwd: FRONTEND_DIR,
        stdio: 'inherit',
      }).status,
    readOutput: () => readFileSync(outputPath, 'utf8'),
  })
  console.log(`  formatting settled after ${passes} prettier passes`)

  console.log(`✅ Types generated successfully: ${outputPath}`)
}

// Only run when invoked as a script — importing this module (as the tests do)
// must not spawn anything.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (invokedDirectly) {
  try {
    main(process.argv.slice(2))
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`❌ ${err.message}`)
      process.exit(err.code)
    }
    throw err
  }
}
