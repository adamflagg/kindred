import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'

import { useAidDefinitions } from '../../../hooks/camperships/useAidDefinitions'
import { useAidPrograms } from '../../../hooks/camperships/useAidPrograms'
import { hasStatus, type AidRequestSet } from '../../../services/camperships/aidApi'
import { AMBER_NOTE } from '../../admin/lodging/lodgingStyles'
import { QueryGuard } from '../../QueryGuard'
import { aidHref, type AidView } from '../kit/asOf'
import { ReportTable } from '../kit/ReportTable'
import { reportParam, type ReportAddress } from '../requests/reportFilter'
import { parseRequestSet, requestSetParam } from '../season/scenarios/controlsModel'
import { AidDefinitionNotes } from '../shell/AidDefinitionNotes'
import {
  programColumns,
  programRows,
  programsCsvName,
  programsHeading,
  programsLinkParams,
} from './programsModel'
import { ReportControls } from './ReportControls'
import { asOfWords, notRebuiltWords, requestSetWords } from './statisticsModel'
import { useReportParam } from './useReportParam'

/**
 * Reports › Programs (spec §9.3; RPT-11; D129, D138; statistics-v2.html's Programs, S4-1): one row
 * per session grouped by pool, with the server's pooled subtotals and its total, on the Posted
 * basis; the reporting controls apply (`?through=`). Sessions and pools come from the rules. Each
 * block's Apps opens its requests in Requests (slice 4 J).
 */
export function ProgramsTab({ view }: { view: AidView }) {
  const [params] = useSearchParams()
  const throughRaw = params.get('through')
  const requestSet = useMemo(() => parseRequestSet(throughRaw), [throughRaw])
  const programs = useAidPrograms(requestSet)
  const { numberOf } = useAidDefinitions('reports-programs')
  const setParam = useReportParam()
  const refusal =
    programs.error !== null && hasStatus(programs.error, 422) ? programs.error.message : null
  const onRequestSet = useCallback(
    (next: AidRequestSet) => setParam('through', requestSetParam(next)),
    [setParam]
  )
  const columns = useMemo(() => programColumns(numberOf), [numberOf])
  const linkOf = useCallback(
    (address: ReportAddress) => aidHref('/aid/requests', view, { report: reportParam(address) }),
    [view]
  )

  return (
    <div className="space-y-3">
      <ReportControls
        requestSet={requestSet}
        onRequestSet={onRequestSet}
        asOfWords={
          programs.data
            ? asOfWords(
                programs.data.figures_on,
                programs.data.as_of === null,
                programs.data.rules_version
              )
            : null
        }
      />
      {refusal !== null && <p className={AMBER_NOTE}>{refusal}</p>}
      <QueryGuard
        isLoading={programs.isLoading}
        error={programs.data || refusal !== null ? null : programs.error}
        data={programs.data}
        label="Programs"
        emptyMessage="Nothing to show for these choices."
      >
        {(data) => {
          const setWords = requestSetWords(data)
          const pastWords = notRebuiltWords(data)
          return (
            <div className="space-y-3">
              {setWords !== null && <p className={AMBER_NOTE}>{setWords}</p>}
              {pastWords !== null && <p className={AMBER_NOTE}>{pastWords}</p>}
              <ReportTable
                heading={programsHeading(data)}
                basisBadge="P"
                columns={columns}
                rows={programRows(data, requestSet, linkOf)}
                csvFilename={programsCsvName(view, requestSet)}
                link={aidHref('/aid/reports/programs', view, programsLinkParams(requestSet))}
                emptyText="No sessions in the rules yet."
                footnote="Subtotals are pooled ratios, not averages of the rows. Sessions come from the rules. Each Apps count opens the requests behind it in Requests."
              />
            </div>
          )
        }}
      </QueryGuard>
      <AidDefinitionNotes surface="reports-programs" />
    </div>
  )
}
