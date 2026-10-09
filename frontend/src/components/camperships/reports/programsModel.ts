/**
 * Statistics' By session table (spec §9.3; RPT-11; the approved final mock reports-statistics.html; once
 * Reports › Programs): one row per session, grouped by pool with the server's subtotals, then its total;
 * an award table narrows it to that table's pools. Round 1 and Round 2 carry the
 * sheet's six columns, Round 3 two, then total awarded. Pure; every figure is the server's (D21),
 * subtotals are its pooled ratios. Sessions and pools are named by the server (the rules). Each block's
 * Apps opens the requests behind it (slice 4 J, #2974's `/programs/requests`).
 */
import { createElement } from 'react'

import type {
  ApiAidProgramPool,
  ApiAidProgramRow,
  ApiAidPrograms,
  ApiAidRoundBlock,
} from '../../../types/api-types'
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
import { SessionNameCell } from './SessionNameCell'
import { sessionNameTitle } from './sessionNameTitle'
import type { LinkOf, NoteOf } from './statisticsModel'

export function programColumns(noteOf: NoteOf): ReportColumn[] {
  // The mock's widths: a long session name takes the rest; four ratio headers per block may wrap.
  const six = (
    group: string,
    asked: string,
    w: readonly [number, number, number, number, number, number]
  ): ReportColumn[] => [
    {
      key: `${group}-apps`,
      header: 'Apps',
      group,
      note: noteOf('apps'),
      divider: 'before',
      width: w[0],
    },
    { key: `${group}-requested`, header: asked, group, width: w[1] },
    { key: `${group}-awarded`, header: 'Awarded', group, note: noteOf('awarded'), width: w[2] },
    { key: `${group}-avgRequest`, header: 'Avg request', group, wrap: true, width: w[3] },
    {
      key: `${group}-avgAward`,
      header: 'Avg award',
      group,
      note: noteOf('average_award'),
      wrap: true,
      width: w[4],
    },
    {
      key: `${group}-pct`,
      header: '% awarded',
      group,
      note: noteOf('pct_of_ask'),
      wrap: true,
      width: w[5],
    },
  ]
  return [
    { key: 'session', header: 'Session' },
    ...six('Round 1', 'Requested', [56, 84, 84, 66, 66, 70]),
    ...six('Round 2 (appeals)', 'Asked', [50, 70, 76, 62, 62, 70]),
    { key: 'r3-apps', header: 'Apps', group: 'Round 3', divider: 'before', width: 48 },
    { key: 'r3-awarded', header: 'Awarded', group: 'Round 3', width: 72 },
    {
      key: 'total',
      header: 'Total awarded',
      divider: 'before',
      wrap: true,
      width: 84,
      title: 'Rounds 1–3 Posted, net of clawbacks',
    },
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

function cells(label: ReportValue, row: ApiAidProgramRow): ReportValue[] {
  return [
    label,
    ...sixCells(row.round1),
    ...sixCells(row.round2),
    countValue(row.round3.apps),
    moneyValue(row.round3.awarded),
    moneyValue(row.total_awarded),
  ]
}

/** The award table chosen, as the session rows filter by it: its pools and its (full) name. */
export interface SessionTableChoice {
  readonly pools: readonly string[]
  readonly label: string
}

const POOLED = 'subtotals and this total are pooled ratios, not averages of the rows'

/**
 * The rows: each pool's heading, sessions and subtotal, then the total. With an award table chosen, only
 * the pool groups that table sits in (the no-pool group never), and the total is that table's: the single
 * pool's own server subtotal. Over several pools there is no server total and a client sum would be an
 * estimate (D21), so there is no total row.
 */
export function programRows(
  programs: ApiAidPrograms,
  requestSet: AidRequestSet,
  linkOf: LinkOf,
  table: SessionTableChoice | null = null
): ReportRow[] {
  const rows: ReportRow[] = []
  const set = programs.request_set
  const counts = set === null ? '' : `: counts only ${set.label}`
  const groups: readonly ApiAidProgramPool[] =
    table === null
      ? programs.pools
      : programs.pools.filter((g) => g.pool !== null && table.pools.includes(g.pool))
  for (const pool of groups) {
    const key = pool.pool ?? 'none'
    // the no-pool group is the route's pool-absent group
    const inPool: Record<string, string> = pool.pool === null ? {} : { pool: pool.pool }
    const family = pool.sessions.some((s) => (s.session_type ?? '') === 'family')
    rows.push({
      key: `heading-${key}`,
      kind: 'heading',
      cells: [textValue(pool.pool_label)],
      meta: `${String(pool.sessions.length)} session${pool.sessions.length === 1 ? '' : 's'}${family ? ' · Family Camp apps count households' : ''}`,
    })
    pool.sessions.forEach((session, index) => {
      const type = session.session_type ?? ''
      rows.push({
        key: `session-${key}-${String(session.session_cm_id)}-${String(index)}`,
        // "Session not matched" sits in the no-pool group: muted italic, as the mock draws it
        kind: pool.pool === null ? 'end' : 'body',
        indent: 1,
        cells: cells(
          {
            ...textValue(session.session_name),
            title: sessionNameTitle(session.session_name, type),
            display: createElement(SessionNameCell, {
              name: session.session_name,
              sessionType: type,
            }),
          },
          session
        ),
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
      cells: cells(
        {
          ...textValue(`${pool.pool_label} subtotal`),
          title: `${pool.pool_label} subtotal: pooled ratios, not averages of the rows`,
        },
        pool.subtotal
      ),
      links: appsLinks(requestSet, { part: 'subtotal', ...inPool }, linkOf),
    })
  }
  if (table === null) {
    rows.push(
      totalRow(
        programs.total,
        programs.total.session_name,
        counts,
        { part: 'total' },
        requestSet,
        linkOf
      )
    )
  } else if (groups.length === 1 && groups[0] !== undefined && groups[0].pool !== null) {
    const only = groups[0]
    const pool = groups[0].pool
    rows.push(
      totalRow(only.subtotal, table.label, counts, { part: 'subtotal', pool }, requestSet, linkOf)
    )
  }
  return rows
}

function totalRow(
  source: ApiAidProgramRow,
  label: string,
  counts: string,
  part: Readonly<Record<string, string>>,
  requestSet: AidRequestSet,
  linkOf: LinkOf
): ReportRow {
  return {
    key: 'total',
    kind: 'total',
    // this table has no heading row of its own, so its basis badge sits at the total label's end
    badge: 'P',
    cells: cells({ ...textValue(label), title: `${label}${counts} · ${POOLED}` }, source),
    links: appsLinks(requestSet, part, linkOf),
  }
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
