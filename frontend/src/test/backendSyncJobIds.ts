import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const API_GO_PATH = resolve(__dirname, '../../../pocketbase/sync/api.go')

const FUNC_START_MARKER = 'func statusSyncTypes() []string {'
// The function's own closing brace is the first "}" that sits alone on its line at column
// 0 -- the []string{...} literal's closing "}" one line above it is indented with a tab, so
// it never matches "\n}\n".
const FUNC_END_MARKER = '\n}\n'

/**
 * Parses the job IDs `statusSyncTypes()` (pocketbase/sync/api.go) actually publishes on
 * `GET /api/custom/sync/status` -- the single backend-owned source of truth for "what job
 * IDs can the client see". Reads the live file on every call, so a frontend guard test
 * anchored to this can never itself go stale: it re-parses whatever is on disk rather than
 * a copy that could drift in lockstep with the TS lists it checks.
 *
 * kindred#2593: the frontend kept three hand-maintained lists (syncTypes.ts's card list,
 * useSyncCompletionToasts.ts's toast/invalidation list, and useSyncStatusAPI.ts's
 * SyncStatusResponse interface) with nothing crossing the language boundary to catch
 * drift -- pocketbase/sync/api_status_types_test.go pins only the backend half. This
 * crosses the boundary the same way other frontend tests already anchor on backend
 * source text (see satisfactionLookup.parity.test.ts's shared-fixture sibling of this
 * pattern) -- there is no natural shared file to generate here, so the parse targets the
 * function body directly instead.
 *
 * Job IDs are quoted string literals in the function body -- but so, occasionally, is prose
 * inside a "//" comment (one reads: `its dashboard row read "idle" while it ran.`). Each
 * line is truncated at its first "//" before extracting quotes, so a comment's quoted words
 * never get mistaken for a job ID; no job-id literal itself contains "//".
 */
export function getBackendSyncJobIds(): string[] {
  const source = readFileSync(API_GO_PATH, 'utf-8')

  const funcStart = source.indexOf(FUNC_START_MARKER)
  if (funcStart === -1) {
    throw new Error(
      `statusSyncTypes() not found in pocketbase/sync/api.go (looked for ` +
        `${JSON.stringify(FUNC_START_MARKER)}) -- it was renamed or removed, and this ` +
        `parser (kindred#2593) needs updating to match`
    )
  }

  const funcEnd = source.indexOf(FUNC_END_MARKER, funcStart)
  if (funcEnd === -1) {
    throw new Error('Could not find the end of statusSyncTypes() in pocketbase/sync/api.go')
  }

  const body = source.slice(funcStart, funcEnd)
  const codeOnly = body
    .split('\n')
    .map((line) => {
      const commentIdx = line.indexOf('//')
      return commentIdx === -1 ? line : line.slice(0, commentIdx)
    })
    .join('\n')
  // The capture group always matches when the outer pattern does (it isn't optional), but
  // TypeScript's RegExpMatchArray typing indexes as `string | undefined` regardless.
  const ids = [...codeOnly.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1] as string)

  if (ids.length === 0) {
    throw new Error('Parsed zero job IDs out of statusSyncTypes() -- the parser regex is broken')
  }

  return ids
}
