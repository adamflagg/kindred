import { createContext, useContext, useState, type ReactNode } from 'react'

import type {
  ApiAidFieldChange,
  ApiAidRulesDocument,
  ApiAidRulesSection,
  ApiAidValidationIssue,
} from '../../../../types/api-types'
import { DefRef } from '../../kit/DefinitionNotes'
import {
  CS_AMBER_NOTE,
  CS_CARD,
  CS_SMALL,
  CS_TABLE_CARD,
  CS_TD_CARD,
  CS_TH_CARD,
} from '../../kit/csType'
import { GRID_PARTS, GRID_TITLES } from './rulesLayout'
import { changeWords, keyWords, type RulesNames, type StatusWords } from './rulesModel'
import { SectionCardHead } from './SectionCard'
import {
  bandsIn,
  cellPath,
  gridCell,
  gridClasses,
  gridColumns,
  gridOrdered,
  notedCells,
  rangeWords,
  tierLineWords,
  warnedCells,
  type Band,
  type TableShape,
} from './tierGrid'

export type GridPart = (typeof GRID_PARTS)[number]

// The generated document types its Key-keyed dicts' values as `unknown` (AidRulesOutput); the grid reads them as the
// schema stores them (rules/schema.py TierTable, ProgramProfile).
type Tables = Readonly<Record<string, TableShape>>
type Programs = Readonly<Record<string, { readonly equity_class?: string | null }>>

const TH_NUM = CS_TH_CARD.replace('text-left', 'text-right')
const TH_MID = CS_TH_CARD.replace('text-left', 'text-center')
const TD_NUM = `${CS_TD_CARD} text-right tabular-nums`

/** The card's cell ⚠ click, for the grid an editor draws inside it: it opens the card's one list (coordinator B2). */
const GridWarnContext = createContext<((table: string) => void) | null>(null)
const NO_NOTES: ReadonlyMap<string, string> = new Map()

function GridCellView({
  cell,
  warned,
  onWarn,
  note,
  onNote,
  control,
}: {
  cell: { value: string | null; inherited: boolean }
  warned: boolean
  onWarn: () => void
  /** The cell's "the minimum decides" note (B3, #3049), verbatim; undefined when it has none. */
  note?: string | undefined
  onNote?: () => void
  /** In an editor: the box for this cell when it holds its own figure; an inherited or empty cell stays words. */
  control?: ReactNode
}) {
  return (
    <td
      data-inherited={cell.inherited ? '' : undefined}
      className={cell.inherited ? `${TD_NUM} text-muted-foreground` : TD_NUM}
    >
      {control ?? (cell.value === null ? '—' : `${cell.value}%`)}
      {warned && (
        <button
          type="button"
          aria-label="Show this table's warnings"
          className="ml-1 cursor-pointer text-amber-600 dark:text-amber-400"
          onClick={onWarn}
        >
          ⚠
        </button>
      )}
      {note !== undefined && (
        <button
          type="button"
          title={note}
          className={`${CS_SMALL} ml-1 cursor-pointer`}
          onClick={onNote}
        >
          min
        </button>
      )}
    </td>
  )
}

/** The editor's box for a grid cell: the part (Round 1 award table or Appeal caps) and the cell's path inside it. */
export type GridCellControl = (
  part: 'award_tables' | 'round2',
  path: readonly string[]
) => ReactNode

/**
 * The one grid of every tier-keyed figure (spec §6.2 E.2): Round 1 % per class, then the Round 1 + 2 cap per class.
 * Read-only in the card; in a table's editor `control` puts a box in each cell that holds its own (or an overridden)
 * figure, while an inherited or empty cell stays words.
 */
export function TierGridTable({
  bands,
  awardTables,
  appealTables,
  classes,
  warned,
  noted = NO_NOTES,
  onWarn,
  control,
}: {
  bands: readonly Band[]
  awardTables: Tables
  appealTables: Tables
  classes: readonly string[]
  warned: ReadonlySet<string>
  /** The Round 1 cells a "the minimum decides" note names, "table:tier" → its words (B3). */
  noted?: ReadonlyMap<string, string>
  /** A warned cell's click; inside the tier grid card's editor it defaults to the card's list. */
  onWarn?: (table: string) => void
  control?: GridCellControl | undefined
}) {
  const fromCard = useContext(GridWarnContext)
  const warn = onWarn ?? fromCard ?? (() => undefined)
  // The one place a clicked note's words show: a line under the grid (its hover title is the other way in).
  const [footnote, setFootnote] = useState<string | null>(null)
  const footnoteWords = footnote === null ? undefined : noted.get(footnote)
  const r1 = gridColumns(awardTables, classes, keyWords)
  const r2 = gridColumns(appealTables, classes, keyWords)
  const boxFor = (
    part: 'award_tables' | 'round2',
    tables: Tables,
    table: string,
    tier: number,
    key: 'r1_pct' | 'total_pct'
  ) => {
    const path = control === undefined ? null : cellPath(tables, table, tier, key)
    return path === null || control === undefined
      ? undefined
      : control(part, part === 'round2' ? ['tables', ...path] : path)
  }
  return (
    <>
      <table data-testid="tier-grid" className={`${CS_TABLE_CARD} mt-2`}>
        <thead>
          <tr>
            <th rowSpan={2} className={CS_TH_CARD}>
              Tier
              <DefRef n={2} />
            </th>
            <th rowSpan={2} className={TH_NUM}>
              Counted income
            </th>
            <th colSpan={r1.length} className={TH_MID}>
              Round 1 % of the cost
            </th>
            <th colSpan={r2.length} className={TH_MID}>
              Round 1 + 2 cap, % of the cost
            </th>
          </tr>
          <tr>
            {[...r1, ...r2].map((col, i) => (
              <th key={`${String(i)}:${col.table}`} className={TH_NUM}>
                {col.label}
                <span className={`${CS_SMALL} block font-normal`}>{col.caption}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bands.map((band, i) => {
            const tier = i + 1
            return (
              <tr key={tier} data-tier={tier}>
                <td className={`${CS_TD_CARD} font-bold`}>{tier}</td>
                <td className={TD_NUM}>{rangeWords(band)}</td>
                {r1.map((col) => (
                  <GridCellView
                    key={`r1:${col.table}`}
                    cell={gridCell(awardTables, col.table, tier, 'r1_pct')}
                    warned={warned.has(`${col.table}:${String(tier)}`)}
                    onWarn={() => warn(col.table)}
                    note={noted.get(`${col.table}:${String(tier)}`)}
                    onNote={() => {
                      const key = `${col.table}:${String(tier)}`
                      setFootnote(footnote === key ? null : key)
                    }}
                    control={boxFor('award_tables', awardTables, col.table, tier, 'r1_pct')}
                  />
                ))}
                {r2.map((col) => (
                  <GridCellView
                    key={`r2:${col.table}`}
                    cell={gridCell(appealTables, col.table, tier, 'total_pct')}
                    warned={false}
                    onWarn={() => undefined}
                    control={boxFor('round2', appealTables, col.table, tier, 'total_pct')}
                  />
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      {footnoteWords !== undefined && (
        <p data-testid="grid-note" className={`${CS_SMALL} mt-1`}>
          {footnoteWords}
        </p>
      )}
    </>
  )
}

/**
 * The tier grid (spec §6.2 E.2; owner "Tier tables = (ii) ONE COMBINED GRID"): three stacked section headers, the
 * tiers' one line, then one grid of every tier-keyed figure. A Round 1 cell a `value_cannot_bind` warning names wears
 * ⚠; its click lists that table's warnings. While a part is edited its editor takes the line's and grid's place.
 */
export function TierGridCard({
  document,
  approved,
  approvedVersion,
  names,
  statuses,
  changesBySection,
  issuesBySection,
  canEdit,
  onEdit,
  editing,
}: {
  /** The shown document: the draft's, or the version in effect's. */
  document: ApiAidRulesDocument
  /** The version in effect's document, for the line's "was"; null when there is nothing to compare. */
  approved: ApiAidRulesDocument | null
  approvedVersion: number | null
  names: RulesNames
  statuses: ReadonlyMap<ApiAidRulesSection, StatusWords>
  changesBySection: Readonly<Partial<Record<GridPart, readonly ApiAidFieldChange[]>>>
  issuesBySection: Readonly<Partial<Record<GridPart, readonly ApiAidValidationIssue[]>>>
  canEdit: boolean
  onEdit: (part: GridPart) => void
  /** The open editor and the part it edits (Task 48's table editors, Task 49's tiers editor); null when none. */
  editing: { part: GridPart; node: ReactNode } | null
}) {
  // The award table head's one list: every issue (table null, the chip) or one table's cell warnings (its ⚠).
  const [listing, setListing] = useState<{ table: string | null } | null>(null)
  const bands = bandsIn(document.tiers)
  const line = tierLineWords(bands, document.tiers.income_ceiling ?? null)
  const wasLine =
    approved === null
      ? null
      : tierLineWords(bandsIn(approved.tiers), approved.tiers.income_ceiling ?? null)
  const awardTables = document.award_tables as Tables
  const appealTables = (document.round2.tables ?? {}) as Tables
  const classes = gridClasses(document.programs as Programs, awardTables)
  const roundOne = issuesBySection.award_tables ?? []
  const warned = warnedCells(roundOne)
  const noted = notedCells(roundOne)
  const roundOneList = {
    shown: listing === null ? null : gridOrdered(roundOne, classes, listing.table),
    onChip: () => setListing(listing?.table === null ? null : { table: null }),
  }
  const onWarn = (table: string) => setListing(listing?.table === table ? null : { table })
  return (
    <section id="card-tiergrid" data-card="tiergrid" className={CS_CARD}>
      <div className="space-y-1">
        {GRID_PARTS.map((part) => {
          const status = statuses.get(part)
          const changes = changesBySection[part] ?? []
          return (
            <div key={part}>
              {status !== undefined && (
                <SectionCardHead
                  section={part}
                  title={GRID_TITLES[part]}
                  status={status}
                  issues={issuesBySection[part] ?? []}
                  canEdit={canEdit && editing === null}
                  onEdit={() => onEdit(part)}
                  {...(part === 'award_tables' ? { list: roundOneList } : {})}
                />
              )}
              {changes.length > 0 && (
                <p className={`${CS_AMBER_NOTE} mt-1`}>
                  {`Changed since v${String(approvedVersion ?? '')}: ${changes.map((c) => changeWords(c, { ...names, section: part })).join(' · ')}`}
                </p>
              )}
            </div>
          )
        })}
      </div>
      {editing !== null ? (
        <div data-testid={`grid-editor-${editing.part}`} className="mt-2">
          <GridWarnContext.Provider value={onWarn}>{editing.node}</GridWarnContext.Provider>
        </div>
      ) : (
        <>
          <p data-testid="tier-line" className="mt-2">
            {line}
            <DefRef n={3} />
            {wasLine !== null && wasLine !== line && (
              <span className="ml-2 text-amber-700 dark:text-amber-400">{`was ${wasLine}`}</span>
            )}
          </p>
          <TierGridTable
            bands={bands}
            awardTables={awardTables}
            appealTables={appealTables}
            classes={classes}
            warned={warned}
            noted={noted}
            onWarn={onWarn}
          />
        </>
      )}
    </section>
  )
}
