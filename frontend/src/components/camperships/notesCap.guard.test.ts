/**
 * The six-note cap (design-language §7; conformance gap 4, owner 10-10: "a test counts every page's notes,
 * server plus page-local, and fails above 6. No runtime change"). `DefinitionNotes` draws however many
 * notes it is given, so this is where the cap holds.
 *
 * A page's notes are its server list (`SURFACES` in bunking/financial_aid/definitions.py, read here as
 * text) plus the notes the page adds itself: `AidDefinitionNotes`' `extra`, or a page-local list handed
 * straight to `DefinitionNotes`. Every page that adds notes is listed in PAGE_NOTES, and the last test
 * fails on a page that adds notes without being listed, so a seventh note cannot slip in unseen.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

import { NOTES_CAP } from './kit/notesCap'
import { ledgerNoteMarks } from './money/ledgerModel'
import { HISTORY_NOTES } from './season/historyModel'
import { RULES_FOOTNOTES } from './season/rules/rulesLayout'
import { SCENARIO_PAGE_NOTES } from './season/scenarios/scenarioNotes'

/** The server's SURFACES: each surface's note keys, parsed from the Python registry's source. */
function serverSurfaces(source: string): Map<string, number> {
  const start = source.indexOf('SURFACES: Final[')
  const end = source.indexOf('\n}\n', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  // Comments can hold parentheses ("own six (final design): …"); drop them before reading the tuples.
  const body = source
    .slice(start, end)
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join('\n')
  const surfaces = new Map<string, number>()
  for (const match of body.matchAll(/"([\w-]+)":\s*\(([^)]*)\)/g)) {
    surfaces.set(match[1]!, (match[2]!.match(/"[^"]+"/g) ?? []).length)
  }
  return surfaces
}

const DEFINITIONS_PY = readFileSync(
  resolve(__dirname, '../../../../bunking/financial_aid/definitions.py'),
  'utf-8'
)
const SURFACES = serverSurfaces(DEFINITIONS_PY)
const server = (surface: string) => SURFACES.get(surface) ?? 0

/**
 * Every page that adds notes of its own: the file that adds them, its server surface (if any), and the
 * most notes it can add. Requests adds the outside-money note; the Ledger its unclassified and tie-out
 * notes; Scenarios its two page notes; History and Rules have only page-local lists.
 */
const PAGE_NOTES: ReadonlyArray<{
  readonly page: string
  readonly file: string
  readonly surface: string | null
  readonly local: number
}> = [
  {
    page: 'Requests',
    file: '../../pages/camperships/AidRequestsPage.tsx',
    surface: 'requests',
    local: 1,
  },
  {
    page: 'Money › Ledger',
    file: './money/LedgerTab.tsx',
    surface: 'money-ledger',
    local: ledgerNoteMarks(1, true).extra.length,
  },
  {
    page: 'Season › Scenarios',
    file: './season/scenarios/ScenariosTab.tsx',
    surface: 'season-scenarios',
    local: SCENARIO_PAGE_NOTES.length,
  },
  {
    page: 'Season › History',
    file: './season/HistoryTab.tsx',
    surface: null,
    local: HISTORY_NOTES.length,
  },
  {
    page: 'Season › Rules',
    file: './season/rules/RulesTab.tsx',
    surface: null,
    local: RULES_FOOTNOTES.length,
  },
]

const SOURCES = import.meta.glob<string>(
  [
    './**/*.tsx',
    '../../pages/camperships/**/*.tsx',
    '!./**/*.test.tsx',
    '!../../pages/camperships/**/*.test.tsx',
    '!./kit/**',
    '!./shell/**',
  ],
  { query: '?raw', import: 'default', eager: true }
)

describe('the six-note cap (design-language §7)', () => {
  it('reads the server registry (SURFACES is not empty)', () => {
    expect(SURFACES.get('requests')).toBeGreaterThan(0)
    expect(SURFACES.size).toBeGreaterThan(10)
  })

  it.each([...SURFACES.keys()])('server surface %s lists at most 6 notes', (surface) => {
    expect(server(surface)).toBeLessThanOrEqual(NOTES_CAP)
  })

  it.each(PAGE_NOTES.map((p) => [p.page, p] as const))(
    '%s draws at most 6 notes, server plus its own',
    (_, { surface, local }) => {
      expect(local).toBeGreaterThan(0)
      // A renamed or misspelled surface would count as 0 server notes and pass on `local` alone.
      if (surface !== null) expect(SURFACES.has(surface), `${surface} is in SURFACES`).toBe(true)
      expect((surface === null ? 0 : server(surface)) + local).toBeLessThanOrEqual(NOTES_CAP)
    }
  )

  it('knows every page that adds notes of its own (a new one must be listed above)', () => {
    const listed = new Set(PAGE_NOTES.map((p) => p.file))
    const adding = Object.entries(SOURCES)
      .filter(
        ([, source]) =>
          /<AidDefinitionNotes[^>]*\bextra=/.test(source) ||
          /<DefinitionNotes\s+notes=\{(?!table\?\.notes)/.test(source)
      )
      .map(([path]) => path)
    expect(adding.length).toBeGreaterThan(0)
    expect(adding.filter((path) => !listed.has(path))).toEqual([])
  })
})
