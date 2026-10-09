import { Info } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'

import { Permission } from '../../../constants/permissions'
import { useAidDefinitions } from '../../../hooks/camperships/useAidDefinitions'
import { useAidFundingSources } from '../../../hooks/camperships/useAidFundingSources'
import { useAidGrantors } from '../../../hooks/camperships/useAidGrantors'
import { useAidProgramNames } from '../../../hooks/camperships/useAidProgramNames'
import { useAidSources } from '../../../hooks/camperships/useAidSources'
import { usePermissions } from '../../../hooks/usePermissions'
import type {
  ApiAidFundingSource,
  ApiAidGrantorDescription,
  ApiAidSourceRow,
} from '../../../types/api-types'
import { QueryGuard } from '../../QueryGuard'
import { GrantorForm } from '../grants/GrantorForm'
import { isRetired } from '../grants/grantorModel'
import { GrantorPanel } from '../grants/GrantorPanel'
import { aidHref, type AidView } from '../kit/asOf'
import { AidTable, type AidColumn, type AidCsvExtra } from '../kit/AidTable'
import { CS_BTN, CS_FLABEL, CS_PMETA, CS_TOOLBAR_STATUS } from '../kit/csType'
import { Cut } from '../kit/Cut'
import { moneyCsv } from '../kit/money'
import { Money } from '../kit/MoneyText'
import { StatusPill } from '../kit/Pills'
import { multiPickerWords } from '../kit/pickerWords'
import { AidSegmented } from '../kit/Segmented'
import { AidDefinitionNotes } from '../shell/AidDefinitionNotes'
import {
  buildFunders,
  campWords,
  funderHeaderWords,
  funderIdOfParam,
  funderParamOfId,
  funderSearchExtra,
  fundersCsvName,
  noFunderWords,
  parseFundersShow,
  sourceFamilyWords,
  switcherOptions,
  yesNo,
  yesNoWords,
  type FunderRow,
} from './fundersModel'
import { SourceOpenRow, type SourceAccess } from './SourceOpenRow'
import {
  incentiveWords,
  isUnclassified,
  poolsOfFamilies,
  poolsOfGroups,
  type Pool,
} from './sourcesModel'

const NO_FUNDING: readonly ApiAidFundingSource[] = []
const rowKey = (row: FunderRow) => row.id
const rowTone = (row: FunderRow) =>
  row.kind === 'funder' ? (row.tone === 'none' ? ('warn' as const) : ('group' as const)) : undefined
const firstCellSpan = (row: FunderRow) =>
  row.kind === 'funder' ? HEADER_SPAN : row.kind === 'empty' ? COLUMN_COUNT : undefined
const CSV_EXTRA: ReadonlyArray<AidCsvExtra<FunderRow>> = [
  {
    header: 'Funder',
    value: (row) => (row.kind === 'funder' ? row.name : row.funderName),
  },
]
const NOTHING_UNDER = 'No CampMinder description sits under it yet.'
/**
 * A header's first cell owns columns 1 to 6, up to the two totals (money-funders.html), so a long name and
 * its terms cut there, with every word in the cell's title, instead of overprinting the next cell.
 */
const HEADER_SPAN = 6
/** The "nothing under it yet" line owns the whole row, as the mock draws it. */
const COLUMN_COUNT = 8
/** The opened-row caret before a name (mock `.cf-caret`): ▸ shut, ▾ open. */
const CARET = 'text-muted-foreground inline-block w-3 flex-none text-[10px]'
const NO_POOLS: readonly Pool[] = []
const NEEDS_GROUP_WHY = 'An outside source with no programs set: open it and Set a Group…'

const headerWords = (
  row: Extract<FunderRow, { kind: 'funder' }>,
  canClassify: boolean,
  canPickFunder: boolean
) => {
  const line = headerLine(row, canClassify, canPickFunder)
  return line.detail === '' ? line.terms : `${line.terms} · ${line.detail}`
}

const headerLine = (
  row: Extract<FunderRow, { kind: 'funder' }>,
  canClassify: boolean,
  canPickFunder: boolean
) => {
  if (row.grantor !== null) {
    const { terms, detail } = funderHeaderWords(row.grantor)
    return { terms: row.retired ? `Retired · ${terms}` : terms, detail }
  }
  return row.tone === 'camp'
    ? campWords(row.descriptions.length)
    : noFunderWords(row.descriptions.length, canClassify, canPickFunder)
}

/**
 * Money › Funders (owner 10-08; mock q2; D58, D86, D88, D100, D105, D143, D159, D160, ruling H): the
 * descriptions registry (Sources) and the grantor directory (Grantors) as one table grouped by who
 * pays. Camp first, then each funder with its terms and season totals in a header row and its
 * CampMinder descriptions under it, then "No funder yet". Chips `?show=`; a description opens from
 * `?row=<source id>`, a funder from `?funder=<key>` (`?grantor=` is the same). What each person may
 * edit follows their permissions: Classify… / Edit… is `rules`; Set a Group… is `rules` or
 * `grantors`; the funder on a description and the funder's terms are `grantors`. Live only.
 */
export function FundersTab({ view }: { view: AidView }) {
  const sources = useAidSources()
  const funding = useAidFundingSources()
  const grantors = useAidGrantors({ includeRetired: true, year: view.year })
  const names = useAidProgramNames()
  const defs = useAidDefinitions('money-sources')
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
        hasPermission(Permission.FINANCIAL_AID_GRANTORS),
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
  const poolGroups = funding.data?.groups
  const pools = useMemo(
    () => (poolGroups === undefined ? NO_POOLS : poolsOfGroups(poolGroups)),
    [poolGroups]
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

  // The footnote marks (§12): the registry's notes are numbered Funder, Incentive, Reporting group, Lines; none until it loads.
  const markOf = (key: string) => {
    const n = defs.numberOf(key)
    const title = defs.entries.find((e) => e.key === key)?.text
    return n === null || title === undefined ? undefined : { n, title }
  }
  const funderMark = markOf('funder')
  const incentiveMark = markOf('incentive')
  const groupMark = markOf('reporting_group')
  const linesMark = markOf('source_lines')

  /** A description's reporting group in the pools' words, as the multi picker reads them; null: not known yet. */
  const groupWords = useCallback(
    (source: ApiAidSourceRow): { words: string; title: string } | null => {
      if (pools.length === 0) return null
      const keys = poolsOfFamilies(source.implied_program_families, pools)
      const reached = pools.filter((p) => keys.includes(p.key))
      if (reached.length === 0) return null
      const options = pools.map((p) => ({ value: p.key, label: p.label }))
      const words = multiPickerWords(keys, options, 'groups', '')
      const title =
        reached.length > 1
          ? `${String(reached.length)} groups: ${reached.map((p) => p.label).join(' · ')}`
          : (reached[0]?.label ?? words)
      return { words, title }
    },
    [pools]
  )

  const columns = useMemo(
    (): ReadonlyArray<AidColumn<FunderRow>> => [
      {
        key: 'name',
        header: 'Funder, then its descriptions in CampMinder',
        width: 272,
        pinned: true,
        mark: funderMark,
        value: (r) =>
          r.kind === 'funder' ? r.name : r.kind === 'empty' ? '' : r.source.description,
        // §13: every cut cell carries its full words. A header's are its name, terms and details.
        title: (r) => {
          if (r.kind === 'funder') {
            return [r.name, headerWords(r, access.rules, access.grantors)].join(' · ')
          }
          return r.kind === 'empty' ? NOTHING_UNDER : r.source.description
        },
        render: (r, ctx) => {
          if (r.kind === 'funder') {
            const line = headerLine(r, access.rules, access.grantors)
            return (
              // One line: caret, the bold name, its terms, then the muted details; the cell cuts at the totals.
              <span className="block truncate">
                <span className={`${CARET} align-baseline`}>{ctx.highlighted ? '▾' : '▸'}</span>
                <span className={r.retired ? 'font-bold line-through' : 'font-bold'}>{r.name}</span>
                <span className="ml-2.5 font-normal">
                  {r.retired
                    ? `Retired · ${line.terms}`.replace(/^Retired · Retired · /, 'Retired · ')
                    : line.terms}
                </span>
                {line.detail !== '' && (
                  <>
                    {' · '}
                    <span className="text-muted-foreground font-normal">{line.detail}</span>
                  </>
                )}
              </span>
            )
          }
          if (r.kind === 'empty') {
            return <span className={`${CS_PMETA} block truncate pl-5`}>{NOTHING_UNDER}</span>
          }
          return (
            <span className="flex min-w-0 items-baseline gap-1.5 pl-3">
              <span className={CARET}>{ctx.highlighted ? '▾' : '▸'}</span>
              <Cut text={r.source.description} className="min-w-0" />
            </span>
          )
        },
        searchable: true,
      },
      {
        key: 'family',
        header: 'Source family',
        width: 150,
        // A header's words are the name cell's now (it spans this column); the CSV keeps them here.
        value: (r) => {
          if (r.kind === 'funder') return headerWords(r, access.rules, access.grantors)
          return r.kind === 'empty' ? '' : sourceFamilyWords(r.source)
        },
        title: (r) => {
          if (r.kind !== 'description') return undefined
          return isUnclassified(r.source)
            ? 'New from the ledger sync. It counts as an outside grant until finance classifies it.'
            : sourceFamilyWords(r.source)
        },
        render: (r) => {
          if (r.kind === 'funder' || r.kind === 'empty') return ''
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
        width: 168,
        mark: incentiveMark,
        value: (r) => (r.kind === 'description' ? incentiveWords(r.source) : ''),
        title: (r) => (r.kind === 'description' ? incentiveWords(r.source) : undefined),
        render: (r) => {
          if (r.kind !== 'description') return ''
          const words = incentiveWords(r.source)
          return words === 'incentive' ? <StatusPill tone="purple">Incentive</StatusPill> : words
        },
      },
      {
        key: 'aid',
        header: 'Counts as aid',
        width: 97,
        value: (r) => (r.kind === 'description' ? yesNoWords(r.source.counts_as_aid) : ''),
        render: (r) => (r.kind === 'description' ? yesNo(r.source.counts_as_aid) : ''),
      },
      {
        key: 'budget',
        header: 'Counts toward the budget',
        width: 160,
        value: (r) => (r.kind === 'description' ? yesNoWords(r.source.counts_toward_budget) : ''),
        render: (r) => (r.kind === 'description' ? yesNo(r.source.counts_toward_budget) : ''),
      },
      {
        key: 'group',
        header: 'Reporting group',
        width: 147,
        mark: groupMark,
        value: (r) => {
          if (r.kind !== 'description') return ''
          if (r.source.needs_group === true) return 'Needs a group'
          return groupWords(r.source)?.words ?? bySource.get(r.source.id)?.group_label ?? ''
        },
        title: (r) => {
          if (r.kind !== 'description') return undefined
          if (r.source.needs_group === true) return NEEDS_GROUP_WHY
          const words = groupWords(r.source)
          if (words === null) return bySource.get(r.source.id)?.group_label ?? undefined
          return r.source.funder_type === 'camp'
            ? `The camp's own aid here counts in the ${words.title} budget`
            : words.title
        },
        render: (r) => {
          if (r.kind !== 'description') return ''
          if (r.source.needs_group === true)
            return <StatusPill tone="amber">Needs a group</StatusPill>
          const words = groupWords(r.source)
          const label = words?.words ?? bySource.get(r.source.id)?.group_label ?? ''
          // The camp's own pool shows muted, as the approved structure drew it (live left it blank).
          return r.source.funder_type === 'camp' && label !== '' ? (
            <span className="text-muted-foreground">{label}</span>
          ) : (
            label
          )
        },
      },
      {
        key: 'lines',
        header: 'Lines this season',
        width: 115,
        align: 'right',
        mark: linesMark,
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
        width: 105,
        align: 'right',
        mark: linesMark,
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
    [
      bySource,
      access.rules,
      access.grantors,
      groupWords,
      funderMark,
      incentiveMark,
      groupMark,
      linesMark,
    ]
  )

  const shown = result !== null && result.year === view.year ? result.words : null
  // A save's result, or the failed groups read, takes the status slot: never a line above the table.
  const status =
    shown !== null ? (
      <span className={CS_TOOLBAR_STATUS} title={shown}>
        ✓ {shown}
      </span>
    ) : funding.error && !funding.data ? (
      <span
        className={CS_TOOLBAR_STATUS.replace(
          'text-muted-foreground',
          'text-amber-700 dark:text-amber-400'
        )}
        title="The reporting groups couldn't load; the rest of the list is as it was."
      >
        ⚠ The reporting groups couldn&apos;t load; the rest of the list is as it was.
      </span>
    ) : undefined
  // The old sentence row, in the (i)'s title (answers §1a), by what this person may do.
  const how = access.rules
    ? 'Click a funder for its terms and contacts, or a description to classify it or set its group. Every change is logged with who and why.'
    : access.group || access.grantors
      ? "Click a funder for its terms and contacts, or a description to set its reporting group, incentive flag and funder. Counts as aid and toward the budget stay finance's."
      : 'Read only for you: finance classifies descriptions and sets their funders and groups.'
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
          {/* §5, owner ("shorten the filter choices … fit search and download csv onto the same line"):
              one toolbar row. The switcher with its counts, Show retired and an (i) holding the old
              per-role sentence, then the status, search, New Funder… and Download CSV last. */}
          <AidTable
            rows={rows}
            columns={columns}
            rowKey={rowKey}
            rowTone={rowTone}
            firstCellSpan={firstCellSpan}
            nowrapHeaders
            sortable={false}
            searchExtra={funderSearchExtra}
            urlPrefix="funders_"
            csvFilename={fundersCsvName(view.year, show)}
            csvExtra={CSV_EXTRA}
            searchPlaceholder="Funder or description"
            toolbarLead={
              <>
                <AidSegmented
                  label="Show"
                  value={show}
                  options={switcherOptions(counts, sourceList ?? [])}
                  onChange={(value) => setParam('show', value === 'all' ? null : value)}
                />
                <label
                  className={`${CS_FLABEL} inline-flex flex-none cursor-pointer items-center gap-1.5`}
                  title="Show retired funders, struck through"
                >
                  <input
                    type="checkbox"
                    checked={showRetired}
                    onChange={(event) => setParam('retired', event.target.checked ? 'all' : null)}
                  />
                  Show retired
                </label>
                <span
                  className="text-muted-foreground inline-flex flex-none cursor-help"
                  title={how}
                >
                  <Info className="h-[13px] w-[13px]" aria-hidden />
                </span>
              </>
            }
            toolbarStatus={status}
            toolbarActions={
              canEditFunders && !creating ? (
                <button type="button" className={CS_BTN} onClick={() => setCreating(true)}>
                  New Funder…
                </button>
              ) : undefined
            }
            belowToolbar={
              creating ? (
                <GrantorForm
                  onCancel={() => setCreating(false)}
                  onDone={(words) => {
                    setCreating(false)
                    onDone(words)
                  }}
                />
              ) : undefined
            }
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
          <AidDefinitionNotes
            surface="money-sources"
            {...(canSee
              ? {}
              : { appendToLast: 'For you, totals only: no family is named on this tab.' })}
          />
        </div>
      )}
    </QueryGuard>
  )
}
