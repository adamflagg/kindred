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
 */

import { spawnSync } from 'child_process'
import { join, dirname, isAbsolute, resolve } from 'path'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FRONTEND_DIR = join(__dirname, '..')

const DEFAULT_DB_PATH = join(FRONTEND_DIR, '..', 'pocketbase', 'pb_data', 'data.db')
const DEFAULT_OUTPUT_PATH = join(FRONTEND_DIR, 'src', 'types', 'pocketbase-types.ts')

// ── Parse --db <path> / --output <path> ────────────────────────────────────
function parsePathArg(argv, flag, fallback) {
  const i = argv.indexOf(flag)
  if (i === -1) return fallback
  const v = argv[i + 1]
  if (!v) {
    console.error(`❌ ${flag} requires a path argument`)
    process.exit(2)
  }
  return isAbsolute(v) ? v : resolve(process.cwd(), v)
}

const argv = process.argv.slice(2)
const DB_PATH = parsePathArg(argv, '--db', DEFAULT_DB_PATH)
const OUTPUT_PATH = parsePathArg(argv, '--output', DEFAULT_OUTPUT_PATH)

console.log('Generating PocketBase types...')
console.log(`  db:     ${DB_PATH}`)
console.log(`  output: ${OUTPUT_PATH}`)

// ── Step 1: Run pocketbase-typegen against the SQLite schema ───────────────
// Note: --use-const flag removed; upstream pocketbase-typegen 1.5.0+ generates the Collections enum by default.
const genResult = spawnSync('npx', ['pocketbase-typegen', '--db', DB_PATH, '--out', OUTPUT_PATH], {
  cwd: FRONTEND_DIR,
  stdio: 'inherit',
})
if (genResult.status !== 0) {
  console.error('❌ pocketbase-typegen failed')
  process.exit(genResult.status ?? 1)
}

// ── Step 2: Normalize formatting ────────────────────────────────────────────
// Run prettier on the output file so codegen version bumps that change
// default formatting don't produce noisy diffs in the freshness check. Pass
// --config explicitly so a run targeting a temp path outside the project
// tree still gets the repo's own formatting rules.
//
// Format to a FIXED POINT rather than trusting one pass: pocketbase-typegen's
// static utility-type boilerplate (the `ProcessCreateAndUpdateFields` mapped
// type with its "Convert FileNameString to File" comment) hits a known
// prettier non-idempotency -- a single --write pass on the raw generator
// output lands on a DIFFERENT stable state than a second pass on that same
// output, oscillating between two otherwise-equivalent placements of a
// leading vs. trailing comment. Verified empirically (kindred#2278): pass 1
// != pass 2, but pass 2 == pass 3 == the checked-in file. This is pure
// prettier formatting behavior on tool boilerplate, not schema-derived, so
// it reproduces on every regeneration regardless of collections -- looping
// to a fixed point (capped so a genuine new oscillation can't hang this
// script) is what makes the freshness check's diff meaningful instead of
// permanently red.
const PRETTIER_CONFIG = join(FRONTEND_DIR, '.prettierrc.json')
console.log('Formatting generated types with prettier...')
let previous = null
const MAX_PASSES = 5
for (let pass = 1; pass <= MAX_PASSES; pass++) {
  const fmtResult = spawnSync(
    'npx',
    ['prettier', '--config', PRETTIER_CONFIG, '--write', OUTPUT_PATH],
    {
      cwd: FRONTEND_DIR,
      stdio: 'inherit',
    }
  )
  if (fmtResult.status !== 0) {
    console.error('⚠️  prettier failed — output left unformatted (non-fatal)')
    break
  }
  const current = readFileSync(OUTPUT_PATH, 'utf8')
  if (current === previous) break
  previous = current
  if (pass === MAX_PASSES) {
    console.error(
      `⚠️  prettier did not settle after ${MAX_PASSES} passes — proceeding with the last result`
    )
  }
}

console.log(`✅ Types generated successfully: ${OUTPUT_PATH}`)
