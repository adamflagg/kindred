import { useCallback, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'

import { useAidDefinitions } from '../../../hooks/camperships/useAidDefinitions'
import { useAidStatistics } from '../../../hooks/camperships/useAidStatistics'
import { hasStatus, type AidRequestSet } from '../../../services/camperships/aidApi'
import { AMBER_NOTE } from '../../admin/lodging/lodgingStyles'
import { QueryGuard } from '../../QueryGuard'
import { aidHref, type AidView } from '../kit/asOf'
import {
  CHIP_OFF,
  CHIP_ON,
  COUNT_LINK,
  REPORT_FILTER_LABEL,
  REPORT_FILTERS,
  REPORT_NOTE,
} from '../kit/reportStyles'
import { ReportTable } from '../kit/ReportTable'
import { reportParam, type ReportAddress } from '../requests/reportFilter'
import { requestSetParam } from '../season/scenarios/controlsModel'
import { AidDefinitionNotes } from '../shell/AidDefinitionNotes'
import { ProgramsTable } from './ProgramsTable'
import { ReportControls } from './ReportControls'
import { ROUND_CHIPS, readStatisticsChoice, type StatisticsRows } from './reportParams'
import {
  ALL_TABLES,
  asOfWords,
  cancelledApplicantsLink,
  cancelledColumns,
  cancelledRows,
  notRebuiltWords,
  OUTCOME_COLUMNS,
  outcomeRows,
  requestSetWords,
  statisticsCsvName,
  statisticsHeading,
  statisticsLinkParams,
  tierAppealsColumns,
  tierAppealsRows,
  tierColumns,
  tierRows,
} from './statisticsModel'
import { useReportParam, useReportParams } from './useReportParam'

const PATH = '/aid/reports/statistics'

const ROWS_CHIPS: ReadonlyArray<{ readonly key: StatisticsRows; readonly label: string }> = [
  { key: 'tier', label: 'Income tier' },
  { key: 'session', label: 'Session' },
]

/**
 * Reports › Statistics, this season (spec §9.2, §9.7 RPT-4, 5, 9, 10, 22, 23; D80, D129–D131,
 * D138, D157; statistics-v2.html, S4-1, S4-3): award table × round chips; the reporting controls,
 * off by default; one row per income tier with the server's total; cancelled applicants as their
 * own line; recipients who cancelled; Round 1 and appeals by tier; the March committee's outcomes.
 * Every choice lives in the URL. The award tables and pools are the rules' (through the read). Every
 * count opens the requests behind it in Requests (slice 4 J), on the page's season and as-of.
 */
export function StatisticsTab({ view }: { view: AidView }) {
  const [params] = useSearchParams()
  const choice = useMemo(() => readStatisticsChoice(params), [params])
  const stats = useAidStatistics(choice)
  const { numberOf } = useAidDefinitions('reports-statistics')
  const setParam = useReportParam()
  const setParams = useReportParams()
  const bySession = choice.rows === 'session'
  const link = aidHref(PATH, view, statisticsLinkParams(choice))
  // A refusal (a control the season can't take) shows the server's sentence beside the controls.
  const refusal = stats.error !== null && hasStatus(stats.error, 422) ? stats.error.message : null
  const tables = stats.data?.tables ?? []
  const linkOf = useCallback(
    (address: ReportAddress) => aidHref('/aid/requests', view, { report: reportParam(address) }),
    [view]
  )
  const onRequestSet = useCallback(
    (next: AidRequestSet) => setParam('through', requestSetParam(next)),
    [setParam]
  )

  return (
    <div className="space-y-3">
      <ReportControls
        requestSet={choice.requestSet}
        onRequestSet={onRequestSet}
        decided={bySession ? undefined : choice.decided}
        onDecided={bySession ? undefined : (next) => setParam('decided', next ? '1' : null)}
        asOfWords={
          stats.data
            ? asOfWords(stats.data.figures_on, stats.data.as_of === null, stats.data.rules_version)
            : null
        }
      />
      {refusal !== null && !bySession && <p className={AMBER_NOTE}>{refusal}</p>}
      <div className={REPORT_FILTERS}>
        <span className={REPORT_FILTER_LABEL}>Rows</span>
        {ROWS_CHIPS.map((r) => (
          <button
            key={r.key}
            type="button"
            className={choice.rows === r.key ? CHIP_ON : CHIP_OFF}
            // Session reads no table, round or basis: switching clears them, so a link never lies.
            onClick={() =>
              setParams(
                r.key === 'session'
                  ? { rows: 'session', table: null, round: null, decided: null }
                  : { rows: null }
              )
            }
          >
            {r.label}
          </button>
        ))}
        {bySession ? (
          <span className={`${REPORT_NOTE} ml-3`}>
            Rounds 1, 2 and 3 are columns in the session table
          </span>
        ) : (
          <>
            <span className="bg-border mx-1 h-4 w-px" />
            <span className={REPORT_FILTER_LABEL}>Award table</span>
            {[{ key: null, label: ALL_TABLES }, ...tables].map((t) => (
              <button
                key={t.key ?? 'all'}
                type="button"
                className={choice.table === t.key ? CHIP_ON : CHIP_OFF}
                onClick={() => setParam('table', t.key)}
              >
                {t.label}
              </button>
            ))}
            <span className={`${REPORT_FILTER_LABEL} ml-3`}>Round</span>
            {ROUND_CHIPS.map((r) => (
              <button
                key={r.key}
                type="button"
                className={choice.round === r.key ? CHIP_ON : CHIP_OFF}
                onClick={() => setParam('round', r.key === '1' ? null : r.key)}
              >
                {r.label}
              </button>
            ))}
          </>
        )}
      </div>
      <QueryGuard
        isLoading={stats.isLoading}
        error={stats.data || refusal !== null ? null : stats.error}
        data={stats.data}
        label="Statistics"
        emptyMessage="Nothing to show for these choices."
      >
        {(data) => {
          const setWords = requestSetWords(data)
          const pastWords = notRebuiltWords(data)
          return (
            <div className="space-y-4">
              {setWords !== null && <p className={AMBER_NOTE}>{setWords}</p>}
              {pastWords !== null && <p className={AMBER_NOTE}>{pastWords}</p>}
              {bySession ? (
                <ProgramsTable view={view} requestSet={choice.requestSet} />
              ) : (
                <ReportTable
                  heading={statisticsHeading(data, 'By tier')}
                  basisBadge="P"
                  columns={tierColumns(data, numberOf)}
                  rows={tierRows(data, choice, linkOf)}
                  csvFilename={statisticsCsvName(view, choice, 'by-tier')}
                  link={link}
                  footnote="Each count opens the requests behind it in Requests."
                />
              )}
              <p className={REPORT_NOTE}>
                Cancelled applicants (counted in Apps too, and on their own line here):{' '}
                {data.cancelled_applicants > 0 ? (
                  <Link to={cancelledApplicantsLink(choice, linkOf)} className={COUNT_LINK}>
                    {String(data.cancelled_applicants)}
                  </Link>
                ) : (
                  '0'
                )}
              </p>
              <ReportTable
                heading={statisticsHeading(data, 'Aid recipients who cancelled', false)}
                basisBadge="P"
                columns={cancelledColumns(numberOf)}
                rows={cancelledRows(data, choice, linkOf)}
                csvFilename={statisticsCsvName(view, choice, 'recipients-cancelled')}
                link={link}
                emptyText="No aid recipient has cancelled."
                footnote="Each row is a reason, pool and round: a request posted in two rounds is in two rows, so the rows never add up to the cancelled applicants. The amount is the lock's, even if clawed back since."
              />
              <ReportTable
                heading={statisticsHeading(data, 'Round 1 and appeals by tier', false)}
                basisBadge="P"
                columns={tierAppealsColumns(numberOf)}
                rows={tierAppealsRows(data, choice, linkOf)}
                csvFilename={statisticsCsvName(view, choice, 'tier-appeals')}
                link={link}
              />
              <ReportTable
                heading={statisticsHeading(data, 'March committee outcomes', false)}
                basisBadge="P"
                columns={OUTCOME_COLUMNS}
                rows={outcomeRows(data, choice, linkOf)}
                csvFilename={statisticsCsvName(view, choice, 'outcomes')}
                link={link}
              />
            </div>
          )
        }}
      </QueryGuard>
      <AidDefinitionNotes surface="reports-statistics" />
    </div>
  )
}
