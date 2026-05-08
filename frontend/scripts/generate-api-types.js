#!/usr/bin/env node
/**
 * Generate TypeScript types from the FastAPI OpenAPI schema.
 *
 * Workflow:
 *   1. Spawn `uv run python scripts/dump-openapi.py` (repo root) to write
 *      the OpenAPI JSON schema to a temp file.
 *   2. Run `@hey-api/openapi-ts` against that JSON file.
 *   3. Run `prettier --write` on the output directory so future tool-version
 *      formatting drift doesn't churn the freshness check.
 *   4. Emit files under `src/types/api-generated/` (or the path passed via --output).
 *
 * Run via:
 *   npm run generate:api-types                 (from frontend/)
 *   node scripts/generate-api-types.js
 *   node scripts/generate-api-types.js --output /tmp/api-generated
 *
 * The schema dump file (src/types/.openapi-schema.json) is gitignored.
 * The generated output directory (src/types/api-generated/) is committed.
 *
 * Plugin set / output shape: see frontend/openapi-ts.config.ts.
 */

import { spawnSync } from 'child_process'
import { join, dirname, isAbsolute, resolve } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FRONTEND_DIR = join(__dirname, '..')
const REPO_ROOT = join(FRONTEND_DIR, '..')

const SCHEMA_PATH = join(FRONTEND_DIR, 'src', 'types', '.openapi-schema.json')
const DEFAULT_OUTPUT_DIR = join(FRONTEND_DIR, 'src', 'types', 'api-generated')

// ── Parse --output <path> ─────────────────────────────────────────────────────
// Used by the lefthook freshness check to regen to a temp directory without
// mutating the committed copy (avoids a race with parallel `tsc`).
function parseOutputArg(argv) {
  const i = argv.indexOf('--output')
  if (i === -1) return DEFAULT_OUTPUT_DIR
  const v = argv[i + 1]
  if (!v) {
    console.error('❌ --output requires a path argument')
    process.exit(2)
  }
  return isAbsolute(v) ? v : resolve(process.cwd(), v)
}

const OUTPUT_DIR = parseOutputArg(process.argv.slice(2))

// ── Step 1: Dump the OpenAPI schema from FastAPI ──────────────────────────────
// spawnSync with arg array bypasses the shell entirely — paths with `$`,
// backticks, or spaces are passed through literally without re-interpretation.
console.log('Dumping OpenAPI schema from FastAPI app...')
const dumpResult = spawnSync(
  'uv',
  ['run', 'python', 'scripts/dump-openapi.py', SCHEMA_PATH],
  { cwd: REPO_ROOT, stdio: 'inherit' }
)
if (dumpResult.status !== 0) {
  console.error('❌ Failed to dump OpenAPI schema')
  console.error(
    'Tip: ensure uv is installed and SKIP_PB_AUTH / POCKETBASE_URL are set (or defaults are fine).'
  )
  process.exit(dumpResult.status ?? 1)
}

if (!existsSync(SCHEMA_PATH)) {
  console.error(`❌ Schema dump not found at ${SCHEMA_PATH}`)
  process.exit(1)
}

// ── Step 2: Run @hey-api/openapi-ts ───────────────────────────────────────────
// Plugin set lives in frontend/openapi-ts.config.ts (types-only).
// We override input/output via flags so the lefthook freshness check can
// target a temp directory.
console.log('Generating TypeScript types from OpenAPI schema...')
const genResult = spawnSync(
  'npx',
  ['openapi-ts', '--input', SCHEMA_PATH, '--output', OUTPUT_DIR],
  { cwd: FRONTEND_DIR, stdio: 'inherit' }
)
if (genResult.status !== 0) {
  console.error('❌ openapi-ts failed')
  process.exit(genResult.status ?? 1)
}

// ── Step 3: Normalize formatting ──────────────────────────────────────────────
// Run prettier on the output directory so codegen version bumps that change
// default formatting don't produce noisy diffs in the lefthook freshness
// check. Pass --config explicitly so the freshness check (which writes to a
// temp path outside the project tree) gets the same formatting as the default
// in-tree run.
const PRETTIER_CONFIG = join(FRONTEND_DIR, '.prettierrc.json')
console.log('Formatting generated types with prettier...')
const fmtResult = spawnSync(
  'npx',
  ['prettier', '--config', PRETTIER_CONFIG, '--write', OUTPUT_DIR],
  { cwd: FRONTEND_DIR, stdio: 'inherit' }
)
if (fmtResult.status !== 0) {
  console.error('⚠️  prettier failed — output left unformatted (non-fatal)')
}

console.log(`✅ API types generated: ${OUTPUT_DIR}`)
