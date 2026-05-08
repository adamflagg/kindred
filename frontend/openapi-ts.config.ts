/**
 * Hey API codegen config — types-only mode.
 *
 * Replaces openapi-typescript@7 (issue #1225). We invoke this via
 * `scripts/generate-api-types.js`, which dumps the FastAPI OpenAPI schema
 * to `src/types/.openapi-schema.json` first and then runs Hey API.
 *
 * Output:
 *   src/types/api-generated/
 *     ├── index.ts      — re-exports types.gen
 *     └── types.gen.ts  — flat type aliases (Pet, AddPetResponses, etc.)
 *
 * The wrapper layer in src/types/api-types.ts and src/types/satisfaction.ts
 * continues to be the only entry point consumer code uses; this file's
 * shape is intentionally hidden behind those wrappers.
 *
 * SDK / fetch client are intentionally NOT generated — runtime fetching
 * goes through the project's existing apiFetch / pbFetch helpers.
 */
import { defineConfig } from '@hey-api/openapi-ts'

// We deliberately don't set `output.format` — generate-api-types.js runs
// prettier over the output directory after codegen so we can use the same
// .prettierrc.json the rest of the project uses.
export default defineConfig({
  input: 'src/types/.openapi-schema.json',
  output: 'src/types/api-generated',
  plugins: ['@hey-api/typescript'],
})
