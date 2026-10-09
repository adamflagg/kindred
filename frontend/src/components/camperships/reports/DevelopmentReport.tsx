import { useMemo, useState } from 'react'

import { aidSection, visibleSections, visibleTabs } from '../../../config/aidNav'
import { useAidDefinitions } from '../../../hooks/camperships/useAidDefinitions'
import { useAidDevelopment } from '../../../hooks/camperships/useAidDevelopment'
import { usePermissions } from '../../../hooks/usePermissions'
import { QueryGuard } from '../../QueryGuard'
import { aidHref, type AidView } from '../kit/asOf'
import { CS_FLABEL } from '../kit/csType'
import { AidCopyButton, AidCsvButton } from '../kit/CsvButton'
import { formatShortDate } from '../kit/dates'
import { DefinitionNotes } from '../kit/DefinitionNotes'
import { REPORT_NOTE, REPORT_TITLE } from '../kit/reportStyles'
import { ReportTable } from '../kit/ReportTable'
import { AidToolbar } from '../kit/Toolbar'
import { useReportExport } from '../kit/useReportExport'
import { AsOfColumn } from './AsOfColumn'
import {
  AS_REPORTED_NOTE_KEY,
  cappedWords,
  datedSeasons,
  developmentColumns,
  developmentCsvName,
  developmentHeading,
  developmentTable,
  rebuildReason,
  SHOW_REBUILD_SWITCH,
  type AsOfPick,
} from './developmentModel'

const PATH = '/aid/reports/development'
const TITLE = 'Development report'

/**
 * Reports › Development › Report (spec §9.4; D65, D66, D87–D94, D96, D99, D158; the approved final mock
 * reports-development): ONE toolbar row (the title · Show As Of a Date… | status · Copy · Download CSV),
 * then development's lines by group with seasons as columns, As reported and The dashboard in two groups,
 * all money, never a family; one muted line under the table when requests were capped, then six notes.
 * The rebuild switch is hidden until the backfill exists (`SHOW_REBUILD_SWITCH`); the as-of column is on
 * demand and saved nowhere (D68). Live only.
 */
export function DevelopmentReport({ view }: { view: AidView }) {
  // The on-demand column lives in component state only: leave the page and it is gone (D68).
  const [asOf, setAsOf] = useState<AsOfPick | null>(null)
  const live = useAidDevelopment()
  const asked = useAidDevelopment(asOf)
  // While the dated read is out, or if it was refused, the live report stays and so does the control.
  const development = asOf !== null && asked.data ? asked : live
  const link = aidHref(PATH, view)
  // Each funder line opens its group on Money › Funders, for a user who can open that tab.
  const { hasPermission } = usePermissions()
  const fundersHref = useMemo(
    () =>
      visibleSections({ hasPermission }).some((section) => section.key === 'money') &&
      visibleTabs(aidSection('money'), { hasPermission }).some((tab) => tab.slug === 'funders')
        ? (params: Readonly<Record<string, string>>) => aidHref('/aid/money/funders', view, params)
        : undefined,
    [hasPermission, view]
  )
  // The registry's six notes, numbered in the registry's order (the final mock's six).
  const definitions = useAidDefinitions('reports-development')
  const data = development.data
  const table = useMemo(
    () => (data ? developmentTable(data, { fundersHref, registry: definitions.entries }) : null),
    [data, fundersHref, definitions.entries]
  )
  const seasons = useMemo(() => (data ? datedSeasons(data) : []), [data])
  const shown = asOf !== null && asked.data ? asOf : null
  const asReportedAt = definitions.entries.findIndex((entry) => entry.key === AS_REPORTED_NOTE_KEY)
  const columns = useMemo(
    () =>
      data
        ? developmentColumns(data, asOf, {
            asReportedNote: asReportedAt < 0 ? null : asReportedAt + 1,
          })
        : [],
    [data, asOf, asReportedAt]
  )
  const rows = table?.rows ?? []
  const exporter = useReportExport({
    heading: data ? developmentHeading(data, TITLE) : EMPTY_HEADING,
    columns,
    rows,
    csvFilename: developmentCsvName(view, 'report'),
    link,
    copiedWords: '✓ Copied',
  })
  // A refusal (today or later) is the status slot, in warn tone, the server's full words in its title.
  const refusal = asOf !== null && asked.isError ? asked.error.message : null
  const status =
    refusal !== null && asOf !== null
      ? `⚠ Can't show ${formatShortDate(asOf.day)}: pick a day before today`
      : (exporter.copied ?? undefined)

  return (
    <div className="space-y-3">
      <AidToolbar
        {...(status === undefined ? {} : { status })}
        {...(refusal === null ? {} : { statusTitle: refusal })}
        statusWarn={refusal !== null}
        left={
          <>
            <h2 className={`${REPORT_TITLE} shrink-0 whitespace-nowrap`}>{TITLE}</h2>
            <span className="bg-border h-5 w-px flex-none" />
            <AsOfColumn
              seasons={seasons}
              shown={shown}
              onShow={setAsOf}
              onRemove={() => setAsOf(null)}
              pending={asOf !== null && asked.isFetching}
            />
            {SHOW_REBUILD_SWITCH && data && rebuildReason(data) !== null && (
              <label className={`${CS_FLABEL} inline-flex items-center gap-1.5`}>
                <input type="checkbox" disabled checked={false} readOnly />
                Show the dashboard&apos;s rebuild for 2022–2025
              </label>
            )}
          </>
        }
        right={
          <>
            <AidCopyButton disabled={data === undefined} onCopy={() => void exporter.copy()} />
            <AidCsvButton disabled={data === undefined} onDownload={exporter.download} />
          </>
        }
      />
      <QueryGuard
        isLoading={development.isLoading}
        error={data ? null : development.error}
        data={data}
        label="the Development report"
      >
        {(read) => {
          const capped = cappedWords(read)
          return (
            <ReportTable
              showHeading={false}
              fixed
              heading={developmentHeading(read, TITLE)}
              columns={columns}
              rows={rows}
              csvFilename={developmentCsvName(view, 'report')}
              link={link}
              footnote={capped === null ? undefined : <p className={REPORT_NOTE}>{capped}</p>}
            />
          )
        }}
      </QueryGuard>
      {definitions.error && definitions.entries.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-xs">
          The definitions for these figures couldn&apos;t load.
        </p>
      ) : (
        <DefinitionNotes notes={table?.notes ?? []} />
      )}
    </div>
  )
}

const EMPTY_HEADING = {
  title: TITLE,
  season: 0,
  figuresOn: '1970-01-01',
  live: true,
  basis: null,
} as const
