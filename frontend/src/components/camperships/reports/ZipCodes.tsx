import { useSearchParams } from 'react-router'

import { useAidDefinitions } from '../../../hooks/camperships/useAidDefinitions'
import { useAidZip } from '../../../hooks/camperships/useAidZip'
import { hasStatus } from '../../../services/camperships/aidApi'
import { QueryGuard } from '../../QueryGuard'
import { AidDefinitionNotes } from '../shell/AidDefinitionNotes'
import { aidHref, type AidView } from '../kit/asOf'
import { CS_FLABEL, CS_SMALL, CS_TOOLBAR } from '../kit/csType'
import { AidFilterChip } from '../kit/Toolbar'
import { AidSegmented } from '../kit/Segmented'
import { ReportTable } from '../kit/ReportTable'
import { useReportParam } from './useReportParam'
import {
  ZIP_AID_WORDS,
  noAidWords,
  zipColumns,
  zipCsvName,
  zipGroups,
  zipHeading,
  zipRows,
  zipScopeWords,
} from './zipModel'

const PATH = '/aid/reports/zip-codes'

/**
 * Reports › ZIP codes (spec §9.4; D66, D90; zip-codes.html; owner ruling C): one
 * season, one group (the chip, `?group=`, from the read's own list; none asks for the server's
 * default, the summer group), two tables: every camper, and campers who got aid with all their
 * money. Each sits in a bounded scroll card with its totals row pinned first under the header, a find box, a sort,
 * Copy and CSV; its description is its title's hover. No family, no drill-down. Live only.
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
        // Final mock: an old link's unknown group is an amber chip in the Group row, never a sentence above the page.
        <>
          <div className={CS_TOOLBAR}>
            <span className={CS_FLABEL}>Group</span>
            <AidFilterChip
              warn
              title={`${refusal} ✕ shows the default group.`}
              onClear={() => setParam('group', null)}
            >
              {`No group “${asked ?? ''}”`}
            </AidFilterChip>
          </div>
          <p className={CS_SMALL}>
            Nothing to show for that group. ✕ on the chip shows the default group.
          </p>
        </>
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
                <div className={CS_TOOLBAR}>
                  <span className={CS_FLABEL}>Group</span>
                  <AidSegmented
                    label="Group"
                    value={data.group ?? ''}
                    options={groups.map((g) => ({ value: g.key, label: g.label }))}
                    onChange={(key) => setParam('group', key)}
                  />
                </div>
              )}
              {/* minmax(0, 1fr): a track may shrink below its table's width, so a heading row never spills past its card. */}
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <ReportTable
                  heading={zipHeading(data, 'Every camper')}
                  hint={zipScopeWords(data)}
                  columns={zipColumns(false, numberOf)}
                  rows={zipRows(data.every_camper, false)}
                  csvFilename={zipCsvName(view, data, 'every-camper')}
                  link={link}
                  find
                  findPlaceholder="Find a ZIP"
                  findNoun="ZIPs"
                  findWidth={104}
                  sortable
                  totalsFirst
                  bounded
                  urlPrefix="every_"
                  defaultSort={{ key: 'campers', dir: 'desc' }}
                />
                <ReportTable
                  heading={zipHeading(data, 'Campers who got aid')}
                  hint={ZIP_AID_WORDS}
                  columns={zipColumns(true, numberOf)}
                  rows={data.with_aid === null ? [] : zipRows(data.with_aid, true)}
                  emptyText={noAidWords(data) ?? undefined}
                  csvFilename={zipCsvName(view, data, 'with-aid')}
                  link={link}
                  find={data.with_aid !== null}
                  tools={data.with_aid !== null}
                  findPlaceholder="Find a ZIP"
                  findNoun="ZIPs"
                  findWidth={104}
                  sortable
                  totalsFirst
                  bounded
                  urlPrefix="aid_"
                  defaultSort={{ key: 'campers', dir: 'desc' }}
                />
              </div>
            </div>
          )
        }}
      </QueryGuard>
      <AidDefinitionNotes surface="reports-development-zip" />
    </div>
  )
}
