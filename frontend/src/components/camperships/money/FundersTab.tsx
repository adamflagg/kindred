import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'

import { Permission } from '../../../constants/permissions'
import { useAidFundingSources } from '../../../hooks/camperships/useAidFundingSources'
import { useAidGrantors } from '../../../hooks/camperships/useAidGrantors'
import { useAidProgramNames } from '../../../hooks/camperships/useAidProgramNames'
import { useAidSources } from '../../../hooks/camperships/useAidSources'
import { usePermissions } from '../../../hooks/usePermissions'
import type { ApiAidFundingSource, ApiAidGrantorDescription } from '../../../types/api-types'
import { GROUP, GROUP_BUTTON_OFF, GROUP_BUTTON_ON } from '../../admin/audit/auditStyles'
import { QueryGuard } from '../../QueryGuard'
import { GrantorForm } from '../grants/GrantorForm'
import { isRetired } from '../grants/grantorModel'
import { GrantorPanel } from '../grants/GrantorPanel'
import { aidHref, type AidView } from '../kit/asOf'
import { AidTable, type AidColumn, type AidCsvExtra } from '../kit/AidTable'
import { CS_AMBER_NOTE, CS_BTN, CS_PMETA } from '../kit/csType'
import { moneyCsv } from '../kit/money'
import { Money } from '../kit/MoneyText'
import { StatusPill } from '../kit/Pills'
import { AidDefinitionNotes } from '../shell/AidDefinitionNotes'
import {
  buildFunders,
  campWords,
  chipWords,
  funderHeaderWords,
  funderIdOfParam,
  funderParamOfId,
  funderSearchExtra,
  fundersCsvName,
  noFunderWords,
  parseFundersShow,
  sourceFamilyWords,
  yesNo,
  yesNoWords,
  type FunderRow,
  type FundersShow,
} from './fundersModel'
import { SourceOpenRow, type SourceAccess } from './SourceOpenRow'
import { incentiveWords, isUnclassified, needsGroupWords } from './sourcesModel'
import { DONE_NOTE } from './toPlaceStyles'

const NO_FUNDING: readonly ApiAidFundingSource[] = []
const rowKey = (row: FunderRow) => row.id
const rowTone = (row: FunderRow) =>
  row.kind === 'funder' ? (row.tone === 'none' ? ('warn' as const) : ('group' as const)) : undefined
const CSV_EXTRA: ReadonlyArray<AidCsvExtra<FunderRow>> = [
  {
    header: 'Funder',
    value: (row) => (row.kind === 'funder' ? row.name : row.funderName),
  },
]
const NOTHING_UNDER = 'No CampMinder description sits under it yet.'
/** A header's words run across the empty cells beside it: columns 2 to 6 less the cell padding. */
const HEADER_WORDS = 'inline-block max-w-[590px] truncate align-bottom font-normal'

const headerLine = (
  row: Extract<FunderRow, { kind: 'funder' }>,
  canClassify: boolean,
  canPickFunder: boolean
) => {
  if (row.grantor !== null) {
    const { terms, detail } = funderHeaderWords(row.grantor)
    return { terms: row.retired ? `Retired · ${terms}` : terms, detail }
  }
  return {
    terms:
      row.tone === 'camp'
        ? campWords(row.descriptions.length)
        : noFunderWords(row.descriptions.length, canClassify, canPickFunder),
    detail: '',
  }
}

/**
 * Money › Funders (owner 10-08; mock q2; D58, D86, D88, D100, D105, D143, D159, D160, ruling H): the
 * descriptions registry (Sources) and the grantor directory (Grantors) as one table grouped by who
 * pays. Camp first, then each funder with its terms and season totals in a header row and its
 * CampMinder descriptions under it, then "No funder yet". Chips `?show=`; a description opens from
 * `?row=<source id>`, a funder from `?funder=<key>` (`?grantor=` is the same). What each person may
 * edit follows their permissions: Classify… / Edit… is `rules`; Set a Group… is `rules` or
 * `funding_sources` (development's own route); the funder on a description and the funder's terms
 * are `grantors`. Live only.
 */
export function FundersTab({ view }: { view: AidView }) {
  const sources = useAidSources()
  const funding = useAidFundingSources()
  const grantors = useAidGrantors({ includeRetired: true, year: view.year })
  const names = useAidProgramNames()
  const { hasPermission } = usePermissions()
  const [params, setParams] = useSearchParams()
  const show = parseFundersShow(params.get('show'))
  const rowParam = params.get('row')
  const funderParam = params.get('funder') ?? params.get('grantor')
  const [result, setResult] = useState<{ words: string; year: number } | null>(null)
  const [creating, setCreating] = useState(false)
  const access = useMemo(
    (): SourceAccess => ({
      rules: hasPermission(Permission.FINANCIAL_AID_RULES),
      group:
        hasPermission(Permission.FINANCIAL_AID_RULES) ||
        hasPermission(Permission.FINANCIAL_AID_FUNDING_SOURCES),
      grantors: hasPermission(Permission.FINANCIAL_AID_GRANTORS),
    }),
    [hasPermission]
  )
  const canSee = hasPermission(Permission.FINANCIAL_AID_VIEW)

  const setParam = useCallback(
    (name: 'show' | 'retired', value: string | null) =>
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
  /** A description is `?row=`, a funder row `?funder=`; opening one closes the other. */
  const onHighlight = useCallback(
    (key: string | null) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          for (const name of ['row', 'funder', 'grantor']) next.delete(name)
          if (key !== null) {
            if (key.startsWith('funder:') || key.startsWith('group:')) {
              next.set('funder', funderParamOfId(key))
            } else next.set('row', key)
          }
          return next
        },
        { replace: true }
      ),
    [setParams]
  )
  const onDone = useCallback((words: string) => setResult({ words, year: view.year }), [view.year])
  const descriptionHref = useCallback(
    (d: ApiAidGrantorDescription) => aidHref('/aid/money/funders', view, { row: d.source_id }),
    [view]
  )

  const fundingRows = funding.data?.sources ?? NO_FUNDING
  const bySource = useMemo(
    () => new Map(fundingRows.map((f) => [f.source_id, f] as const)),
    [fundingRows]
  )
  const grantorList = grantors.data?.grantors
  const sourceList = sources.data?.sources
  // A link that names a retired funder shows it, whether or not retired ones are asked for.
  const opensRetired =
    funderParam !== null && (grantorList ?? []).some((g) => g.key === funderParam && isRetired(g))
  const showRetired = params.get('retired') === 'all' || opensRetired
  const built = useMemo(
    () =>
      sourceList === undefined || grantorList === undefined
        ? null
        : buildFunders({ sources: sourceList, grantors: grantorList, show, showRetired }),
    [sourceList, grantorList, show, showRetired]
  )
  const headers = useMemo(() => {
    const out = new Map<string, Extract<FunderRow, { kind: 'funder' }>>()
    for (const row of built?.rows ?? []) if (row.kind === 'funder') out.set(row.id, row)
    return out
  }, [built])

  const columns = useMemo(
    (): ReadonlyArray<AidColumn<FunderRow>> => [
      {
        key: 'name',
        header: 'Funder, then its descriptions in CampMinder',
        width: 290,
        pinned: true,
        value: (r) =>
          r.kind === 'funder' ? r.name : r.kind === 'empty' ? '' : r.source.description,
        render: (r) => {
          if (r.kind === 'funder') {
            return <span className={r.retired ? 'line-through' : undefined}>{r.name}</span>
          }
          if (r.kind === 'empty') {
            return <span className="text-muted-foreground pl-4 text-xs">{NOTHING_UNDER}</span>
          }
          return <span className="pl-4">{r.source.description}</span>
        },
        searchable: true,
      },
      {
        key: 'family',
        header: 'Source family',
        width: 150,
        value: (r) => {
          if (r.kind === 'funder') {
            const line = headerLine(r, access.rules, access.grantors)
            return line.detail === '' ? line.terms : `${line.terms} · ${line.detail}`
          }
          return r.kind === 'empty' ? '' : sourceFamilyWords(r.source)
        },
        render: (r) => {
          if (r.kind === 'funder') {
            const line = headerLine(r, access.rules, access.grantors)
            return (
              <span
                className={HEADER_WORDS}
                title={line.detail === '' ? line.terms : `${line.terms} · ${line.detail}`}
              >
                <span>{line.terms}</span>
                {line.detail !== '' && (
                  <>
                    {' · '}
                    <span className="text-muted-foreground">{line.detail}</span>
                  </>
                )}
              </span>
            )
          }
          if (r.kind === 'empty') return ''
          return isUnclassified(r.source) ? (
            <StatusPill tone="red">Not yet classified</StatusPill>
          ) : (
            sourceFamilyWords(r.source)
          )
        },
      },
      {
        key: 'incentive',
        header: 'Incentive or need-based',
        width: 130,
        value: (r) => (r.kind === 'description' ? incentiveWords(r.source) : ''),
        render: (r) => {
          if (r.kind !== 'description') return ''
          const words = incentiveWords(r.source)
          return words === 'incentive' ? <StatusPill tone="purple">Incentive</StatusPill> : words
        },
      },
      {
        key: 'aid',
        header: 'Counts as aid',
        width: 80,
        value: (r) => (r.kind === 'description' ? yesNoWords(r.source.counts_as_aid) : ''),
        render: (r) => (r.kind === 'description' ? yesNo(r.source.counts_as_aid) : ''),
      },
      {
        key: 'budget',
        header: 'Counts toward the budget',
        width: 100,
        value: (r) => (r.kind === 'description' ? yesNoWords(r.source.counts_toward_budget) : ''),
        render: (r) => (r.kind === 'description' ? yesNo(r.source.counts_toward_budget) : ''),
      },
      {
        key: 'group',
        header: 'Reporting group',
        width: 150,
        value: (r) => {
          if (r.kind !== 'description') return ''
          return r.source.needs_group === true
            ? 'Needs a group'
            : (bySource.get(r.source.id)?.group_label ?? '')
        },
        render: (r) => {
          if (r.kind !== 'description') return ''
          return r.source.needs_group === true ? (
            <StatusPill tone="amber">Needs a group</StatusPill>
          ) : (
            (bySource.get(r.source.id)?.group_label ?? '')
          )
        },
      },
      {
        key: 'lines',
        header: 'Lines this season',
        width: 90,
        align: 'right',
        value: (r) =>
          r.kind === 'funder' ? r.lines : r.kind === 'empty' ? null : (r.source.lines ?? null),
        render: (r) => {
          if (r.kind === 'empty') return ''
          const lines = r.kind === 'funder' ? r.lines : (r.source.lines ?? null)
          return lines === null ? '—' : String(lines)
        },
      },
      {
        key: 'amount',
        header: '$ this season',
        width: 110,
        align: 'right',
        value: (r) =>
          r.kind === 'funder' ? r.amount : r.kind === 'empty' ? null : (r.source.amount ?? null),
        render: (r) =>
          r.kind === 'empty' ? (
            ''
          ) : (
            <Money value={r.kind === 'funder' ? r.amount : r.source.amount} />
          ),
        csv: (r) =>
          moneyCsv(r.kind === 'funder' ? r.amount : r.kind === 'empty' ? null : r.source.amount),
      },
    ],
    [bySource, access.rules, access.grantors]
  )

  const chip = (value: FundersShow, label: string) => (
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
  const canEditFunders = access.grantors
  const highlighted = rowParam ?? (funderParam === null ? null : funderIdOfParam(funderParam))

  const renderDetail = (row: FunderRow) => {
    if (row.kind === 'description') {
      return (
        <SourceOpenRow
          key={row.id}
          row={row.source}
          rows={sourceList ?? []}
          funding={bySource.get(row.source.id)}
          groups={funding.data?.groups ?? []}
          groupWarning={funding.data?.group_change_warning ?? ''}
          names={names}
          year={view.year}
          view={view}
          access={access}
          onDone={onDone}
        />
      )
    }
    const header = row.kind === 'funder' ? row : headers.get(row.funderId)
    if (header?.grantor != null) {
      return (
        <GrantorPanel
          key={header.id}
          grantor={header.grantor}
          canEdit={canEditFunders}
          descriptionHref={descriptionHref}
          onDone={onDone}
        />
      )
    }
    return (
      <p className={CS_PMETA}>
        {header?.tone === 'camp'
          ? "The camp's own aid counts toward the budget. It has no terms or contacts."
          : 'No funder claims these descriptions yet. Open one to pick its funder; an unclassified one is classified first.'}
      </p>
    )
  }

  return (
    <QueryGuard
      isLoading={sources.isLoading || grantors.isLoading}
      // Owner ruling Group 5: a failed background refetch keeps what loaded.
      error={sources.data && grantors.data ? null : (sources.error ?? grantors.error)}
      data={built ?? undefined}
      label="funders"
    >
      {({ rows, counts }) => (
        <div className="space-y-3">
          {shown !== null && <p className={DONE_NOTE}>✓ {shown}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <div className={GROUP}>
              {chip('all', chipWords.all(counts))}
              {chip('needs-group', needsGroupWords(sourceList ?? []))}
              {chip('no-funder', chipWords.noFunder(counts))}
            </div>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={showRetired}
                onChange={(event) => setParam('retired', event.target.checked ? 'all' : null)}
              />
              Show retired funders
            </label>
            {canEditFunders && !creating && (
              <button
                type="button"
                className={`${CS_BTN} ml-auto`}
                onClick={() => setCreating(true)}
              >
                New Funder…
              </button>
            )}
          </div>
          <p className={CS_PMETA}>
            {access.rules
              ? 'Click a funder for its terms and contacts, or a description to classify it or set its group. Every change is logged with who and why.'
              : access.group || access.grantors
                ? "Click a funder for its terms and contacts, or a description to set its reporting group, incentive flag and funder. Counts as aid and toward the budget stay finance's."
                : 'Read only for you: finance classifies descriptions and sets their funders and groups.'}
          </p>
          {creating && (
            <GrantorForm
              onCancel={() => setCreating(false)}
              onDone={(words) => {
                setCreating(false)
                onDone(words)
              }}
            />
          )}
          {funding.error && !funding.data && (
            <p className={CS_AMBER_NOTE}>
              The reporting groups couldn&apos;t load; the rest of the registry is as it was.
            </p>
          )}
          <AidTable
            rows={rows}
            columns={columns}
            rowKey={rowKey}
            rowTone={rowTone}
            sortable={false}
            searchExtra={funderSearchExtra}
            urlPrefix="funders_"
            csvFilename={fundersCsvName(view.year, show)}
            csvExtra={CSV_EXTRA}
            searchPlaceholder="Funder or description"
            highlighted={highlighted}
            onHighlight={onHighlight}
            renderDetail={renderDetail}
            arrowKeys
            emptyText={(searching) =>
              show === 'no-funder'
                ? 'Every description has a funder.'
                : show === 'needs-group'
                  ? 'Every outside source has a group.'
                  : searching
                    ? 'No funder or description matches.'
                    : 'No funders yet.'
            }
          />
          {!canSee && (
            <p className={CS_PMETA}>
              Totals only: no family is named, listed or linked on this tab.
            </p>
          )}
          <AidDefinitionNotes surface="money-sources" />
        </div>
      )}
    </QueryGuard>
  )
}
