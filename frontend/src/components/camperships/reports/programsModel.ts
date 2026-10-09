/**
 * Reports › Programs' table (spec §9.3; RPT-11; statistics-v2.html's Programs): one row per session,
 * grouped by pool with the server's subtotals, then its total. Round 1 and Round 2 carry the
 * sheet's six columns, Round 3 two, then total awarded. Pure; every figure is the server's (D21),
 * subtotals are its pooled ratios. Sessions and pools are named by the server (the rules). Each block's
 * Apps opens the requests behind it (slice 4 J, #2974's `/programs/requests`).
 */
import type { ApiAidProgramRow, ApiAidPrograms, ApiAidRoundBlock } from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import { aidCsvFilename } from '../kit/csv'
import {
  BASIS_WORDS,
  countValue,
  averageValue,
  moneyValue,
  pctValue,
  textValue,
  type ReportColumn,
  type ReportHeading,
  type ReportRow,
  type ReportValue,
} from '../kit/report'
import type { AidRequestSet } from '../../../services/camperships/aidApi'
import type { ReportAddress } from '../requests/reportFilter'
import { requestSetParam } from '../season/scenarios/controlsModel'
import { requestSetQuery } from './reportParams'
import type { LinkOf, NoteOf } from './statisticsModel'

export function programColumns(noteOf: NoteOf): ReportColumn[] {
  const six = (group: string, asked: string): ReportColumn[] => [
    { key: `${group}-apps`, header: 'Apps', group, note: noteOf('apps'), divider: 'before' },
    { key: `${group}-requested`, header: asked, group },
    { key: `${group}-awarded`, header: 'Awarded', group, note: noteOf('awarded') },
    { key: `${group}-avgRequest`, header: 'Avg request', group },
    { key: `${group}-avgAward`, header: 'Avg award', group, note: noteOf('average_award') },
    { key: `${group}-pct`, header: '% awarded', group, note: noteOf('pct_of_ask') },
  ]
  return [
    { key: 'session', header: 'Session' },
    ...six('Round 1', 'Requested'),
    ...six('Round 2 (appeals)', 'Asked'),
    { key: 'r3-apps', header: 'Apps', group: 'Round 3', divider: 'before' },
    { key: 'r3-awarded', header: 'Awarded', group: 'Round 3' },
    { key: 'total', header: 'Total awarded', divider: 'before' },
  ]
}

function sixCells(block: ApiAidRoundBlock): ReportValue[] {
  return [
    countValue(block.apps),
    moneyValue(block.requested),
    moneyValue(block.awarded),
    averageValue(block.average_request),
    averageValue(block.average_award),
    pctValue(block.pct_awarded),
  ]
}

/** Each round block's Apps cell, by index: Round 1's, Round 2's, Round 3's (see `programColumns`). */
const APPS_CELLS = [
  [1, '1'],
  [7, '2'],
  [13, '3'],
] as const

/** A row's Apps links: `part` names the row (#2974: session, subtotal, total), one per round block. */
function appsLinks(
  requestSet: AidRequestSet,
  part: Readonly<Record<string, string>>,
  linkOf: LinkOf
): Record<number, string> {
  const links: Record<number, string> = {}
  for (const [cell, block] of APPS_CELLS) {
    const address: ReportAddress = {
      report: 'programs',
      query: { ...requestSetQuery(requestSet), ...part, block, count: 'apps' },
    }
    links[cell] = linkOf(address)
  }
  return links
}

function cells(label: string, row: ApiAidProgramRow): ReportValue[] {
  return [
    textValue(label),
    ...sixCells(row.round1),
    ...sixCells(row.round2),
    countValue(row.round3.apps),
    moneyValue(row.round3.awarded),
    moneyValue(row.total_awarded),
  ]
}

export function programRows(
  programs: ApiAidPrograms,
  requestSet: AidRequestSet,
  linkOf: LinkOf
): ReportRow[] {
  const rows: ReportRow[] = []
  for (const pool of programs.pools) {
    const key = pool.pool ?? 'none'
    // the no-pool group is the route's pool-absent group
    const inPool: Record<string, string> = pool.pool === null ? {} : { pool: pool.pool }
    rows.push({ key: `heading-${key}`, kind: 'heading', cells: [textValue(pool.pool_label)] })
    pool.sessions.forEach((session, index) => {
      rows.push({
        key: `session-${key}-${String(session.session_cm_id)}-${String(index)}`,
        kind: 'body',
        indent: 1,
        cells: cells(session.session_name, session),
        // session 0 is "session not matched": the route takes it as such
        links: appsLinks(
          requestSet,
          { part: 'session', ...inPool, session: String(session.session_cm_id) },
          linkOf
        ),
      })
    })
    rows.push({
      key: `subtotal-${key}`,
      kind: 'subtotal',
      cells: cells(`${pool.pool_label} subtotal`, pool.subtotal),
      links: appsLinks(requestSet, { part: 'subtotal', ...inPool }, linkOf),
    })
  }
  rows.push({
    key: 'total',
    kind: 'total',
    cells: cells(programs.total.session_name, programs.total),
    links: appsLinks(requestSet, { part: 'total' }, linkOf),
  })
  return rows
}

export function programsHeading(programs: ApiAidPrograms): ReportHeading {
  return {
    title: 'By session',
    season: programs.year,
    figuresOn: programs.figures_on,
    live: programs.as_of === null,
    basis: BASIS_WORDS.P,
    requestSet: programs.request_set?.label ?? null,
  }
}

export function programsLinkParams(requestSet: AidRequestSet): Record<string, string> {
  const through = requestSetParam(requestSet)
  return through === null ? { rows: 'session' } : { rows: 'session', through }
}

export function programsCsvName(view: AidView, requestSet: AidRequestSet): string {
  const through = requestSetParam(requestSet)
  return aidCsvFilename({
    surface: 'reports',
    view: 'statistics-by-session',
    filters: through === null ? [] : [`through-${through}`],
    season: view.year,
    asOf: view.asOf.kind === 'past' ? view.asOf.date : null,
  })
}
