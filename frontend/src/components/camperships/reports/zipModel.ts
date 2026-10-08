/**
 * ZIP codes' tables (spec §9.4; D66, D90; zip-codes.html; owner ruling C). Pure. ZIPs in the server's
 * order (ZIP, then "Outside the US" and "No ZIP on file" last, kept last under any sort), and its
 * totals row, never a sum of the rows (D21). A row is a ZIP, never a family (D90).
 */
import type { ApiAidZip, ApiAidZipTable } from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import { aidCsvFilename } from '../kit/csv'
import {
  countValue,
  moneyValue,
  textValue,
  type ReportColumn,
  type ReportHeading,
  type ReportRow,
} from '../kit/report'
import type { NoteOf } from './statisticsModel'

export function zipColumns(withDollars: boolean, noteOf: NoteOf): ReportColumn[] {
  return [
    { key: 'zip', header: 'ZIP' },
    { key: 'campers', header: 'Campers', note: noteOf('zip_who_counts') },
    { key: 'families', header: 'Families' },
    ...(withDollars ? [{ key: 'dollars', header: 'Dollars' }] : []),
  ]
}

export function zipRows(table: ApiAidZipTable, withDollars: boolean): ReportRow[] {
  const cells = (row: ApiAidZipTable['total'], label: string) => [
    textValue(label),
    countValue(row.campers),
    countValue(row.families),
    ...(withDollars ? [moneyValue(row.dollars)] : []),
  ]
  return [
    ...table.rows.map((row): ReportRow => ({
      key: `${row.kind}-${row.zip}`,
      kind: row.kind === 'us' ? 'body' : 'end',
      cells: cells(row, row.zip),
    })),
    {
      key: 'total',
      kind: 'total',
      cells: cells(table.total, `All · ${String(table.zips)} ZIPs`),
    },
  ]
}

/** With no rules the read sends no groups and an empty `group_label`: the words leave it out. */
export function zipHeading(zip: ApiAidZip, title: string): ReportHeading {
  return {
    title: zip.group_label === '' ? title : `${title} · ${zip.group_label}`,
    season: zip.year,
    figuresOn: zip.figures_on,
    live: true,
    basis: 'P (awarded = Posted) plus every outside grant: all money (D87)',
  }
}

/** The line under the every-camper table: who it counts, and the group when the read names one. */
export function zipScopeWords(zip: ApiAidZip): string {
  return zip.group_label === ''
    ? "Campers enrolled in an aid-eligible session, by their household's billing ZIP."
    : `${zip.group_label}: campers enrolled in an aid-eligible session, by their household's billing ZIP.`
}

/** The group chip's choices: exactly the read's (the rules' pools, then All), never a list here. */
export function zipGroups(zip: ApiAidZip): ReadonlyArray<{ key: string; label: string }> {
  return zip.groups ?? []
}

export function zipCsvName(view: AidView, zip: ApiAidZip, table: string): string {
  return aidCsvFilename({
    surface: 'reports',
    view: `zip-${table}`,
    filters: zip.group === null ? [] : [zip.group],
    season: view.year,
  })
}
