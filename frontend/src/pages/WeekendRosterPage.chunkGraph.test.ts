/**
 * jsdom cannot prove bundling. `WeekendRosterPage.codeSplitting.test.tsx`
 * proves React DEFERS RENDERING the board/map behind Suspense — but that
 * test passed on both sides of kindred#2057's review findings: whether the
 * emitted BUNDLE actually keeps `LodgingBoard`/`LodgingMap` out of the
 * app's eager (non-`import()`) chunk graph is invisible from inside jsdom.
 * Both majors that review caught — the `components/weekend` barrel
 * re-exporting the two components (so the shared "weekend" chunk pulled
 * both in via a bare side-effect import), and `mapModel.ts` getting
 * co-located inside `LodgingMap`'s own chunk (so the eager `countMapUnits`
 * import dragged the whole map chunk in with it) — were real regressions
 * that every render-behavior test kept passing straight through.
 *
 * This runs a REAL `vite build` (the project's own `vite.config.ts`, into a
 * throwaway outDir) and inspects the emitted chunk graph directly: is
 * `LodgingBoard-*.js` or `LodgingMap-*.js` reachable from anywhere via a
 * STATIC `import … from "./X.js"` edge? Rolldown emits every `React.lazy`
 * dynamic `import()` with a BACKTICK-quoted specifier (`import(\`./x.js\`)`),
 * so the quote-based regex below only ever matches genuine static edges —
 * the lazy load itself can never trip this check by construction.
 *
 * Slow (a real build, not a jsdom render), so it lives on its own rather
 * than inside `WeekendRosterPage.codeSplitting.test.tsx`.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'

const STATIC_IMPORT_RE = /import(?:\s*\{[^}]*\}\s*from)?\s*["']\.\/([^"']+\.js)["']/g

let outDir: string
let assetsDir: string
let chunkFiles: string[]

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'weekend-chunk-graph-'))
  await build({
    configFile: join(import.meta.dirname, '../../vite.config.ts'),
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true, sourcemap: false },
  })
  assetsDir = join(outDir, 'assets')
  chunkFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.js'))
}, 60_000)

afterAll(() => {
  if (outDir && existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
})

/** There's exactly one emitted chunk per source page/component — the hash
 * in the filename is the only thing that varies between builds. */
function findChunk(prefix: string): string {
  const matches = chunkFiles.filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.js'))
  expect(
    matches,
    `expected exactly one ${prefix}-*.js chunk, found ${JSON.stringify(matches)}`
  ).toHaveLength(1)
  return matches[0]!
}

/** Every chunk holding a STATIC `import … from "./targetChunk"` edge. */
function staticImportersOf(targetChunk: string): string[] {
  const importers: string[] = []
  for (const file of chunkFiles) {
    if (file === targetChunk) continue
    const content = readFileSync(join(assetsDir, file), 'utf-8')
    for (const match of content.matchAll(STATIC_IMPORT_RE)) {
      if (match[1] === targetChunk) importers.push(file)
    }
  }
  return importers
}

describe('weekend route chunk graph (kindred#2057 review)', () => {
  it('LodgingBoard has no static importers — only the dynamic import() in WeekendRosterPage reaches it', () => {
    const lodgingBoard = findChunk('LodgingBoard')
    expect(staticImportersOf(lodgingBoard)).toEqual([])
  })

  it('LodgingMap has no static importers — only the dynamic import() in WeekendRosterPage reaches it', () => {
    const lodgingMap = findChunk('LodgingMap')
    expect(staticImportersOf(lodgingMap)).toEqual([])
  })

  it('neither weekend route chunk (roster or lander) statically imports LodgingBoard or LodgingMap', () => {
    const lodgingBoard = findChunk('LodgingBoard')
    const lodgingMap = findChunk('LodgingMap')
    const rosterPage = findChunk('WeekendRosterPage')
    const sessionList = findChunk('WeekendSessionList')

    for (const routeChunk of [rosterPage, sessionList]) {
      const content = readFileSync(join(assetsDir, routeChunk), 'utf-8')
      const staticTargets = [...content.matchAll(STATIC_IMPORT_RE)].map((m) => m[1])
      expect(staticTargets).not.toContain(lodgingBoard)
      expect(staticTargets).not.toContain(lodgingMap)
    }
  })
})
