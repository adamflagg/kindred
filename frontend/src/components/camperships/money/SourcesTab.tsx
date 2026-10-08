import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { Permission } from '../../../constants/permissions'
import { useAidFundingSources } from '../../../hooks/camperships/useAidFundingSources'
import { useAidProgramNames } from '../../../hooks/camperships/useAidProgramNames'
import { useAidSources } from '../../../hooks/camperships/useAidSources'
import { usePermissions } from '../../../hooks/usePermissions'
import type { ApiAidFundingSource, ApiAidSourceRow } from '../../../types/api-types'
import { GROUP, GROUP_BUTTON_OFF, GROUP_BUTTON_ON } from '../../admin/audit/auditStyles'
import { QueryGuard } from '../../QueryGuard'
import { aidHref, type AidView } from '../kit/asOf'
import { AidTable, type AidColumn } from '../kit/AidTable'
import { CS_AMBER_NOTE, CS_LINK, CS_PMETA } from '../kit/csType'
import { moneyCsv } from '../kit/money'
import { Money } from '../kit/MoneyText'
import { StatusPill } from '../kit/Pills'
import { AidDefinitionNotes } from '../shell/AidDefinitionNotes'
import { SourceOpenRow, type SourceAccess } from './SourceOpenRow'
import {
  grantorWords,
  incentiveWords,
  isUnclassified,
  lastChangeWords,
  needsGroupWords,
  parseShow,
  shownSources,
  sourcesCsvName,
  whoPaidWords,
  type SourcesShow,
} from './sourcesModel'
import { DONE_NOTE } from './toPlaceStyles'

const sourceKey = (row: ApiAidSourceRow) => row.id
const yesNo = (value: boolean) => (value ? 'yes' : '—')
const NO_FUNDING: readonly ApiAidFundingSource[] = []

/**
 * Money › Sources (spec §8.1; D58, D88, D100, D105, D159, D160; money-v2.html Sources; P-12 to P-14,
 * ruling H): the one registry of CampMinder descriptions, this season's lines and $ on each, chips
 * All · Needs a group · Unclassified (`?show=`), a row opened from a link (`?row=<source id>`). The
 * reporting group is Funding sources' (joined on `source_id`). Classify… / Edit… and Set a Group…
 * are `rules`; the grantor is `grantors`. Live only.
 */
export function SourcesTab({ view }: { view: AidView }) {
  const sources = useAidSources()
  const funding = useAidFundingSources()
  const names = useAidProgramNames()
  const { hasPermission } = usePermissions()
  const [params, setParams] = useSearchParams()
  const show = parseShow(params.get('show'))
  const highlighted = params.get('row')
  const [result, setResult] = useState<{ words: string; year: number } | null>(null)
  const setParam = useCallback(
    (name: 'row' | 'show', value: string | null) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (value === null) next.delete(name)
          else next.set(name, value)
          return next
        },
        { replace: true }
      ),
    [setParams]
  )
  const onHighlight = useCallback((key: string | null) => setParam('row', key), [setParam])
  const onDone = useCallback((words: string) => setResult({ words, year: view.year }), [view.year])
  const access = useMemo(
    (): SourceAccess => ({
      rules: hasPermission(Permission.FINANCIAL_AID_RULES),
      grantors: hasPermission(Permission.FINANCIAL_AID_GRANTORS),
    }),
    [hasPermission]
  )
  const fundingRows = funding.data?.sources ?? NO_FUNDING
  const bySource = useMemo(
    () => new Map(fundingRows.map((f) => [f.source_id, f] as const)),
    [fundingRows]
  )

  const columns = useMemo(
    (): ReadonlyArray<AidColumn<ApiAidSourceRow>> => [
      {
        key: 'description',
        header: 'Description in CampMinder',
        width: 230,
        pinned: true,
        value: (r) => r.description,
        searchable: true,
      },
      {
        key: 'source',
        header: 'Source',
        width: 150,
        value: (r) => (isUnclassified(r) ? 'unclassified' : r.source_name),
        render: (r) =>
          isUnclassified(r) ? <StatusPill tone="red">unclassified</StatusPill> : r.source_name,
        searchable: true,
      },
      { key: 'who', header: 'Who paid', width: 120, value: (r) => whoPaidWords(r) },
      {
        key: 'incentive',
        header: 'Incentive or need-based',
        width: 130,
        value: (r) => incentiveWords(r),
        render: (r) =>
          incentiveWords(r) === 'incentive' ? (
            <StatusPill tone="purple">incentive</StatusPill>
          ) : (
            incentiveWords(r)
          ),
      },
      { key: 'aid', header: 'Counts as aid', width: 90, value: (r) => yesNo(r.counts_as_aid) },
      {
        key: 'budget',
        header: 'Counts toward the budget',
        width: 110,
        value: (r) => yesNo(r.counts_toward_budget),
      },
      {
        key: 'group',
        header: 'Reporting group',
        width: 160,
        value: (r) =>
          r.needs_group === true ? 'needs a group' : (bySource.get(r.id)?.group_label ?? ''),
        render: (r) =>
          r.needs_group === true ? (
            <StatusPill tone="amber">needs a group</StatusPill>
          ) : (
            (bySource.get(r.id)?.group_label ?? '')
          ),
      },
      {
        key: 'lines',
        header: 'Lines this season',
        width: 90,
        align: 'right',
        value: (r) => r.lines ?? null,
      },
      {
        key: 'amount',
        header: '$ this season',
        width: 110,
        align: 'right',
        value: (r) => r.amount ?? null,
        render: (r) => <Money value={r.amount} />,
        csv: (r) => moneyCsv(r.amount),
      },
      {
        key: 'change',
        header: 'Last change',
        width: 260,
        value: (r) => lastChangeWords(r.last_change),
      },
      {
        key: 'grantor',
        header: 'Grantor',
        flex: true,
        value: (r) => (r.grantor_key === '' ? '' : grantorWords(r)),
        render: (r) =>
          r.grantor_key === '' ? (
            ''
          ) : (
            <Link
              className={CS_LINK}
              to={aidHref('/aid/grants/grantors', view, { grantor: r.grantor_key })}
              onClick={(event) => event.stopPropagation()}
            >
              {grantorWords(r)}
            </Link>
          ),
      },
    ],
    [bySource, view]
  )

  const chip = (value: SourcesShow, label: string) => (
    <button
      key={value}
      type="button"
      className={show === value ? GROUP_BUTTON_ON : GROUP_BUTTON_OFF}
      onClick={() => setParam('show', value === 'all' ? null : value)}
    >
      {label}
    </button>
  )
  const shown = result !== null && result.year === view.year ? result.words : null

  return (
    <QueryGuard
      isLoading={sources.isLoading}
      // Owner ruling Group 5: a failed background refetch keeps what loaded.
      error={sources.data ? null : sources.error}
      data={sources.data}
      label="Sources"
    >
      {(data) => {
        const all = data.sources
        const rows = shownSources(all, show)
        return (
          <div className="space-y-3">
            {shown !== null && <p className={DONE_NOTE}>✓ {shown}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <div className={GROUP}>
                {chip('all', `All ${String(all.length)}`)}
                {chip('needs-group', needsGroupWords(all))}
                {chip('unclassified', `Unclassified ${String(all.filter(isUnclassified).length)}`)}
              </div>
              <p className={CS_PMETA}>
                {access.rules
                  ? 'Every change is logged with who and why.'
                  : access.grantors
                    ? "You map outside descriptions to grantors; classifying is finance's. Every change is logged with who and why."
                    : 'Read only for you: classifying a description changes what counts toward the budget (finance).'}
              </p>
            </div>
            <p className={CS_AMBER_NOTE}>
              <span className="font-semibold">One registry, two views.</span> Development edits the
              reporting group and the incentive flag of these same rows in Reports › Development ›
              Funding sources; their changes show here under &quot;Last change&quot;. Everything
              else on this row is finance&apos;s. The registrar sets neither.
            </p>
            {funding.error && !funding.data && (
              <p className={CS_AMBER_NOTE}>
                The reporting groups couldn&apos;t load; the rest of the registry is as it was.
              </p>
            )}
            <AidTable
              rows={rows}
              columns={columns}
              rowKey={sourceKey}
              urlPrefix="src_"
              csvFilename={sourcesCsvName(view.year, show)}
              searchPlaceholder="Search descriptions"
              highlighted={highlighted}
              onHighlight={onHighlight}
              renderDetail={(row) => (
                <SourceOpenRow
                  key={row.id}
                  row={row}
                  rows={all}
                  funding={bySource.get(row.id)}
                  groups={funding.data?.groups ?? []}
                  groupWarning={funding.data?.group_change_warning ?? ''}
                  names={names}
                  year={view.year}
                  view={view}
                  access={access}
                  onDone={onDone}
                />
              )}
              arrowKeys
              emptyText={
                show === 'unclassified'
                  ? 'Every description is classified.'
                  : show === 'needs-group'
                    ? 'Every outside source has a group.'
                    : 'No descriptions yet.'
              }
            />
            <AidDefinitionNotes surface="money-sources" />
          </div>
        )
      }}
    </QueryGuard>
  )
}
