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
    { key: 'zip', header: 'ZIP', mono: true, note: noteOf('zip_zip'), title: 'Sort by ZIP' },
    {
      key: 'campers',
      header: 'Campers',
      // The aid table's campers are the ones who got money: its note is the Dollars one (the mock's 2).
      note: noteOf(withDollars ? 'zip_dollars' : 'zip_who_counts'),
      title: 'Sort by Campers',
    },
    {
      key: 'families',
      header: 'Families',
      note: noteOf('zip_families'),
      title: 'Sort by Families',
    },
    ...(withDollars
      ? [
          {
            key: 'dollars',
            header: 'Dollars',
            note: noteOf('zip_dollars'),
            title: 'Sort by Dollars',
          },
        ]
      : []),
  ]
}

export function zipRows(table: ApiAidZipTable, withDollars: boolean): ReportRow[] {
  const cells = (row: ApiAidZipTable['total'], label: string) => [
    textValue(label),
    countValue(row.campers),
    countValue(row.families),
    ...(withDollars ? [moneyValue(row.dollars)] : []),
  ]
  const ends = table.rows.filter((row) => row.kind !== 'us').map((row) => row.zip)
  return [
    ...table.rows.map((row): ReportRow => ({
      key: `${row.kind}-${row.zip}`,
      kind: row.kind === 'us' ? 'body' : 'end',
      cells: cells(row, row.zip),
    })),
    {
      key: 'total',
      kind: 'total',
      cells: [
        {
          ...textValue(`All · ${String(table.zips)} ZIPs`),
          title: `All ${String(table.zips)} ZIPs${ends.length > 0 ? `, with ${ends.join(' and ')}` : ''}: the server's total, never a sum of the rows shown`,
        },
        ...cells(table.total, '').slice(1),
      ],
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
    basis: 'P (awarded = Posted) plus every outside grant: all money',
  }
}

/** The every-camper table's description (its title's hover): who it counts, and the group when the read names one. */
export function zipScopeWords(zip: ApiAidZip): string {
  return zip.group_label === ''
    ? "Campers enrolled in an aid-eligible session, by their household's billing ZIP."
    : `${zip.group_label}: campers enrolled in an aid-eligible session, by their household's billing ZIP.`
}

/** The aid table's description, in its title's hover. */
export const ZIP_AID_WORDS =
  "The same campers, attended and got money from any source: the camp's awards and every outside grant. A household-level grant lands on its household's ZIP."

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

/**
 * Why there's no aid table yet, in plain words (the table's own empty row): the server's reason carries an internal id.
 * Before 2027 the mock's words; a 2027-or-later season (rules with no groups) waits on its own decisions (ruling 10-09).
 */
export function noAidWords(zip: ApiAidZip): string | null {
  if (zip.with_aid !== null) return null
  const year = String(zip.year)
  return zip.year < 2027
    ? `No aid table for ${year}: it starts with 2027, the first season decided in the dashboard.`
    : `No aid table for ${year} yet: it starts with that season's decisions.`
}
