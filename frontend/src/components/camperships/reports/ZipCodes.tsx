import { useSearchParams } from 'react-router'

import { useAidDefinitions } from '../../../hooks/camperships/useAidDefinitions'
import { useAidZip } from '../../../hooks/camperships/useAidZip'
import { hasStatus } from '../../../services/camperships/aidApi'
import { GROUP, GROUP_BUTTON_OFF, GROUP_BUTTON_ON } from '../../admin/audit/auditStyles'
import { AMBER_NOTE } from '../../admin/lodging/lodgingStyles'
import { QueryGuard } from '../../QueryGuard'
import { AidDefinitionNotes } from '../shell/AidDefinitionNotes'
import { aidHref, type AidView } from '../kit/asOf'
import { REPORT_NOTE } from '../kit/reportStyles'
import { ReportTable } from '../kit/ReportTable'
import { useReportParam } from './useReportParam'
import { zipColumns, zipCsvName, zipGroups, zipHeading, zipRows, zipScopeWords } from './zipModel'

const PATH = '/aid/reports/development/zip'

/**
 * Reports › Development › ZIP codes (spec §9.4; D66, D90; zip-codes.html; owner ruling C): one
 * season, one group (the chip, `?group=`, from the read's own list; none asks for the server's
 * default, the summer group), two tables: every camper, and campers who got aid with all their
 * money. Each has a totals row, a find box, a sort, Copy and CSV. No family, no drill-down. Live only.
 */
export function ZipCodes({ view }: { view: AidView }) {
  const [params] = useSearchParams()
  const asked = params.get('group')
  const zip = useAidZip(asked === '' ? null : asked)
  const { numberOf } = useAidDefinitions('reports-development-zip')
  const setParam = useReportParam()
  const refusal = zip.error !== null && hasStatus(zip.error, 422) ? zip.error.message : null

  return (
    <div className="space-y-3">
      {refusal !== null && (
        <p className={AMBER_NOTE}>
          {`${refusal} `}
          <button type="button" className="underline" onClick={() => setParam('group', null)}>
            Show the Default Group
          </button>
        </p>
      )}
      <QueryGuard
        isLoading={zip.isLoading}
        error={zip.data || refusal !== null ? null : zip.error}
        data={zip.data}
        label="ZIP codes"
        emptyMessage="Nothing to show for this group."
      >
        {(data) => {
          const groups = zipGroups(data)
          const link = aidHref(PATH, view, data.group === null ? {} : { group: data.group })
          return (
            <div className="space-y-4">
              {groups.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-muted-foreground text-xs font-semibold">Group</span>
                  <div className={`${GROUP} w-fit`}>
                    {groups.map((g) => (
                      <button
                        key={g.key}
                        type="button"
                        className={data.group === g.key ? GROUP_BUTTON_ON : GROUP_BUTTON_OFF}
                        onClick={() => setParam('group', g.key)}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {data.not_built.map((item) => (
                <p key={item.figure} className={REPORT_NOTE}>{`Not built yet: ${item.reason}.`}</p>
              ))}
              <div className="grid gap-4 xl:grid-cols-2">
                <ReportTable
                  heading={zipHeading(data, 'Every camper')}
                  columns={zipColumns(false, numberOf)}
                  rows={zipRows(data.every_camper, false)}
                  csvFilename={zipCsvName(view, data, 'every-camper')}
                  link={link}
                  find
                  sortable
                  urlPrefix="every_"
                  description={zipScopeWords(data)}
                  defaultSort={{ key: 'campers', dir: 'desc' }}
                />
                {/* With no aid table, the server's own "Not built yet" line above says why. */}
                {data.with_aid !== null && (
                  <ReportTable
                    heading={zipHeading(data, 'Campers who got aid')}
                    columns={zipColumns(true, numberOf)}
                    rows={zipRows(data.with_aid, true)}
                    csvFilename={zipCsvName(view, data, 'with-aid')}
                    link={link}
                    find
                    sortable
                    urlPrefix="aid_"
                    description="The same campers, attended and got money from any source: the camp's awards and every outside grant. A household-level grant lands on its household's ZIP."
                    defaultSort={{ key: 'campers', dir: 'desc' }}
                  />
                )}
              </div>
              <p className={REPORT_NOTE}>
                Small groups show as they are, a ZIP with one family included: a row is a ZIP, never
                a family (D66, D90).
              </p>
            </div>
          )
        }}
      </QueryGuard>
      <AidDefinitionNotes surface="reports-development-zip" />
    </div>
  )
}
