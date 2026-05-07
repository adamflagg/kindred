#!/usr/bin/env node
/**
 * Generate TypeScript types from the FastAPI OpenAPI schema.
 *
 * Workflow:
 *   1. Spawn `uv run python scripts/dump-openapi.py` (repo root) to write
 *      the OpenAPI JSON schema to a temp file.
 *   2. Run `openapi-typescript` against that JSON file.
 *   3. Emit `src/types/api-generated.ts`.
 *
 * Run via:
 *   npm run generate:api-types        (from frontend/)
 *   node scripts/generate-api-types.js
 *
 * The schema dump file (src/types/.openapi-schema.json) is gitignored.
 * The generated output (src/types/api-generated.ts) is committed.
 */

import { execSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FRONTEND_DIR = join(__dirname, '..')
const REPO_ROOT = join(FRONTEND_DIR, '..')

const SCHEMA_PATH = join(FRONTEND_DIR, 'src', 'types', '.openapi-schema.json')
const OUTPUT_PATH = join(FRONTEND_DIR, 'src', 'types', 'api-generated.ts')

// ── Step 1: Dump the OpenAPI schema from FastAPI ──────────────────────────────
console.log('Dumping OpenAPI schema from FastAPI app...')
try {
  execSync(`uv run python scripts/dump-openapi.py "${SCHEMA_PATH}"`, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
} catch (error) {
  console.error('❌ Failed to dump OpenAPI schema:', error.message)
  console.error(
    'Tip: ensure uv is installed and SKIP_PB_AUTH / POCKETBASE_URL are set (or defaults are fine).'
  )
  process.exit(1)
}

if (!existsSync(SCHEMA_PATH)) {
  console.error(`❌ Schema dump not found at ${SCHEMA_PATH}`)
  process.exit(1)
}

// ── Step 2: Run openapi-typescript ────────────────────────────────────────────
console.log('Generating TypeScript types from OpenAPI schema...')
try {
  execSync(`npx openapi-typescript "${SCHEMA_PATH}" -o "${OUTPUT_PATH}"`, {
    cwd: FRONTEND_DIR,
    stdio: 'inherit',
  })
} catch (error) {
  console.error('❌ openapi-typescript failed:', error.message)
  process.exit(1)
}

console.log(`✅ API types generated: src/types/api-generated.ts`)
