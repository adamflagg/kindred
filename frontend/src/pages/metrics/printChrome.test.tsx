/**
 * Ctrl+P on an Analytics page leaves the controls off the paper (#3207 PR 10, rulings #68-#69, and the
 * coordinator's call that EVERY in-page control is chrome). The print rule in index.css hides
 * [data-app-chrome] under the Analytics print frame, so a picker, toggle or button prints unless it sits
 * inside an element carrying that attribute.
 *
 * Reading the source rather than rendering eight pages: each page has its own heavy mock setup, and the
 * question here is structural (is this control inside a chrome element?), which the JSX tree answers.
 * The tag sweep catches a new picker or checkbox the day it is added; buttons and links are mostly data
 * (chart bars, counts, names, sort headers), so the ones that are controls are named below.
 */
import { readdirSync, readFileSync } from 'fs'
import { join, relative, resolve } from 'path'
import { render, screen } from '@testing-library/react'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { TableExportButtons } from '../../components/metrics/TableExportButtons'

vi.mock('../../utils/csvExport', async (orig) => ({
  ...(await orig<typeof import('../../utils/csvExport')>()),
  downloadCsv: vi.fn(),
}))

const SRC = resolve(__dirname, '../..')
const ROOTS = ['pages/metrics', 'components/metrics', 'components/velocity']

/** A control by its tag: wherever one is rendered on an Analytics page, it is inside the chrome. */
const CONTROL_TAGS = new Set([
  'select',
  'input',
  'AidSegmented',
  'GeoLayerToggles',
  'VelocityControls',
  'SnapshotDateSelector',
  'CompareYearSelector',
  'MetricsSessionSelector',
  'YearModeToggle',
  'MetricsTypeTabs',
  'MetricsSubNav',
])

/**
 * Files that are themselves a control (their callers are checked by the sweep above), or that are not
 * on the paper at all.
 */
const EXEMPT_FILES = new Set([
  'components/metrics/MetricsTypeTabs.tsx',
  'components/metrics/MetricsSubNav.tsx',
  'components/metrics/CompareYearSelector.tsx',
  'components/metrics/MetricsSessionSelector.tsx',
  'components/metrics/YearModeToggle.tsx',
  'components/metrics/SnapshotDateSelector.tsx',
  'components/metrics/geo/GeoLayerToggles.tsx',
  'components/velocity/VelocityControls.tsx',
  // A modal over the page; it is not part of the printed sheet.
  'components/metrics/DrillDownModal.tsx',
])

/** Buttons and links that are controls, named by their words. */
const NAMED: ReadonlyArray<{ file: string; tag: string; text: string }> = [
  { file: 'pages/metrics/trends/VelocityPage.tsx', tag: 'button', text: 'Reset' },
  { file: 'pages/metrics/trends/CancellationVelocityPage.tsx', tag: 'button', text: 'Reset' },
  { file: 'pages/metrics/today/RecentSignupsCard.tsx', tag: 'button', text: 'less' },
  { file: 'pages/metrics/today/RecentSignupsCard.tsx', tag: 'button', text: 'View all' },
  { file: 'pages/metrics/today/SessionFillCard.tsx', tag: 'Link', text: 'Availability ›' },
  { file: 'pages/metrics/today/SessionFillCard.tsx', tag: 'Link', text: 'Forecast ›' },
  { file: 'pages/metrics/today/PaceCard.tsx', tag: 'Link', text: 'Velocity ›' },
  { file: 'components/metrics/geo/GeoDetailList.tsx', tag: 'button', text: 'Show less' },
  { file: 'components/metrics/MetricsQueryGuard.tsx', tag: 'button', text: 'Try again' },
]

type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [path] : []
  })
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(resolve(SRC, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
}

function jsxNodes(sf: ts.SourceFile): JsxNode[] {
  const found: JsxNode[] = []
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

function tagOf(node: JsxNode, sf: ts.SourceFile): string {
  return (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText(sf)
}

function attrsOf(node: ts.Node): ts.JsxAttributes | null {
  if (ts.isJsxElement(node)) return node.openingElement.attributes
  if (ts.isJsxSelfClosingElement(node)) return node.attributes
  return null
}

/** The element, or one it sits in within this file, carries data-app-chrome. */
function inChrome(node: ts.Node, sf: ts.SourceFile): boolean {
  for (let at: ts.Node | undefined = node; at; at = at.parent) {
    const attrs = attrsOf(at)
    if (
      attrs?.properties.some(
        (p) => ts.isJsxAttribute(p) && p.name.getText(sf) === 'data-app-chrome'
      )
    )
      return true
  }
  return false
}

/** Every word the element renders: JSX text and string literals, joined. */
function wordsOf(node: ts.Node): string {
  const parts: string[] = []
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n)) parts.push(n.text.trim())
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) parts.push(n.text)
    ts.forEachChild(n, visit)
  }
  visit(node)
  return parts.filter(Boolean).join(' ')
}

const where = (node: ts.Node, sf: ts.SourceFile, file: string) =>
  `${file}:${String(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)}`

describe('Analytics controls stay off the paper (data-app-chrome)', () => {
  const files = ROOTS.flatMap((root) => sourceFiles(resolve(SRC, root))).map((path) =>
    relative(SRC, path)
  )

  it('every picker, checkbox and toggle is inside the chrome', () => {
    const outside: string[] = []
    let seen = 0
    for (const file of files) {
      if (EXEMPT_FILES.has(file)) continue
      const sf = parse(file)
      for (const node of jsxNodes(sf)) {
        if (!CONTROL_TAGS.has(tagOf(node, sf))) continue
        seen += 1
        if (!inChrome(node, sf)) outside.push(`${tagOf(node, sf)} at ${where(node, sf, file)}`)
      }
    }
    // The tabs, the sub-nav, Forecast's date, both velocity control rows, the four zoom pickers,
    // Geographic's layers, Trends' Camp → Teen box and Today's Fill toggle, at least.
    expect(seen).toBeGreaterThanOrEqual(12)
    expect(outside).toEqual([])
  })

  it.each(NAMED)('$file: the "$text" $tag is inside the chrome', ({ file, tag, text }) => {
    const sf = parse(file)
    const matches = jsxNodes(sf).filter(
      (node) => tagOf(node, sf) === tag && wordsOf(node).includes(text)
    )
    expect(matches.length, `${file} renders a "${text}" ${tag}`).toBeGreaterThan(0)
    for (const node of matches) expect(inChrome(node, sf), where(node, sf, file)).toBe(true)
  })

  it('Copy and Download CSV carry the chrome themselves', () => {
    render(<TableExportButtons filename="t.csv" headers={['A']} rows={[[1]]} />)
    expect(
      screen.getByRole('button', { name: /download csv/i }).closest('[data-app-chrome]')
    ).not.toBeNull()
  })
})
