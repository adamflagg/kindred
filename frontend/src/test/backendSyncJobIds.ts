import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const API_GO_PATH = resolve(__dirname, '../../../pocketbase/sync/api.go')

const FUNC_START_MARKER = 'func statusSyncTypes() []string {'
const LITERAL_START_MARKER = 'return []string{'
// statusSyncTypes()'s own closing brace: the first "}" alone at column 0 after the signature.
// The slice literal's closing "}" one line above it is indented with a tab, so it never matches.
const FUNC_END_MARKER = '\n}'
// The slice literal's closing brace is the first "}" indented one tab on its own line -- the
// function's own closing brace sits at column 0, one line further down.
const LITERAL_END_MARKER = '\n\t}'

// A job-id element, once its trailing "// ..." comment is stripped: exactly one lowercase
// snake_case string literal followed by gofmt's mandatory trailing comma. Anything else in the
// literal is something this parser does not understand, and must be reported rather than
// guessed at -- see parseSyncJobIds.
const JOB_ID_ELEMENT = /^"([a-z0-9_]+)",$/

function readApiGo(): string {
  return readFileSync(API_GO_PATH, 'utf-8')
}

/**
 * Parses the job IDs `statusSyncTypes()` publishes on `GET /api/custom/sync/status` out of Go
 * source text -- the single backend-owned source of truth for "what job IDs can the client
 * see".
 *
 * kindred#2593: the frontend keeps three hand-maintained lists (syncTypes.ts's card list,
 * useSyncCompletionToasts.ts's toast/invalidation list, and useSyncStatusAPI.ts's
 * SyncStatusResponse interface) with nothing crossing the language boundary to catch drift --
 * pocketbase/sync/api_status_types_test.go pins only the backend half. Three coverage tests are
 * anchored to this parse.
 *
 * Because those three tests trust it completely, this validates the SHAPE of every element and
 * throws on anything it does not recognise, rather than scraping quoted strings out of the
 * body. A quote-scraper fails in both directions and one of them is silent:
 *
 *   - loudly, when the function grows any other string literal (`os.Getenv("IS_DOCKER") ==
 *     "true"`, the shape getDailySyncJobs already uses) -- "true" becomes a phantom job and all
 *     three guards fail, blaming three frontend lists for a backend edit that added no job;
 *   - silently, when a job is appended through a constant or a helper instead of a literal --
 *     the parser misses it, the frontend lists are missing it too, the sets match, and the
 *     guards go green over exactly the drift they exist to catch.
 *
 * Throwing costs a clear CI failure that names the offending line the day someone reshapes
 * statusSyncTypes(); the alternative costs a guard that lies.
 */
export function parseSyncJobIds(source: string): string[] {
  const funcStart = source.indexOf(FUNC_START_MARKER)
  if (funcStart === -1) {
    throw new Error(
      `statusSyncTypes() not found in pocketbase/sync/api.go (looked for ` +
        `${JSON.stringify(FUNC_START_MARKER)}) -- it was renamed or removed, and this ` +
        `parser (kindred#2593) needs updating to match`
    )
  }

  // Every search below is bounded by the function's own closing brace -- the first "}" at
  // column 0 after the signature. Without that bound, a statusSyncTypes() that returned a
  // helper's result (`return buildStatusSyncTypes()`) would send the literal search running on
  // into the NEXT function's `[]string{...}`, and the three coverage guards would then validate
  // the frontend against a plausible-looking wrong set instead of failing.
  const funcEnd = source.indexOf(FUNC_END_MARKER, funcStart)
  if (funcEnd === -1) {
    throw new Error('Could not find the end of statusSyncTypes() in pocketbase/sync/api.go')
  }

  const literalStart = source.indexOf(LITERAL_START_MARKER, funcStart)
  if (literalStart === -1 || literalStart >= funcEnd) {
    throw new Error(
      `statusSyncTypes() no longer returns a ${JSON.stringify(LITERAL_START_MARKER)} literal ` +
        `-- this parser (kindred#2593) needs updating to match`
    )
  }

  const literalEnd = source.indexOf(LITERAL_END_MARKER, literalStart)
  if (literalEnd === -1 || literalEnd >= funcEnd) {
    throw new Error('Could not find the end of statusSyncTypes()`s slice literal in api.go')
  }

  const body = source.slice(literalStart + LITERAL_START_MARKER.length, literalEnd)
  const ids: string[] = []
  for (const rawLine of body.split('\n')) {
    // Job IDs never contain "//", so truncating at the first one strips a trailing comment
    // without ever eating part of an element. A comment's own prose can quote anything it
    // likes (one reads: `its dashboard row read "idle" while it ran`) and never reaches here.
    const commentIdx = rawLine.indexOf('//')
    const line = (commentIdx === -1 ? rawLine : rawLine.slice(0, commentIdx)).trim()
    if (line === '') continue

    const match = JOB_ID_ELEMENT.exec(line)
    if (!match) {
      throw new Error(
        `Unparseable line in statusSyncTypes()'s slice literal: ${JSON.stringify(line)}. ` +
          `This parser (kindred#2593) only understands one \`"job_id",\` per line; it refuses ` +
          `to guess, because a job it silently missed would make all three frontend coverage ` +
          `guards pass over the exact drift they exist to catch. Update the parser to match ` +
          `the new shape.`
      )
    }
    ids.push(match[1] as string)
  }

  if (ids.length === 0) {
    throw new Error('Parsed zero job IDs out of statusSyncTypes() -- the parser regex is broken')
  }

  return ids
}

/**
 * The job IDs the live pocketbase/sync/api.go publishes. Re-reads the file on every call, so a
 * guard anchored to it can never itself go stale the way a generated fixture or a copied list
 * could.
 */
export function getBackendSyncJobIds(): string[] {
  return parseSyncJobIds(readApiGo())
}

/**
 * The path segments of every individual-sync POST route registered under
 * `/api/custom/sync/` -- i.e. what an id in useRunIndividualSync.ts's SYNC_TYPE_NAMES actually
 * resolves to after its snake_case -> kebab-case transform.
 *
 * kindred#2593 rests two claims on this list: that a card for a job with no route would 404,
 * and that the phantom `google_sheets_export` had no surviving endpoint. Parsing it keeps both
 * checkable instead of asserted.
 */
export function getBackendSyncPostRouteSegments(): string[] {
  const source = readApiGo()
  const matches = [...source.matchAll(/e\.Router\.POST\(\s*"\/api\/custom\/sync\/([a-z0-9_-]+)"/g)]
  if (matches.length === 0) {
    throw new Error(
      'Parsed zero POST routes out of pocketbase/sync/api.go -- the route regex ' +
        '(kindred#2593) is broken'
    )
  }
  return matches.map((m) => m[1] as string)
}
