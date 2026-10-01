/**
 * "Download CSV" on every Camperships table (§11; D70; Decision 7, RULED 2026-10-01): D70's file
 * name, numbers plain and signed (utils/csvExport.ts writes them as numbers since PR 0), and the
 * view's link after the rows (D15). Built on utils/csvExport.ts.
 */
import { slugify } from '../../../utils/csvExport'
import type { CellValue } from './table'

export interface AidCsvName {
  readonly surface: string
  readonly view?: string | undefined
  readonly filters?: readonly string[] | undefined
  readonly season: number
  readonly asOf?: string | null | undefined
}

export function aidCsvFilename({ surface, view, filters = [], season, asOf }: AidCsvName): string {
  const words = [surface, view, ...filters]
    .filter((word): word is string => typeof word === 'string')
    .map(slugify)
    .filter(Boolean)
  const parts = ['camperships', ...words, String(season), ...(asOf ? [`as-of-${asOf}`] : [])]
  return `${parts.join('-')}.csv`
}

/** A cell's CSV text. Money columns pass `moneyCsv` instead, for its cents rule. */
export function csvCell(value: CellValue): string {
  if (value === null) return ''
  return typeof value === 'number' ? String(value) : value
}

export function withLinkLine(rows: readonly string[][], link: string): string[][] {
  return [...rows, [], ['Link', link]]
}
