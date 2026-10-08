import { useMemo, useState } from 'react'

import { useAidDevelopment } from '../../../hooks/camperships/useAidDevelopment'
import { AMBER_NOTE } from '../../admin/lodging/lodgingStyles'
import { QueryGuard } from '../../QueryGuard'
import { AidDefinitionNotes } from '../shell/AidDefinitionNotes'
import { aidHref, type AidView } from '../kit/asOf'
import { REPORT_NOTE } from '../kit/reportStyles'
import { ReportTable } from '../kit/ReportTable'
import { AsOfColumn } from './AsOfColumn'
import {
  datedSeasons,
  developmentColumns,
  type AsOfPick,
  developmentCsvName,
  developmentHeading,
  developmentRows,
  notBuiltLines,
  notRebuiltColumnWords,
  rebuildReason,
  unconfirmedWords,
} from './developmentModel'

const PATH = '/aid/reports/development'

/**
 * Reports › Development › Report (spec §9.4; D65, D66, D87–D94, D96, D99, D158; development-v2.html,
 * S4-4): development's lines by group with seasons from 2022 as columns, all money, never a family.
 * "Show the dashboard's rebuild" stays off with the server's reason while the read doesn't serve it
 * (Decision 16); the as-of column is on demand and saved nowhere (D68). Live only.
 */
export function DevelopmentReport({ view }: { view: AidView }) {
  // The on-demand column lives in component state only: leave the page and it is gone (D68).
  const [asOf, setAsOf] = useState<AsOfPick | null>(null)
  const live = useAidDevelopment()
  const asked = useAidDevelopment(asOf)
  // While the dated read is out, or if it was refused, the live report stays and so does the control.
  const development = asOf !== null && asked.data ? asked : live
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
                <AsOfColumn
                  seasons={seasons}
                  shown={asOf !== null && asked.data ? asOf : null}
                  onShow={setAsOf}
                  onRemove={() => setAsOf(null)}
                  pending={asOf !== null && asked.isFetching}
                  refusal={asOf !== null && asked.isError ? asked.error.message : null}
                />
              </div>
              {rebuild !== null && <p className={REPORT_NOTE}>{`Not built yet: ${rebuild}.`}</p>}
              {notBuiltLines(data).map((line) => (
                <p key={line} className={REPORT_NOTE}>{`Not built yet: ${line}`}</p>
              ))}
              {unconfirmed !== null && <p className={AMBER_NOTE}>{unconfirmed}</p>}
              {notRebuilt !== null && <p className={AMBER_NOTE}>{notRebuilt}</p>}
              <ReportTable
                heading={developmentHeading(data, 'Development report')}
                columns={developmentColumns(data, asOf)}
                rows={developmentRows(data)}
                csvFilename={developmentCsvName(view, 'report')}
                link={link}
                footnote="All money: the camp's awards and every outside grant (D87). r = as reported, typed once; P = the dashboard's. Each line is the server's own figure over every group, money in no group included; the groups under a line are never added up to make it (Money in no group is its own line)."
              />
            </div>
          )
        }}
      </QueryGuard>
      <AidDefinitionNotes surface="reports-development" />
    </div>
  )
}
