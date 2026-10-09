import { Home } from 'lucide-react'
import { Fragment, useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'

import type { ApiAidToPlace, ApiAidToPlaceLine } from '../../../types/api-types'
import { HouseholdLabelText } from '../household/HouseholdLabel'
import { labelWords } from '../household/householdModel'
import { AidTable, type AidColumn } from '../kit/AidTable'
import { aidHref, type AidView } from '../kit/asOf'
import { CS_LINK_CELL } from '../kit/csType'
import { formatMoney, moneyCsv } from '../kit/money'
import { Money } from '../kit/MoneyText'
import {
  candidateDetail,
  candidateLabel,
  candidateSession,
  confirmCell,
  confirmSummary,
  evidenceLines,
  GROUP_DOES,
  lineCell,
  lineFamily,
  lineWords,
  stillNotPlacedWords,
  suggestionShort,
  suggestionWords,
  type ToPlaceReason,
} from './toPlaceModel'
import {
  candidatesCell,
  groupWords,
  lineKey,
  lineSearch,
  reasonGrouping,
  toPlaceCsvExtra,
  TO_PLACE_COLUMN_WIDTHS as WIDTH,
} from './toPlaceColumns'
import { GroupDoes, GroupHeading } from './ToPlaceParts'
import type { ToPlaceMarks } from './useToPlaceNotes'

const SYM_INK = {
  ok: 'text-forest-700 dark:text-forest-300',
  hand: 'text-muted-foreground',
  warn: 'text-amber-700 dark:text-amber-300',
} as const
const SYM_CHAR = { ok: '✓', hand: '○', warn: '⚠' } as const

/** The opened-row caret before the family (mock `.cf-caret`): ▸ shut, ▾ open. */
const CARET = 'text-muted-foreground w-3 flex-none text-[10px]'

function columnsFor(
  view: AidView,
  marks: ToPlaceMarks
): ReadonlyArray<AidColumn<ApiAidToPlaceLine>> {
  return [
    {
      key: 'family',
      header: 'Family',
      width: WIDTH.family,
      pinned: true,
      value: (line) => labelWords(lineFamily(line)),
      title: (line) => `${labelWords(lineFamily(line))} · open the household page`,
      render: (line, ctx) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={CARET}>{ctx.highlighted ? '▾' : '▸'}</span>
          <Link
            to={aidHref(`/aid/households/${String(line.household_cm_id)}`, view)}
            className={`${CS_LINK_CELL} min-w-0 truncate`}
            onClick={(event) => event.stopPropagation()}
          >
            <HouseholdLabelText label={lineFamily(line)} />
          </Link>
        </span>
      ),
      searchable: true,
    },
    {
      key: 'line',
      header: 'The line in CampMinder',
      width: WIDTH.line,
      value: lineWords,
      title: (line) => {
        const still = stillNotPlacedWords(line)
        return `${lineWords(line)}${still === null ? '' : ` ${still}`}`
      },
      render: (line) => {
        const still = stillNotPlacedWords(line)
        return (
          <>
            {lineCell(line)}
            {still !== null && <span className="text-muted-foreground"> {still}</span>}
          </>
        )
      },
      csv: lineWords,
      searchable: true,
    },
    {
      key: 'candidates',
      header: 'Could belong to',
      width: WIDTH.candidates,
      mark: marks.candidates ?? undefined,
      value: candidatesCell,
      title: (line) =>
        line.candidates.length === 0
          ? 'No application this season'
          : line.candidates.map((c) => `${candidateLabel(c)}: ${candidateDetail(c)}`).join('\n'),
      render: (line) =>
        line.candidates.length === 0 ? (
          <span className="text-muted-foreground">No application this season</span>
        ) : (
          line.candidates.map((c, i) => {
            const money = formatMoney(c.not_yet_in_campminder)
            return (
              <Fragment key={c.request_id}>
                {i > 0 && ', '}
                {c.person_cm_id === 0 || c.camper === '' ? (
                  <span
                    className="inline-flex items-center gap-1"
                    title={`Household request: ${c.family || 'the'} household`}
                  >
                    <Home className="text-muted-foreground h-3 w-3 flex-none" />
                    <span>{`${candidateSession(c)} · ${money}`}</span>
                  </span>
                ) : (
                  <span>{`${c.camper} · ${candidateSession(c)} · ${money}`}</span>
                )}
              </Fragment>
            )
          })
        ),
    },
    {
      key: 'suggestion',
      header: 'Suggestion',
      flex: true,
      mark: marks.suggestion ?? undefined,
      value: suggestionWords,
      title: (line) => {
        const evidence = evidenceLines(line).join(' · ')
        return `${suggestionWords(line)}${evidence === '' ? '' : ` · ${evidence}`}`
      },
      render: (line) =>
        line.suggestion === null ? (
          <span className="text-muted-foreground">{suggestionShort(line)}</span>
        ) : (
          <span className="font-bold">{suggestionShort(line)}</span>
        ),
    },
    {
      key: 'confirm',
      header: 'What Confirm does',
      width: WIDTH.confirm,
      mark: marks.confirm ?? undefined,
      value: confirmSummary,
      title: (line) => confirmCell(line).title,
      render: (line) => {
        const cell = confirmCell(line)
        return cell.sym === null ? (
          <span className="text-muted-foreground">{cell.words}</span>
        ) : (
          <span>
            <span className={`mr-1 font-bold ${SYM_INK[cell.sym]}`}>{SYM_CHAR[cell.sym]}</span>
            {cell.words}
          </span>
        )
      },
    },
    {
      key: 'amount',
      header: 'Amount',
      width: WIDTH.amount,
      align: 'right',
      value: (line) => line.amount,
      render: (line) => <Money value={line.amount} />,
      csv: (line) => moneyCsv(line.amount),
    },
  ]
}

/**
 * To place's open lines (§8.1; final UX ★14): six short columns, grouped by the server's reasons,
 * each group its own heading, callout and table (the approved mock), searchable by the page's one box,
 * with a CSV of what is on screen. A click (or ↑/↓) highlights a line and opens it under it, the
 * Requests grid's opened row (owner ruling A); Esc closes it. No footer total: the open total is the
 * server's, in the toolbar's lead (P-5).
 */
export function ToPlaceTable({
  data,
  view,
  marks,
  csvFilename,
  csvAppend,
  renderRow,
  selected,
  onSelectedChange,
  onMatchingChange,
  query,
  onQueryChange,
  toolbarLead,
  toolbarAfterGrouping,
  toolbarStatus,
  toolbarActions,
}: {
  data: ApiAidToPlace
  view: AidView
  marks: ToPlaceMarks
  csvFilename: string
  /** The grant lines as CSV rows (toPlaceModel.grantCsvRows), so the one file covers the whole tab. */
  csvAppend?: ReadonlyArray<readonly string[]> | undefined
  renderRow: (line: ApiAidToPlaceLine) => ReactNode
  selected?: ReadonlySet<string> | undefined
  onSelectedChange?: ((next: ReadonlySet<string>) => void) | undefined
  onMatchingChange?: ((keys: ReadonlySet<string>) => void) | undefined
  /** The page-held search, so the grant lines answer the same box. */
  query: string
  onQueryChange: (query: string) => void
  toolbarLead: ReactNode
  toolbarAfterGrouping?: ReactNode
  toolbarStatus?: ReactNode
  toolbarActions?: ReactNode
}) {
  const rows = useMemo(() => data.groups.flatMap((g) => g.lines), [data.groups])
  const columns = useMemo(() => columnsFor(view, marks), [view, marks])
  const groupings = useMemo(() => reasonGrouping(data.groups), [data.groups])
  const csvExtra = useMemo(() => toPlaceCsvExtra(data.groups), [data.groups])
  return (
    <AidTable
      rows={rows}
      columns={columns}
      rowKey={lineKey}
      searchExtra={lineSearch}
      groupings={groupings}
      defaultGrouping="reason"
      csvFilename={csvFilename}
      renderDetail={(line) => renderRow(line)}
      arrowKeys
      nowrapHeaders
      searchPlaceholder="Names or CM IDs"
      searchWidth={170}
      query={query}
      onQueryChange={onQueryChange}
      toolbarLead={toolbarLead}
      toolbarAfterGrouping={toolbarAfterGrouping}
      toolbarStatus={toolbarStatus}
      toolbarActions={toolbarActions}
      groupSections={(g) =>
        g.grouped ? (
          <>
            <GroupHeading
              title={g.heading}
              meta={groupWords(g.rows)}
              folded={g.folded}
              onToggle={g.toggle}
            />
            {!g.folded && (
              <GroupDoes spec={GROUP_DOES[g.id as ToPlaceReason]} posted={marks.posted} />
            )}
          </>
        ) : (
          <GroupHeading title="Camp-aid lines" meta={groupWords(g.rows)} />
        )
      }
      selected={selected}
      onSelectedChange={onSelectedChange}
      onMatchingChange={onMatchingChange}
      csvExtra={csvExtra}
      csvAppend={csvAppend}
      emptyText="Nothing to place: every camp-aid line sits on a request."
    />
  )
}
