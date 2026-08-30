import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const API_GO_PATH = resolve(__dirname, '../../../pocketbase/sync/api.go')
const ORCHESTRATOR_GO_PATH = resolve(__dirname, '../../../pocketbase/sync/orchestrator.go')

const REGISTRY_START_MARKER = 'var syncJobMeta = []JobMeta{'
// syncJobMeta's own closing brace: the first "}" alone at column 0 after the declaration.
// Every row inside it is indented with at least one tab, so nothing within the table matches.
const REGISTRY_END_MARKER = '\n}'

// One registry row's opening line: gofmt puts the composite literal's brace, the ID field and
// its lowercase snake_case string literal together, e.g.
//
//	{ID: "session_groups", Phase: PhaseSource,
//
// Anything else at that indentation is a shape this parser does not understand, and must be
// reported rather than guessed at -- see parseSyncJobIds.
const REGISTRY_ROW_START = /^\t\{ID: "([a-z0-9_]+)",/

// The token that OPENS a row, whatever else the row turns out to look like. Counting these is
// how the scan below proves it saw every row rather than merely a plausible number of them:
// gofmt is happy to leave two rows on one source line, and a line-anchored regex reads the
// first and drops the second in silence. Every occurrence must end up as exactly one id.
const REGISTRY_ROW_MARKER = '{ID:'

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

// statusSyncTypes()'s whole body, as a derivation over the registry this file parses. Matched
// as a unit so the two claims stay one claim: if the payload stops being allJobIDs(), the ids
// parsed below are no longer the ids the client can see, and every guard anchored to them is
// pinning the wrong set. Tolerant of gofmt's one-line and multi-line renderings, exact about
// what is returned.
const STATUS_SYNC_TYPES_SIGNATURE = 'func statusSyncTypes() []string {'
const STATUS_SYNC_TYPES_DERIVED =
  /func statusSyncTypes\(\) \[\]string \{\s*return allJobIDs\(\)\s*\}/

function readApiGo(): string {
  return readFileSync(API_GO_PATH, 'utf-8')
}

function readOrchestratorGo(): string {
  return readFileSync(ORCHESTRATOR_GO_PATH, 'utf-8')
}

/**
 * Parses the job IDs out of `syncJobMeta` -- `pocketbase/sync/orchestrator.go`'s registry, and
 * the single backend-owned source of truth for "what job IDs can the client see", since
 * `statusSyncTypes()` returns `allJobIDs()` over exactly this table.
 *
 * kindred#2593: the frontend keeps three hand-maintained lists (syncTypes.ts's card list,
 * useSyncCompletionToasts.ts's toast/invalidation list, and useSyncStatusAPI.ts's
 * SyncStatusResponse interface) with nothing crossing the language boundary to catch drift --
 * pocketbase/sync/api_status_types_test.go pins only the backend half. Four coverage tests are
 * anchored to this parse.
 *
 * Because those tests trust it completely, this validates the SHAPE of every row and throws on
 * anything it does not recognise, rather than scraping quoted strings out of the table. A
 * quote-scraper fails in both directions and one of them is silent:
 *
 *   - loudly, when the table grows any other string literal -- every row already carries a
 *     `Description:`, and `Phase: PhaseSource` sits beside ids that look just like job names,
 *     so a scraper would invent phantom jobs and fail all four guards, blaming four frontend
 *     lists for a backend edit that added no job;
 *   - silently, when a job is added through a constant, a helper or an `append` instead of a
 *     literal row -- the parser misses it, the frontend lists are missing it too, the sets
 *     match, and the guards go green over exactly the drift they exist to catch.
 *
 * The shape check is per-LINE, so the count of row-opening markers is reconciled against the
 * count of ids extracted before returning: two rows on one source line is gofmt-stable, and a
 * line-anchored regex would read the first and drop the second without a word.
 *
 * Throwing costs a clear CI failure that names the offending line the day someone reshapes
 * syncJobMeta; the alternative costs a guard that lies.
 */
export function parseSyncJobIds(source: string): string[] {
  const registryStart = source.indexOf(REGISTRY_START_MARKER)
  if (registryStart === -1) {
    throw new Error(
      `syncJobMeta not found in pocketbase/sync/orchestrator.go (looked for ` +
        `${JSON.stringify(REGISTRY_START_MARKER)}) -- it was renamed, or the table stopped ` +
        `being a plain slice literal, and this parser (kindred#2593) needs updating to match`
    )
  }

  // Bounded by the table's own closing brace -- the first "}" at column 0 after the
  // declaration. Without that bound, a syncJobMeta built by a helper would send the row scan
  // running on into the NEXT declaration's literal, and the four coverage guards would then
  // validate the frontend against a plausible-looking wrong set instead of failing.
  const registryEnd = source.indexOf(REGISTRY_END_MARKER, registryStart)
  if (registryEnd === -1) {
    throw new Error('Could not find the end of syncJobMeta in pocketbase/sync/orchestrator.go')
  }

  const body = source.slice(registryStart + REGISTRY_START_MARKER.length, registryEnd)
  const refuses =
    `it refuses to guess, because a job it silently missed would make all four frontend ` +
    `coverage guards pass over the exact drift they exist to catch. Update the parser to ` +
    `match the new shape.`

  const ids: string[] = []
  let markers = 0
  for (const rawLine of body.split('\n')) {
    // A row's opening line never contains "//", so truncating at the first one strips a
    // trailing or whole-line comment without ever eating part of a row. The registry's prose
    // is dense and quotes plenty of things a scraper would trip on; none of it reaches here.
    const commentIdx = rawLine.indexOf('//')
    const line = commentIdx === -1 ? rawLine : rawLine.slice(0, commentIdx)
    if (line.trim() === '') continue

    const onThisLine = countOccurrences(line, REGISTRY_ROW_MARKER)
    markers += onThisLine

    // Two rows on one source line survives gofmt untouched, so nothing in the toolchain would
    // ever reformat it away, and the line-anchored regex below reads the first and drops the
    // second WITHOUT complaining -- the silent direction this whole parser exists to refuse.
    if (onThisLine > 1) {
      throw new Error(
        `${onThisLine} syncJobMeta rows share one source line: ` +
          `${JSON.stringify(line.trimEnd())}. This parser (kindred#2593) understands one row ` +
          `per line, and would otherwise return only the first; ${refuses}`
      )
    }

    // Two tabs or more is a continuation of the row opened above -- its Description, Cadences,
    // Triggers, Gate. Only the one-tab lines are rows, and every one of them must be a row. A
    // row that OPENS at continuation depth is a shape the scan cannot attribute, so it throws
    // rather than skip past it.
    if (line.startsWith('\t\t')) {
      if (onThisLine > 0) {
        throw new Error(
          `A syncJobMeta row opens at continuation indentation: ` +
            `${JSON.stringify(line.trimEnd())}. This parser (kindred#2593) reads rows only at ` +
            `one tab of indentation; ${refuses}`
        )
      }
      continue
    }

    const match = REGISTRY_ROW_START.exec(line)
    if (!match) {
      throw new Error(
        `Unparseable line in syncJobMeta: ${JSON.stringify(line.trimEnd())}. This parser ` +
          `(kindred#2593) only understands a row that opens \`{ID: "job_id",\`; ${refuses}`
      )
    }
    ids.push(match[1] as string)
  }

  // The loop's invariant, restated as a check rather than left as an argument: every non-blank
  // line contributes at most one row marker, and a line carrying one either yields an id or
  // throws. So this can only fire if a future edit breaks that reasoning -- which is exactly
  // when a silent subset would otherwise start being returned.
  if (markers !== ids.length) {
    throw new Error(
      `syncJobMeta contains ${markers} ${JSON.stringify(REGISTRY_ROW_MARKER)} row markers but ` +
        `${ids.length} job ids were parsed out of it. This parser (kindred#2593) will not ` +
        `return a subset it cannot account for; ${refuses}`
    )
  }

  if (ids.length === 0) {
    throw new Error('Parsed zero job IDs out of syncJobMeta -- the parser regex is broken')
  }

  return ids
}

/**
 * Throws unless `statusSyncTypes()` is still `return allJobIDs()`.
 *
 * The registry parsed above is only the right anchor for the frontend's lists while the
 * sync-status payload IS the registry. Re-hand-writing statusSyncTypes() would break that
 * silently from this side: the parser would keep returning every registered job, the frontend
 * lists would keep matching it, and all four guards would stay green while the payload
 * published a subset -- kindred#2591 and #2593 exactly, with a green tick on them.
 *
 * pocketbase/sync/registry_test.go's TestStatusSyncTypesIsTheWholeRegistry pins the same fact
 * in Go, where it belongs; this is the cheap second lock on the door the frontend guards
 * actually walk through.
 */
export function assertStatusPayloadDerivesFromRegistry(source: string): void {
  const signatureAt = source.indexOf(STATUS_SYNC_TYPES_SIGNATURE)
  if (signatureAt === -1) {
    throw new Error(
      `statusSyncTypes() not found in pocketbase/sync/api.go (looked for ` +
        `${JSON.stringify(STATUS_SYNC_TYPES_SIGNATURE)}) -- it was renamed or removed, and this ` +
        `parser (kindred#2593) needs updating to match`
    )
  }
  if (STATUS_SYNC_TYPES_DERIVED.test(source.slice(signatureAt))) return

  throw new Error(
    `statusSyncTypes() no longer returns allJobIDs(), so syncJobMeta is no longer what the ` +
      `sync-status payload publishes and the frontend coverage guards (kindred#2593) would be ` +
      `anchored to the wrong set. Found: ` +
      `${JSON.stringify(source.slice(signatureAt, signatureAt + 160))}`
  )
}

/**
 * The job IDs the live pocketbase/sync backend publishes on `GET /api/custom/sync/status`.
 * Re-reads both files on every call, so a guard anchored to it can never itself go stale the
 * way a generated fixture or a copied list could.
 */
export function getBackendSyncJobIds(): string[] {
  assertStatusPayloadDerivesFromRegistry(readApiGo())
  return parseSyncJobIds(readOrchestratorGo())
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
