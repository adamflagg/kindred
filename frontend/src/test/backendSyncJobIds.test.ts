import { describe, it, expect } from 'vitest'
import {
  getBackendSyncJobIds,
  getBackendSyncPostRouteSegments,
  parseSyncJobIds,
} from './backendSyncJobIds'

describe('getBackendSyncJobIds (kindred#2593)', () => {
  it('parses a non-empty list of job IDs from pocketbase/sync/api.go', () => {
    const ids = getBackendSyncJobIds()
    expect(ids.length).toBeGreaterThan(30)
  })

  it('includes known daily-sync job IDs', () => {
    const ids = getBackendSyncJobIds()
    expect(ids).toContain('session_groups')
    expect(ids).toContain('persons')
    expect(ids).toContain('stranded_assignment_cleanup')
  })

  it('includes the three jobs published by #2591', () => {
    const ids = getBackendSyncJobIds()
    expect(ids).toContain('person_custom_values_family_camp')
    expect(ids).toContain('household_custom_values_family_camp')
    expect(ids).toContain('reconcile_request_lifecycle')
  })

  it('includes multi_workbook_export, not the renamed google_sheets_export', () => {
    const ids = getBackendSyncJobIds()
    expect(ids).toContain('multi_workbook_export')
    expect(ids).not.toContain('google_sheets_export')
  })

  it('has no duplicate job IDs', () => {
    const ids = getBackendSyncJobIds()
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// The parser is regex over Go source, and a source-text parser that quietly returns the WRONG
// set is worse than no guard at all: three coverage tests are anchored to it, and a set that
// silently drops a job the backend added is precisely the drift kindred#2593 exists to catch,
// now with a green tick on it. So every shape the parser does not understand must THROW rather
// than parse to something plausible. These pin that, against synthetic sources -- the real
// api.go is the happy path above.
describe('parseSyncJobIds rejects what it cannot parse (kindred#2593)', () => {
  const wrap = (body: string) =>
    `package sync\n\nfunc statusSyncTypes() []string {\n\treturn []string{\n${body}\n\t}\n}\n`

  it('parses a well-formed literal, comments and all', () => {
    const src = wrap(
      [
        '\t\t// Weekly syncs - global definitions',
        '\t\t"person_tag_defs",   // Global sync: tag definitions',
        '\t\t"sessions",',
        '\t\t// Its dashboard row read "idle" while it ran.',
        '\t\t"process_requests",',
      ].join('\n')
    )
    expect(parseSyncJobIds(src)).toEqual(['person_tag_defs', 'sessions', 'process_requests'])
  })

  // The false-GREEN case, and the reason the parser validates line shape instead of scraping
  // quotes: a job appended through a constant or a helper is invisible to a quote-scraper. The
  // frontend lists would be missing it too, the sets would match, and all three guards would
  // pass while the exact drift they exist to catch was live.
  it('throws when a job is added by identifier rather than a string literal', () => {
    const src = wrap('\t\t"sessions",\n\t\tjobPersonCustomValues,')
    expect(() => parseSyncJobIds(src)).toThrow(/jobPersonCustomValues/)
  })

  // The false-RED case: a quote-scraper turns any other string in the function into a phantom
  // job id ("true" here), and then blames three frontend lists for a backend edit that added
  // no job.
  it('throws when the literal grows a conditional with a non-job string in it', () => {
    const src = wrap(
      '\t\t"sessions",\n\t\tif os.Getenv("IS_DOCKER") == "true" {\n\t\t\t"process_requests",\n\t\t}'
    )
    expect(() => parseSyncJobIds(src)).toThrow(/IS_DOCKER/)
  })

  it('throws on a block comment, whose prose a "//" truncation cannot reach', () => {
    const src = wrap('\t\t/* the "sessions" job is listed below */\n\t\t"sessions",')
    expect(() => parseSyncJobIds(src)).toThrow(/sessions/)
  })

  it('throws when statusSyncTypes() has been renamed or moved out of the file', () => {
    const src =
      'package sync\n\nfunc publishedSyncTypes() []string {\n\treturn []string{\n\t\t"sessions",\n\t}\n}\n'
    expect(() => parseSyncJobIds(src)).toThrow(/renamed or removed/)
  })

  it('throws on an empty list rather than returning one', () => {
    expect(() => parseSyncJobIds(wrap('\t\t// nothing here yet'))).toThrow(/zero job IDs/)
  })
})

// kindred#2593: the PR's own reasoning for the three no-Run-button cards is "no backend POST
// route exists, so a generic Run button would 404". That claim is only as durable as a test
// that re-checks it, so the route list is parsed from the same file the job list is.
describe('getBackendSyncPostRouteSegments (kindred#2593)', () => {
  it('finds the registered individual-sync POST routes', () => {
    const segments = getBackendSyncPostRouteSegments()
    expect(segments).toContain('multi-workbook-export')
    expect(segments).toContain('stranded-assignment-cleanup')
    expect(segments).toContain('person-custom-values')
  })

  it('has no route for the three daily-cron-only jobs', () => {
    const segments = getBackendSyncPostRouteSegments()
    expect(segments).not.toContain('person-custom-values-family-camp')
    expect(segments).not.toContain('household-custom-values-family-camp')
    expect(segments).not.toContain('reconcile-request-lifecycle')
  })

  // The kebab sibling of the phantom `google_sheets_export` key this PR removes.
  it('has no google-sheets-export route', () => {
    expect(getBackendSyncPostRouteSegments()).not.toContain('google-sheets-export')
  })
})
