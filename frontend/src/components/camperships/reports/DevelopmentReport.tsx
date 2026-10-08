import { useMemo } from 'react'

import { useAidDevelopment } from '../../../hooks/camperships/useAidDevelopment'
import { AMBER_NOTE } from '../../admin/lodging/lodgingStyles'
import { QueryGuard } from '../../QueryGuard'
import { AidDefinitionNotes } from '../shell/AidDefinitionNotes'
import { aidHref, type AidView } from '../kit/asOf'
import { REPORT_NOTE } from '../kit/reportStyles'
import { ReportTable } from '../kit/ReportTable'
import { DatedColumns } from './DatedColumns'
import {
  datedSeasons,
  developmentColumns,
  developmentCsvName,
  developmentHeading,
  developmentRows,
  notBuiltLines,
  notRebuiltColumnWords,
  rebuildReason,
  SOURCE_COLUMNS,
  sourceRows,
  unconfirmedWords,
} from './developmentModel'

const PATH = '/aid/reports/development'

/**
 * Reports › Development › Report (spec §9.4; D65, D66, D87–D94, D96, D99, D158; development-v2.html,
 * S4-4): development's lines by group with seasons from 2022 as columns, all money, never a family.
 * "Show the dashboard's rebuild" stays off with the server's reason while the read doesn't serve it
 * (Decision 16); dated columns are saved with the report (Decision 17). Live only.
 */
export function DevelopmentReport({ view }: { view: AidView }) {
  const development = useAidDevelopment()
  const link = aidHref(PATH, view)
  const seasons = useMemo(
    () => (development.data ? datedSeasons(development.data) : []),
    [development.data]
  )

  return (
    <div className="space-y-3">
      <QueryGuard
        isLoading={development.isLoading}
        error={development.data ? null : development.error}
        data={development.data}
        label="the Development report"
      >
        {(data) => {
          const rebuild = rebuildReason(data)
          const unconfirmed = unconfirmedWords(data)
          const notRebuilt = notRebuiltColumnWords(data)
          return (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-4">
                {rebuild !== null && (
                  <label className="text-muted-foreground flex items-center gap-1.5 text-sm">
                    <input type="checkbox" disabled checked={false} readOnly />
                    Show the dashboard&apos;s rebuild for 2022–2025
                  </label>
                )}
                <DatedColumns seasons={seasons} />
              </div>
              {rebuild !== null && <p className={REPORT_NOTE}>{`Not built yet: ${rebuild}.`}</p>}
              {notBuiltLines(data).map((line) => (
                <p key={line} className={REPORT_NOTE}>{`Not built yet: ${line}`}</p>
              ))}
              {unconfirmed !== null && <p className={AMBER_NOTE}>{unconfirmed}</p>}
              {notRebuilt !== null && <p className={AMBER_NOTE}>{notRebuilt}</p>}
              <ReportTable
                heading={developmentHeading(data, 'Development report')}
                columns={developmentColumns(data)}
                rows={developmentRows(data)}
                csvFilename={developmentCsvName(view, 'report')}
                link={link}
                footnote="All money: the camp's awards and every outside grant (D87). r = as reported, typed once; P = the dashboard's. Every group is the server's own figure over every group, money in no group included, never the groups shown added up."
              />
              <ReportTable
                heading={developmentHeading(data, `${String(data.year)} by source`)}
                basisBadge="P"
                columns={SOURCE_COLUMNS}
                rows={sourceRows(data)}
                csvFilename={developmentCsvName(view, 'sources')}
                link={link}
                emptyText="No money given yet this season."
                footnote="Each source with its three facts (D88): who paid, incentive or need-based, and the source."
              />
            </div>
          )
        }}
      </QueryGuard>
      <AidDefinitionNotes surface="reports-development" />
    </div>
  )
}
