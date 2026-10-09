import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'

import { useAidCommitteeReport } from '../../../hooks/camperships/useAidCommitteeReport'
import { useAidDefinitions } from '../../../hooks/camperships/useAidDefinitions'
import { hasStatus } from '../../../services/camperships/aidApi'
import { QueryGuard } from '../../QueryGuard'
import { parseRequestSet, requestSetParam } from '../season/scenarios/controlsModel'
import { AidDefinitionNotes } from '../shell/AidDefinitionNotes'
import { aidHref, type AidView } from '../kit/asOf'
import { CS_DATE, CS_FLABEL } from '../kit/csType'
import { formatLongDate, formatShortDate } from '../kit/dates'
import { ReportTable } from '../kit/ReportTable'
import { AidSegmented } from '../kit/Segmented'
import { AidToolbar, ToolbarLabel } from '../kit/Toolbar'
import {
  appealsColumns,
  appealsRows,
  applicationColumns,
  applicationRows,
  applicationsUnder,
  budgetColumns,
  budgetRows,
  committeeCsvName,
  committeeHeading,
  parsePhaseShare,
  parsePools,
  phaseColumns,
  phaseLabels,
  phaseRows,
  reconciliationWords,
} from './committeeModel'
import { useReportParam } from './useReportParam'

const PATH = '/aid/reports/year-over-year'
const CHECK = 'inline-flex flex-none items-center gap-1.5 whitespace-nowrap'
const DATE_OFF = 'Off while Through the R1 deadline is checked: uncheck it to type or pick any date'
const DATE_ON =
  "The cutoff table counts applications received through this day. Moves this season's cutoff only; a typed season keeps the deck's date, and the other tables never move."

/**
 * Reports › Year over year (spec §9.7; the approved final mock reports-yoy.html): ONE controls row
 * (Phases as · Pools · Through the R1 deadline · Received through), then four tables from one read,
 * each season marked P or r, then six notes. `?phases=share` shows each phase as a share of the
 * phases' sum; `?pools=pool` splits the cutoff, budget and Round 1 tables by pool; `?through=<date>`
 * moves this season's cutoff off the application deadline. Live only.
 */
export function YearOverYear({ view }: { view: AidView }) {
  const [params] = useSearchParams()
  const share = parsePhaseShare(params.get('phases'))
  const pools = parsePools(params.get('pools'))
  const throughRaw = params.get('through')
  const requestSet = useMemo(() => parseRequestSet(throughRaw), [throughRaw])
  const committee = useAidCommitteeReport(requestSet)
  const { numberOf } = useAidDefinitions('reports-committee')
  const setParam = useReportParam()
  const refusal =
    committee.error !== null && hasStatus(committee.error, 422) ? committee.error.message : null
  // A refused date refuses only the cutoff table: the other three never read it, so they come from a
  // second read without the date (enabled only while refused).
  const fallback = useAidCommitteeReport({ kind: 'all' }, refusal !== null)
  const through = requestSetParam(requestSet)
  const link = aidHref(PATH, view, {
    ...(share === 'share' ? { phases: 'share' } : {}),
    ...(pools === 'pool' ? { pools: 'pool' } : {}),
    ...(through === null ? {} : { through }),
  })

  // The Round 1 deadline is the cutoff of this season's headline row while no date is typed.
  const data = committee.data
  const onDeadline = requestSet.kind !== 'date'
  const deadline =
    data === undefined || !onDeadline
      ? null
      : (data.applications.find(
          (row) => row.year === data.year && row.kind === 'headline' && row.cutoff !== null
        )?.cutoff ?? null)
  const typed = requestSet.kind === 'date' ? requestSet.date : null
  const status = (() => {
    if (refusal !== null) {
      return `⚠ Can't count at ${typed === null ? 'this date' : formatLongDate(typed)}: ${refusal}`
    }
    if (typed !== null && data !== undefined && typed > data.figures_on) {
      return `Counts to today, ${formatShortDate(data.figures_on)}`
    }
    return undefined
  })()
  const onThroughDeadline = useCallback(
    (checked: boolean) => {
      // Unchecking keeps the deadline as the typed date: the user edits from where the figures are.
      setParam('through', checked ? null : (deadline ?? data?.figures_on ?? null))
    },
    [setParam, deadline, data?.figures_on]
  )

  const controls = (
    <AidToolbar
      {...(status === undefined ? {} : { status })}
      statusWarn={refusal !== null}
      left={
        <>
          <ToolbarLabel text="Phases as" plain>
            <AidSegmented
              label="Phases as"
              value={share}
              options={[
                { value: 'budget', label: '% of budget' },
                { value: 'share', label: 'Share of the phases' },
              ]}
              onChange={(next) => setParam('phases', next === 'share' ? 'share' : null)}
            />
          </ToolbarLabel>
          <ToolbarLabel text="Pools" plain>
            <AidSegmented
              label="Pools"
              value={pools}
              options={[
                { value: 'all', label: 'All pools' },
                { value: 'pool', label: 'By pool' },
              ]}
              onChange={(next) => setParam('pools', next === 'pool' ? 'pool' : null)}
            />
          </ToolbarLabel>
          <label
            className={`${CHECK} ${CS_FLABEL} text-foreground`}
            title={`Count applications received by the Round 1 deadline${deadline === null ? '' : `, ${formatLongDate(deadline)}`} (the default)`}
          >
            <input
              type="checkbox"
              checked={onDeadline}
              onChange={(event) => onThroughDeadline(event.target.checked)}
            />
            Through the R1 deadline
          </label>
          <ToolbarLabel text="Received through">
            <input
              type="date"
              className={CS_DATE}
              title={onDeadline ? DATE_OFF : DATE_ON}
              value={typed ?? deadline ?? ''}
              disabled={onDeadline}
              onChange={(event) => setParam('through', event.target.value || null)}
            />
          </ToolbarLabel>
        </>
      }
    />
  )

  return (
    <div className="space-y-3">
      {controls}
      <QueryGuard
        isLoading={committee.isLoading || (refusal !== null && fallback.isLoading)}
        error={committee.data || refusal !== null ? null : committee.error}
        data={committee.data ?? (refusal !== null ? fallback.data : undefined)}
        label="year-over-year"
        emptyMessage="Nothing to show for this date."
      >
        {(report) => {
          const csv = (table: string) => committeeCsvName(view, table, share, pools)
          return (
            <div className="space-y-4">
              <ReportTable
                heading={committeeHeading(report, 'Round 1 phases, year over year')}
                description="how much went out by the deadline, after it, and in appeals"
                columns={phaseColumns(share, numberOf, phaseLabels(report))}
                rows={phaseRows(report, share)}
                csvFilename={csv('phases')}
                link={link}
                emptyText="No season has phases yet."
                footnote={reconciliationWords(report) ?? undefined}
              />
              {refusal !== null && typed !== null ? (
                <ReportTable
                  heading={committeeHeading(report, 'Applications and Round 1 ask at the cutoff')}
                  description={`Received through ${formatLongDate(typed)}`}
                  columns={applicationColumns(numberOf)}
                  rows={[]}
                  csvFilename={csv('applications')}
                  link={link}
                  emptyBody={
                    <>
                      <b className="text-foreground">{`Nothing to count at ${formatLongDate(typed)}:`}</b>
                      {` ${refusal.replace(/\.$/, '')}. Pick a later date, or check Through the R1 deadline.`}
                    </>
                  }
                />
              ) : (
                <ReportTable
                  heading={committeeHeading(report, 'Applications and Round 1 ask at the cutoff')}
                  description={
                    pools === 'pool'
                      ? 'each pool, then all pools'
                      : 'all pools · By pool splits them'
                  }
                  columns={applicationColumns(numberOf)}
                  rows={applicationRows(report, pools)}
                  csvFilename={csv('applications')}
                  link={link}
                  footnote={applicationsUnder(report) ?? undefined}
                />
              )}
              <ReportTable
                fixed
                heading={committeeHeading(report, 'Budget against actuals by pool')}
                description={
                  pools === 'pool' ? 'every season by pool' : 'all pools, and this season by pool'
                }
                columns={budgetColumns(numberOf)}
                rows={budgetRows(report, pools)}
                csvFilename={csv('budget')}
                link={link}
              />
              <ReportTable
                heading={committeeHeading(report, 'Appeals and % of ask in Round 1')}
                description={
                  pools === 'pool'
                    ? 'this season by pool; appeals count once per season'
                    : "all pools · By pool splits this season's Round 1"
                }
                columns={appealsColumns(numberOf, pools)}
                rows={appealsRows(report, pools)}
                csvFilename={csv('appeals')}
                link={link}
              />
            </div>
          )
        }}
      </QueryGuard>
      <AidDefinitionNotes surface="reports-committee" />
    </div>
  )
}
