import { useCallback, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'

import { useAidDefinitions } from '../../../hooks/camperships/useAidDefinitions'
import { useAidStatistics } from '../../../hooks/camperships/useAidStatistics'
import { hasStatus, type AidRequestSet } from '../../../services/camperships/aidApi'
import { GROUP, GROUP_BUTTON_OFF, GROUP_BUTTON_ON } from '../../admin/audit/auditStyles'
import { AMBER_NOTE } from '../../admin/lodging/lodgingStyles'
import { QueryGuard } from '../../QueryGuard'
import { aidHref, type AidView } from '../kit/asOf'
import { REPORT_NOTE } from '../kit/reportStyles'
import { ReportTable } from '../kit/ReportTable'
import { reportParam, type ReportAddress } from '../requests/reportFilter'
import { requestSetParam } from '../season/scenarios/controlsModel'
import { AidDefinitionNotes } from '../shell/AidDefinitionNotes'
import { ReportControls } from './ReportControls'
import { ROUND_CHIPS, readStatisticsChoice } from './reportParams'
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
import { useReportParam } from './useReportParam'

const PATH = '/aid/reports/statistics'
const COUNT_LINK = 'text-primary tabular-nums hover:underline'

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
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted-foreground text-xs font-semibold">Award table</span>
        <div className={`${GROUP} w-fit`}>
          <button
            type="button"
            className={choice.table === null ? GROUP_BUTTON_ON : GROUP_BUTTON_OFF}
            onClick={() => setParam('table', null)}
          >
            {ALL_TABLES}
          </button>
          {tables.map((t) => (
            <button
              key={t.key}
              type="button"
              className={choice.table === t.key ? GROUP_BUTTON_ON : GROUP_BUTTON_OFF}
              onClick={() => setParam('table', t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-muted-foreground text-xs font-semibold">Round</span>
        <div className={`${GROUP} w-fit`}>
          {ROUND_CHIPS.map((r) => (
            <button
              key={r.key}
              type="button"
              className={choice.round === r.key ? GROUP_BUTTON_ON : GROUP_BUTTON_OFF}
              onClick={() => setParam('round', r.key === '1' ? null : r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <ReportControls
        requestSet={choice.requestSet}
        onRequestSet={onRequestSet}
        decided={choice.decided}
        onDecided={(next) => setParam('decided', next ? '1' : null)}
        asOfWords={
          stats.data
            ? asOfWords(stats.data.figures_on, stats.data.as_of === null, stats.data.rules_version)
            : null
        }
      />
      {refusal !== null && <p className={AMBER_NOTE}>{refusal}</p>}
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
              <ReportTable
                heading={statisticsHeading(data, 'By tier')}
                basisBadge="P"
                columns={tierColumns(data, numberOf)}
                rows={tierRows(data, choice, linkOf)}
                csvFilename={statisticsCsvName(view, choice, 'by-tier')}
                link={link}
                footnote="Each count opens the requests behind it in Requests."
              />
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
                heading={statisticsHeading(data, 'Aid recipients who cancelled (RPT-22)', false)}
                basisBadge="P"
                columns={cancelledColumns(numberOf)}
                rows={cancelledRows(data, choice, linkOf)}
                csvFilename={statisticsCsvName(view, choice, 'recipients-cancelled')}
                link={link}
                emptyText="No aid recipient has cancelled."
                footnote="Each row is a reason, pool and round: a request posted in two rounds is in two rows, so the rows never add up to the cancelled applicants. The amount is the lock's, even if clawed back since."
              />
              <ReportTable
                heading={statisticsHeading(data, 'Round 1 and appeals by tier (RPT-9)', false)}
                basisBadge="P"
                columns={tierAppealsColumns(numberOf)}
                rows={tierAppealsRows(data)}
                csvFilename={statisticsCsvName(view, choice, 'tier-appeals')}
                link={link}
                footnote="This table's counts open nothing yet: the server doesn't list their requests."
              />
              <ReportTable
                heading={statisticsHeading(data, 'March committee outcomes (RPT-23)', false)}
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
