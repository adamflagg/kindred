#!/usr/bin/env node
/**
 * Generate TypeScript types from the FastAPI OpenAPI schema.
 *
 * Workflow:
 *   1. Spawn `uv run python scripts/dump-openapi.py` (repo root) to write
 *      the OpenAPI JSON schema to a temp file.
 *   2. Run `openapi-typescript` against that JSON file.
 *   3. Run `prettier --write` on the output so future tool-version
 *      formatting drift doesn't churn the freshness check.
 *   4. Emit `src/types/api-generated.ts`.
 *
 * Run via:
 *   npm run generate:api-types        (from frontend/)
 *   node scripts/generate-api-types.js
 *
 * The schema dump file (src/types/.openapi-schema.json) is gitignored.
 * The generated output (src/types/api-generated.ts) is committed.
 */

import { spawnSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FRONTEND_DIR = join(__dirname, '..')
const REPO_ROOT = join(FRONTEND_DIR, '..')

const SCHEMA_PATH = join(FRONTEND_DIR, 'src', 'types', '.openapi-schema.json')
const OUTPUT_PATH = join(FRONTEND_DIR, 'src', 'types', 'api-generated.ts')

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

// ── Step 2: Run openapi-typescript ────────────────────────────────────────────
console.log('Generating TypeScript types from OpenAPI schema...')
const genResult = spawnSync(
  'npx',
  ['openapi-typescript', SCHEMA_PATH, '-o', OUTPUT_PATH],
  { cwd: FRONTEND_DIR, stdio: 'inherit' }
)
if (genResult.status !== 0) {
  console.error('❌ openapi-typescript failed')
  process.exit(genResult.status ?? 1)
}

// ── Step 3: Normalize formatting ──────────────────────────────────────────────
// Run prettier so that `openapi-typescript` version bumps that change default
// formatting don't produce noisy diffs in the lefthook freshness check.
console.log('Formatting generated types with prettier...')
const fmtResult = spawnSync(
  'npx',
  ['prettier', '--write', OUTPUT_PATH],
  { cwd: FRONTEND_DIR, stdio: 'inherit' }
)
if (fmtResult.status !== 0) {
  console.error('⚠️  prettier failed — output left unformatted (non-fatal)')
}

console.log(`✅ API types generated: src/types/api-generated.ts`)
