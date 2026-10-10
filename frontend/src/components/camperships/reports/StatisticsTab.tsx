import { useCallback, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'

import { useAidDefinitions } from '../../../hooks/camperships/useAidDefinitions'
import { useAidPrograms } from '../../../hooks/camperships/useAidPrograms'
import { useAidStatistics } from '../../../hooks/camperships/useAidStatistics'
import { hasStatus, type AidRequestSet } from '../../../services/camperships/aidApi'
import { QueryGuard } from '../../QueryGuard'
import { aidHref, type AidView } from '../kit/asOf'
import { CS_FLABEL } from '../kit/csType'
import { AidCopyButton, AidCsvButton } from '../kit/CsvButton'
import { AidSegmented } from '../kit/Segmented'
import { AidToolbar, ToolbarLabel } from '../kit/Toolbar'
import { useReportExport } from '../kit/useReportExport'
import { COUNT_LINK, DECIDED_INK, REPORT_NOTE } from '../kit/reportStyles'
import { ReportTable } from '../kit/ReportTable'
import type { ReportColumn, ReportHeading, ReportRow } from '../kit/report'
import { reportParam, type ReportAddress } from '../requests/reportFilter'
import { requestSetParam } from '../season/scenarios/controlsModel'
import { AidDefinitionNotes } from '../shell/AidDefinitionNotes'
import {
  programColumns,
  programRows,
  programsCsvName,
  programsHeading,
  programsNotes,
  programsLinkParams,
} from './programsModel'
import { RequestSetPicker } from './RequestSetPicker'
import { ROUND_CHIPS, readStatisticsChoice, type RoundChip } from './reportParams'
import {
  notRebuiltWords,
  OUTCOME_COLUMNS,
  outcomeRows,
  requestSetLeftOut,
  statisticsCsvName,
  statisticsHeading,
  statisticsLinkParams,
  cancelledApplicantsLink,
  tierNotes,
  cancelledColumns,
  cancelledRows,
  tableShortLabel,
  tierAppealsColumns,
  tierAppealsRows,
  tierColumns,
  tierRows,
} from './statisticsModel'
import { useReportParam, useReportParams } from './useReportParam'

const PATH = '/aid/reports/statistics'

const NO_COLUMNS: readonly ReportColumn[] = []
const NO_ROWS: readonly ReportRow[] = []
const NO_HEADING: ReportHeading = {
  title: 'By tier',
  season: 0,
  figuresOn: '1970-01-01',
  live: true,
  basis: null,
}

const SESSION_ROUND_WHY =
  'On Session rows every round is already a column block (Round 1 · Round 2 (appeals) · Round 3 · Total awarded), so Round stays at All.'
const SESSION_DECIDED_WHY =
  "Not on Session rows yet: the session figures don't carry Decided amounts. Income tier rows have it."
const CHECK = 'inline-flex flex-none items-center gap-1.5 whitespace-nowrap'

/**
 * Reports › Statistics, this season (spec §9.2, §9.7; D80, D129–D131, D138, D157; the approved final
 * mock reports-statistics.html): ONE controls row (Rows · Award table · Round · the Requests picker ·
 * Include not yet offered; Copy and Download CSV of the first table at its right, its status in the
 * row), then the first table (By tier or By session, no heading row of its own), the cancelled
 * applicants' line, recipients who cancelled, Round 1 and appeals by tier and the March committee's
 * outcomes, then six notes. Every choice lives in the URL. Every count opens the requests behind it.
 */
export function StatisticsTab({ view }: { view: AidView }) {
  const [params] = useSearchParams()
  const choice = useMemo(() => readStatisticsChoice(params), [params])
  const bySession = choice.rows === 'session'
  const stats = useAidStatistics(choice)
  const programs = useAidPrograms(choice.requestSet, bySession)
  const { numberOf, entries } = useAidDefinitions('reports-statistics')
  const setParam = useReportParam()
  const setParams = useReportParams()
  const link = aidHref(PATH, view, statisticsLinkParams(choice))
  const linkOf = useCallback(
    (address: ReportAddress) => aidHref('/aid/requests', view, { report: reportParam(address) }),
    [view]
  )
  // A refusal (a control the season can't take) shows the server's sentence in the controls row.
  const refusal =
    [stats.error, bySession ? programs.error : null]
      .map((e) => (e !== null && hasStatus(e, 422) ? e.message : null))
      .find((m) => m !== null) ?? null
  const data = stats.data
  const tables = data?.tables ?? []
  const chosen = tables.find((t) => t.key === choice.table)
  const sessionTable =
    chosen === undefined ? null : { pools: chosen.pools ?? [], label: chosen.label }
  const requestSetNote =
    (bySession ? programs.data : data)?.request_set ?? data?.request_set ?? null

  // The first table: By tier, or By session. Its Copy and Download CSV live on the controls row.
  const first = (() => {
    if (bySession) {
      if (!programs.data) return null
      return {
        title: 'By session',
        heading: programsHeading(programs.data),
        columns: programColumns(numberOf),
        rows: programRows(programs.data, choice.requestSet, linkOf, sessionTable),
        csvFilename: programsCsvName(view, choice.requestSet, choice.table),
        link: aidHref(PATH, view, programsLinkParams(choice.requestSet, choice.table)),
      }
    }
    if (!data) return null
    return {
      title: 'By tier',
      heading: statisticsHeading(data, 'By tier', true, tierNotes(data.total)),
      columns: tierColumns(data, numberOf),
      rows: tierRows(data, choice, linkOf),
      csvFilename: statisticsCsvName(view, choice, 'by-tier'),
      link,
    }
  })()
  const exporter = useReportExport({
    heading: first?.heading ?? NO_HEADING,
    columns: first?.columns ?? NO_COLUMNS,
    rows: first?.rows ?? NO_ROWS,
    csvFilename: first?.csvFilename ?? 'statistics.csv',
    link: first?.link ?? link,
  })

  const decidedNote = entries.find((e) => e.key === 'decided_not_offered')?.text
  const pastWords = data ? notRebuiltWords(data) : null
  const status = refusal ?? exporter.failed ?? pastWords ?? undefined
  const onRequestSet = (next: AidRequestSet) => setParam('through', requestSetParam(next))
  const leftOut = data ? requestSetLeftOut(data) : null
  const tierFootnote = data ? tierNotes(data.total).join(' ') : null
  const sessionFootnote = programs.data ? programsNotes(programs.data).join(' ') : ''

  const controls = (
    <AidToolbar
      {...(status === undefined ? {} : { status })}
      statusWarn={refusal !== null}
      left={
        <>
          <ToolbarLabel text="Rows" plain>
            <AidSegmented
              label="Rows"
              value={choice.rows}
              options={[
                { value: 'tier', label: 'Income tier', title: 'One row per income tier' },
                {
                  value: 'session',
                  label: 'Session',
                  title: 'One row per session, grouped by pool; every round is a column block',
                },
              ]}
              // Session reads no round or basis: switching clears them, so a link never lies. The award
              // table stays: it filters the session rows to its pool.
              onChange={(next) =>
                setParams(
                  next === 'session'
                    ? { rows: 'session', round: null, decided: null }
                    : { rows: null }
                )
              }
            />
          </ToolbarLabel>
          <ToolbarLabel text="Award table" plain>
            <AidSegmented
              label="Award table"
              value={choice.table ?? ''}
              options={[
                { value: '', label: 'All', title: 'All award tables' },
                ...tables.map((t) => ({
                  value: t.key,
                  label: tableShortLabel(t),
                  title: t.label,
                })),
              ]}
              onChange={(next) => setParam('table', next === '' ? null : next)}
            />
          </ToolbarLabel>
          <ToolbarLabel text="Round" plain>
            <AidSegmented<RoundChip>
              label="Round"
              value={bySession ? 'all' : choice.round}
              options={ROUND_CHIPS.map((r) => ({
                value: r.key,
                label: r.label,
                title: bySession && r.key !== 'all' ? SESSION_ROUND_WHY : r.title,
                disabled: bySession && r.key !== 'all',
              }))}
              onChange={(next) => setParam('round', next === '1' ? null : next)}
            />
          </ToolbarLabel>
          <RequestSetPicker
            value={choice.requestSet}
            note={requestSetNote}
            onChange={onRequestSet}
          />
          <label
            className={`${CHECK} ${CS_FLABEL} ${choice.decided && !bySession ? DECIDED_INK : ''} ${bySession ? 'cursor-not-allowed opacity-45' : ''}`}
            title={bySession ? SESSION_DECIDED_WHY : (decidedNote ?? 'Include not yet offered')}
          >
            <input
              type="checkbox"
              checked={!bySession && choice.decided}
              disabled={bySession}
              onChange={(event) => setParam('decided', event.target.checked ? '1' : null)}
            />
            Include not yet offered
          </label>
        </>
      }
      right={
        <>
          <AidCopyButton
            copied={exporter.copied}
            disabled={first === null}
            title={`Copy the ${first?.title ?? 'first'} table, to paste into a deck`}
            onCopy={() => void exporter.copy()}
          />
          <AidCsvButton
            disabled={first === null}
            title={`${first?.title ?? 'First table'} · CSV, with this view's link on its last line`}
            onDownload={exporter.download}
          />
        </>
      }
    />
  )

  return (
    <div className="space-y-2">
      {controls}
      <QueryGuard
        isLoading={stats.isLoading}
        error={stats.data || refusal !== null ? null : stats.error}
        data={stats.data}
        label="Statistics"
        emptyMessage="Nothing to show for these choices."
      >
        {(stat) => (
          <div className="space-y-4">
            {bySession ? (
              <QueryGuard
                isLoading={programs.isLoading}
                error={programs.data || refusal !== null ? null : programs.error}
                data={programs.data}
                label="the session table"
                emptyMessage="Nothing to show for these choices."
              >
                {() =>
                  first && (
                    <ReportTable
                      showHeading={false}
                      fixed
                      heading={first.heading}
                      columns={first.columns}
                      rows={first.rows}
                      csvFilename={first.csvFilename}
                      link={first.link}
                      emptyText="No sessions in the rules yet."
                      {...(sessionFootnote === ''
                        ? {}
                        : { footnote: <p className={REPORT_NOTE}>{sessionFootnote}</p> })}
                    />
                  )
                }
              </QueryGuard>
            ) : (
              first && (
                <ReportTable
                  showHeading={false}
                  fixed
                  heading={first.heading}
                  columns={first.columns}
                  rows={first.rows}
                  csvFilename={first.csvFilename}
                  link={first.link}
                  {...(tierFootnote === null
                    ? {}
                    : { footnote: <p className={REPORT_NOTE}>{tierFootnote}</p> })}
                />
              )
            )}
            <p className={REPORT_NOTE}>
              Cancelled applicants, counted in Apps too:{' '}
              {stat.cancelled_applicants > 0 ? (
                <Link to={cancelledApplicantsLink(choice, linkOf)} className={COUNT_LINK}>
                  {String(stat.cancelled_applicants)}
                </Link>
              ) : (
                '0'
              )}
              {leftOut !== null && ` · ${String(leftOut)} requests received later are left out`}
            </p>
            <ReportTable
              fixed
              heading={statisticsHeading(stat, 'Aid recipients who cancelled', false)}
              basisBadge="P"
              description="A request posted in two rounds is in two rows, so rows never add up to the cancelled applicants. Amounts are the lock's."
              columns={cancelledColumns(numberOf)}
              rows={cancelledRows(stat, choice, linkOf)}
              csvFilename={statisticsCsvName(view, choice, 'recipients-cancelled')}
              link={link}
              emptyText="No aid recipient has cancelled."
            />
            <ReportTable
              fixed
              heading={statisticsHeading(stat, 'Round 1 and appeals by tier', false)}
              basisBadge="P"
              description="Each tier's appeals are counted at their Round 2 tier, and its apps at Round 1's."
              columns={tierAppealsColumns(numberOf)}
              rows={tierAppealsRows(stat, choice, linkOf)}
              csvFilename={statisticsCsvName(view, choice, 'tier-appeals')}
              link={link}
            />
            <ReportTable
              fixed
              heading={statisticsHeading(stat, 'March committee outcomes', false)}
              basisBadge="P"
              description="The offers the March committee made, and what families did with them."
              columns={OUTCOME_COLUMNS}
              rows={outcomeRows(stat, choice, linkOf)}
              csvFilename={statisticsCsvName(view, choice, 'outcomes')}
              link={link}
            />
          </div>
        )}
      </QueryGuard>
      <AidDefinitionNotes surface="reports-statistics" />
    </div>
  )
}
