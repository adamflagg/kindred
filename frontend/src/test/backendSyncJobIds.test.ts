import { describe, it, expect } from 'vitest'
import {
  assertStatusPayloadDerivesFromRegistry,
  getBackendSyncJobIds,
  getBackendSyncPostRouteSegments,
  parseSyncJobIds,
} from './backendSyncJobIds'

describe('getBackendSyncJobIds (kindred#2593)', () => {
  it('parses a non-empty list of job IDs from pocketbase/sync/orchestrator.go', () => {
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

  it('includes the five global definition jobs', () => {
    const ids = getBackendSyncJobIds()
    for (const id of [
      'person_tag_defs',
      'custom_field_defs',
      'staff_lookups',
      'financial_lookups',
      'divisions',
    ]) {
      expect(ids).toContain(id)
    }
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

  // A Description, a Phase or a Gate is not a job. The row-shape check is what keeps them out;
  // a quote-scraper over the same table would return every one of them.
  it('parses only job ids, not the other fields on each row', () => {
    const ids = getBackendSyncJobIds()
    expect(ids).not.toContain('true')
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9_]+$/)
    }
  })
})

// The parser is regex over Go source, and a source-text parser that quietly returns the WRONG
// set is worse than no guard at all: four coverage tests are anchored to it, and a set that
// silently drops a job the backend added is precisely the drift kindred#2593 exists to catch,
// now with a green tick on it. So every shape the parser does not understand must THROW rather
// than parse to something plausible. These pin that, against synthetic sources -- the real
// orchestrator.go is the happy path above.
describe('parseSyncJobIds rejects what it cannot parse (kindred#2593)', () => {
  const wrap = (body: string) => `package sync\n\nvar syncJobMeta = []JobMeta{\n${body}\n}\n`

  it('parses a well-formed registry, comments and multi-line rows and all', () => {
    const src = wrap(
      [
        '\t// Global phase -- cross-year definition tables.',
        '\t{ID: "person_tag_defs", Phase: PhaseGlobal, Description: "Tag definitions",',
        '\t\tCadences: CadenceWeeklyGlobal, Triggers: TriggerIndividualRoute},',
        '',
        '\t{ID: "sessions", Phase: PhaseSource, Description: "Sessions"}, // depends on groups',
        '\t// process_requests only runs in Docker.',
        '\t{ID: "process_requests", Phase: PhaseProcess,',
        '\t\tDescription: "AI processing of bunk requests",',
        '\t\tGate: func() bool { return os.Getenv("IS_DOCKER") == boolTrueStr }},',
      ].join('\n')
    )
    expect(parseSyncJobIds(src)).toEqual(['person_tag_defs', 'sessions', 'process_requests'])
  })

  // The false-GREEN case, and the reason the parser validates row shape instead of scraping
  // quotes: a job appended through a pre-built JobMeta value is invisible to a quote-scraper.
  // The frontend lists would be missing it too, the sets would match, and all four guards
  // would pass while the exact drift they exist to catch was live.
  it('throws when a row is added by identifier rather than a composite literal', () => {
    const src = wrap('\t{ID: "sessions", Phase: PhaseSource},\n\tpersonCustomValuesMeta,')
    expect(() => parseSyncJobIds(src)).toThrow(/personCustomValuesMeta/)
  })

  // The same hole one level down: the row IS a literal, but its ID comes from a constant.
  it('throws when a row names its ID with a constant', () => {
    const src = wrap(
      '\t{ID: "sessions", Phase: PhaseSource},\n\t{ID: jobPersonCustomValues, Phase: PhaseExpensive},'
    )
    expect(() => parseSyncJobIds(src)).toThrow(/jobPersonCustomValues/)
  })

  // gofmt keeps `{ID: "..."` together, but nothing forces an author to write it that way. A row
  // opened on its own line puts the id where this parser does not look, so it must throw rather
  // than skip the row.
  it('throws when a row is reshaped so its ID is not on the opening line', () => {
    const src = wrap('\t{\n\t\tID: "sessions",\n\t\tPhase: PhaseSource,\n\t},')
    expect(() => parseSyncJobIds(src)).toThrow(/only understands a row that opens/)
  })

  // The shape gofmt will NOT reformat away, and the one this parser got wrong first time
  // round: `{ID: "a", ...}, {ID: "b", ...},` is valid, stable Go, and a line-anchored regex
  // reads the first row and drops the second in silence -- 35 ids returned, no throw, and four
  // frontend guards validating against a set missing a real job. That is the exact false-GREEN
  // failure the old `^"id",$` parser threw on, so losing it was a regression.
  it('throws when two rows share one source line', () => {
    const src = wrap(
      '\t{ID: "sessions", Phase: PhaseSource}, {ID: "attendees", Phase: PhaseSource},'
    )
    expect(() => parseSyncJobIds(src)).toThrow(/2 syncJobMeta rows share one source line/)
    expect(() => parseSyncJobIds(src)).toThrow(/attendees/)
  })

  it('throws when three rows share one source line', () => {
    const src = wrap('\t{ID: "a"}, {ID: "b"}, {ID: "c"},')
    expect(() => parseSyncJobIds(src)).toThrow(/3 syncJobMeta rows share one source line/)
  })

  // The sibling hole: a row that opens at continuation depth is invisible to a scan that
  // treats every deeper-indented line as belonging to the row above it.
  it('throws when a row opens at continuation indentation', () => {
    const src = wrap('\t{ID: "sessions", Phase: PhaseSource,\n\t\t{ID: "attendees"}},')
    expect(() => parseSyncJobIds(src)).toThrow(/opens at continuation indentation/)
  })

  it('throws on a block comment, whose prose a "//" truncation cannot reach', () => {
    const src = wrap('\t/* the "sessions" job is listed below */\n\t{ID: "sessions"},')
    expect(() => parseSyncJobIds(src)).toThrow(/sessions/)
  })

  it('throws when syncJobMeta has been renamed or moved out of the file', () => {
    const src = 'package sync\n\nvar syncJobRegistry = []JobMeta{\n\t{ID: "sessions"},\n}\n'
    expect(() => parseSyncJobIds(src)).toThrow(/renamed/)
  })

  // The remaining false-GREEN hole after the shape check: the row scan starts at the table but
  // must be bounded by it. Let syncJobMeta be built by a helper and an unbounded search runs on
  // into the NEXT declaration's slice literal, parsing a plausible-looking wrong set that the
  // four coverage guards then validate against.
  it("throws rather than reading a later declaration's slice literal", () => {
    const src = [
      'package sync',
      '',
      'var syncJobMeta = buildJobMeta()',
      '',
      'var unrelatedNames = []JobMeta{',
      '\t{ID: "not_a_job"},',
      '}',
      '',
    ].join('\n')
    expect(() => parseSyncJobIds(src)).toThrow(/renamed/)
  })

  it('throws on an empty table rather than returning one', () => {
    expect(() => parseSyncJobIds(wrap('\t// nothing here yet'))).toThrow(/zero job IDs/)
  })
})

// The registry is only the right anchor for the frontend's lists while the status payload IS
// the registry. That is a fact about api.go, not about orchestrator.go, so it is checked
// separately -- and it is the one way the re-pointed parser could go silently wrong.
describe('assertStatusPayloadDerivesFromRegistry (kindred#2593)', () => {
  it('accepts the live pocketbase/sync/api.go', () => {
    expect(() => getBackendSyncJobIds()).not.toThrow()
  })

  it('accepts the derivation on one line or several', () => {
    for (const body of [
      'func statusSyncTypes() []string { return allJobIDs() }',
      'func statusSyncTypes() []string {\n\treturn allJobIDs()\n}',
    ]) {
      expect(() =>
        assertStatusPayloadDerivesFromRegistry(`package sync\n\n${body}\n`)
      ).not.toThrow()
    }
  })

  it('throws when the payload goes back to a hand-written list', () => {
    const src =
      'package sync\n\nfunc statusSyncTypes() []string {\n\treturn []string{\n\t\t"sessions",\n\t}\n}\n'
    expect(() => assertStatusPayloadDerivesFromRegistry(src)).toThrow(/no longer returns allJobIDs/)
  })

  it('throws when the payload is derived from something narrower than the whole registry', () => {
    const src =
      'package sync\n\nfunc statusSyncTypes() []string { return jobsWithCadence(CadenceDaily) }\n'
    expect(() => assertStatusPayloadDerivesFromRegistry(src)).toThrow(/no longer returns allJobIDs/)
  })

  it('throws when statusSyncTypes() has been renamed or removed', () => {
    const src = 'package sync\n\nfunc publishedSyncTypes() []string { return allJobIDs() }\n'
    expect(() => assertStatusPayloadDerivesFromRegistry(src)).toThrow(/renamed or removed/)
  })
})

// kindred#2593: the PR's own reasoning for the three no-Run-button cards is "no backend POST
// route exists, so a generic Run button would 404". That claim is only as durable as a test
// that re-checks it, so the route list is parsed from api.go directly.
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
