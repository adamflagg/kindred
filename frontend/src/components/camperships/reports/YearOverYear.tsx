import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'

import { useAidCommitteeReport } from '../../../hooks/camperships/useAidCommitteeReport'
import { useAidDefinitions } from '../../../hooks/camperships/useAidDefinitions'
import { hasStatus, type AidRequestSet } from '../../../services/camperships/aidApi'
import { AMBER_NOTE } from '../../admin/lodging/lodgingStyles'
import { QueryGuard } from '../../QueryGuard'
import { parseRequestSet, requestSetParam } from '../season/scenarios/controlsModel'
import { AidDefinitionNotes } from '../shell/AidDefinitionNotes'
import { aidHref, type AidView } from '../kit/asOf'
import { CHIP_OFF, CHIP_ON, REPORT_FILTER_LABEL, REPORT_NOTE } from '../kit/reportStyles'
import { ReportTable } from '../kit/ReportTable'
import {
  appealsColumns,
  appealsRows,
  applicationColumns,
  applicationRows,
  budgetColumns,
  budgetRows,
  committeeCsvName,
  committeeHeading,
  parsePhaseShare,
  phaseColumns,
  phaseLabels,
  phaseRows,
  round1Rows,
  ROUND1_COLUMNS,
} from './committeeModel'
import { ReportControls } from './ReportControls'
import { useReportParam } from './useReportParam'

const PATH = '/aid/reports/statistics/year-over-year'

/**
 * Statistics › Year over year (spec §9.7 RPT-1, 2, 6, 7, 8, 13, 24; S4-2; statistics-v2.html): the
 * committee's tables from one read, each season row marked P or r. `?phases=share` shows each phase
 * as a share of the phases' sum (default: % of budget, R1); `?through=<date>` moves this season's
 * RPT-2 cutoff off the application deadline. Live only.
 */
export function YearOverYear({ view }: { view: AidView }) {
  const [params] = useSearchParams()
  const share = parsePhaseShare(params.get('phases'))
  const throughRaw = params.get('through')
  const requestSet = useMemo(() => parseRequestSet(throughRaw), [throughRaw])
  const committee = useAidCommitteeReport(requestSet)
  const { numberOf } = useAidDefinitions('reports-committee')
  const setParam = useReportParam()
  const refusal =
    committee.error !== null && hasStatus(committee.error, 422) ? committee.error.message : null
  const onRequestSet = useCallback(
    (next: AidRequestSet) => setParam('through', requestSetParam(next)),
    [setParam]
  )
  const through = requestSetParam(requestSet)
  const link = aidHref(PATH, view, {
    ...(share === 'share' ? { phases: 'share' } : {}),
    ...(through === null ? {} : { through }),
  })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className={REPORT_FILTER_LABEL}>Phases shown as</span>
        <button
          type="button"
          className={share === 'budget' ? CHIP_ON : CHIP_OFF}
          onClick={() => setParam('phases', null)}
        >
          % of budget
        </button>
        <button
          type="button"
          className={share === 'share' ? CHIP_ON : CHIP_OFF}
          onClick={() => setParam('phases', 'share')}
        >
          share of the phases
        </button>
        <span className={REPORT_NOTE}>
          P = the dashboard&apos;s Posted; r = as reported, typed once. The dashboard computes every
          %.
        </span>
      </div>
      <ReportControls
        requestSet={requestSet}
        onRequestSet={onRequestSet}
        showDeadline={false}
        asOfWords="Applications are counted at the Round 1 deadline unless a date is set"
      />
      {refusal !== null && <p className={AMBER_NOTE}>{refusal}</p>}
      <QueryGuard
        isLoading={committee.isLoading}
        error={committee.data || refusal !== null ? null : committee.error}
        data={committee.data}
        label="year-over-year"
        emptyMessage="Nothing to show for this date."
      >
        {(data) => (
          <div className="space-y-4">
            {data.not_built.map((item) => (
              <p key={item.figure} className={REPORT_NOTE}>
                {`Not built yet: ${item.reason}`}
              </p>
            ))}
            <ReportTable
              heading={committeeHeading(data, 'Round 1 phases, year over year (RPT-1)')}
              columns={phaseColumns(share, numberOf, phaseLabels(data))}
              rows={phaseRows(data, share)}
              csvFilename={committeeCsvName(view, 'phases', share)}
              link={link}
              emptyText="No season has phases yet."
              footnote="Phase 1 is Round 1 money on requests received by the deadline; phase 2, Round 1 after it; phase 3, appeals (D155). As offered never changes after posting; End of season is net of cancellations, and reads to date until the season closes. The band compares As offered."
            />
            <ReportTable
              heading={committeeHeading(
                data,
                'Applications and Round 1 ask at the cutoff (RPT-2, RPT-6)'
              )}
              columns={applicationColumns(numberOf)}
              rows={applicationRows(data)}
              csvFilename={committeeCsvName(view, 'applications', share)}
              link={link}
              footnote="Round 1 asks only, as they stood at the cutoff; appeals are never part of it. A row headed headline − Σ pools is a typed season whose pools don't add up, shown rather than hidden."
            />
            <ReportTable
              heading={committeeHeading(data, 'Budget against actuals by pool (RPT-7, RPT-24)')}
              columns={budgetColumns(numberOf)}
              rows={budgetRows(data)}
              csvFilename={committeeCsvName(view, 'budget', share)}
              link={link}
              footnote="The camp's own money only, never Total Awards Granted (D106). The rules split is a reference (D119)."
            />
            <ReportTable
              heading={committeeHeading(data, 'Applications and appeals (RPT-8)')}
              columns={appealsColumns(numberOf)}
              rows={appealsRows(data)}
              csvFilename={committeeCsvName(view, 'appeals', share)}
              link={link}
              footnote="Finance's appeals: requests with any Round 2 or later ask, cancelled included. Not Development's appeals figure (a different population)."
            />
            <ReportTable
              heading={committeeHeading(data, '% of ask awarded in Round 1 (RPT-13)')}
              columns={ROUND1_COLUMNS}
              rows={round1Rows(data)}
              csvFilename={committeeCsvName(view, 'round1', share)}
              link={link}
            />
          </div>
        )}
      </QueryGuard>
      <AidDefinitionNotes surface="reports-committee" />
    </div>
  )
}
