import { useCallback, useRef, useState } from 'react'

import type { AidRequestSet } from '../../../../services/camperships/aidApi'
import type { ApiAidScenarioCompare, ApiAidScenarioWorkspace } from '../../../../types/api-types'
import { NEGATIVE_INK, POOL_NEGATIVE_INK } from '../../kit/aidStyles'
import {
  CS_AMBER_NOTE,
  CS_BODY,
  CS_BTN2,
  CS_BTN_SM,
  CS_CARD,
  CS_FLABEL,
  CS_LINK_SM,
  CS_PANEL_HEAD,
  CS_SMALL,
} from '../../kit/csType'
import { DefRef } from '../../kit/DefinitionNotes'
import type { RulesVocabulary } from '../rules/rulesModel'
import {
  columnHeads,
  compareRows,
  compareSources,
  cornerWords,
  type ColumnChoice,
  type ColumnKey,
  type CompareCell,
} from './compareModel'
import { RenameBox } from './ScenarioControls'
import { ScenarioPopover } from './ScenarioPopover'
import { PAGE_NOTE } from './scenarioNotes'
import { DRAFT_CHIP, KEPT_CHIP, PLAIN_CHIP, SETTING_CHANGED, UP_INK } from './scenarioStyles'

const CHIPS = { kept: KEPT_CHIP, draft: DRAFT_CHIP, plain: PLAIN_CHIP } as const
/** The sticky first column (the mock's `td.pin`): 220–280px, so a setting's name wraps less. */
const LABEL_COLUMN =
  'bg-card sticky left-0 min-w-[220px] max-w-[280px] pr-2 text-left whitespace-normal'

/** Columns ▾, By tier and Print, on the control line's right in Compare (§S5 A6, §S5 H). */
export function CompareTools({
  choices,
  checked,
  refused,
  onToggle,
  byTier,
  onByTier,
}: {
  choices: readonly ColumnChoice[]
  checked: readonly ColumnKey[]
  refused: string | null
  onToggle: (key: ColumnKey) => void
  byTier: boolean
  onByTier: (on: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const anchor = useRef<HTMLButtonElement>(null)
  return (
    <span className="relative flex items-center gap-2">
      <button ref={anchor} type="button" className={CS_BTN2} onClick={() => setOpen((was) => !was)}>
        Columns ▾
      </button>
      <ScenarioPopover
        open={open}
        onClose={close}
        anchor={anchor}
        align="right"
        width={300}
        testId="columns-popover"
      >
        <ul className="space-y-1">
          {choices.map((choice) => (
            <li key={choice.key}>
              <label className={`${CS_FLABEL} flex items-center gap-1.5`}>
                <input
                  type="checkbox"
                  checked={checked.includes(choice.key)}
                  disabled={choice.disabled}
                  onChange={() => onToggle(choice.key)}
                />
                {choice.label}
              </label>
            </li>
          ))}
        </ul>
      </ScenarioPopover>
      {refused !== null && <span className={CS_AMBER_NOTE}>{refused}</span>}
      <label className={`${CS_FLABEL} inline-flex items-center gap-1`}>
        <input
          type="checkbox"
          checked={byTier}
          onChange={(event) => onByTier(event.target.checked)}
        />
        By tier
      </label>
      <button type="button" className={CS_BTN2} onClick={() => window.print()}>
        Print
      </button>
    </span>
  )
}

function CellView({ cell }: { cell: CompareCell }) {
  if (cell.upDown !== undefined) {
    return (
      <>
        <span className={UP_INK}>{`▲${String(cell.upDown.up)}`}</span>{' '}
        <span className={NEGATIVE_INK}>{`▼${String(cell.upDown.down)}`}</span>
      </>
    )
  }
  const tone =
    cell.tone === 'changed'
      ? SETTING_CHANGED
      : cell.tone === 'pool-negative'
        ? POOL_NEGATIVE_INK
        : cell.tone === 'total-negative'
          ? NEGATIVE_INK
          : cell.tone === 'muted'
            ? 'text-muted-foreground'
            : ''
  return (
    <>
      <span className={tone}>{cell.text}</span>
      {cell.note !== undefined && <span className={`${CS_SMALL} ml-1`}>{cell.note}</span>}
      {cell.sub !== undefined && <span className={`${CS_SMALL} block`}>{cell.sub}</span>}
    </>
  )
}

/**
 * Compare (Scenarios addendum §S5 H): one table, every column priced on the same applications, now, in the fixed
 * order. The first column is sticky. Print prints the table alone: today's print rules already hide the band and
 * the tab strip on Scenarios (AidSeasonPage), and a print-only header names the season and what was priced.
 */
export function CompareTable({
  compare,
  loading,
  error,
  stale,
  workspace,
  lastSeason,
  requestSet,
  byTier,
  locked,
  draftName,
  effectName,
  names,
  canEdit,
  printedOn,
  onPromote,
  onRename,
}: {
  compare: ApiAidScenarioCompare | undefined
  loading: boolean
  error: string | null
  stale: boolean
  workspace: ApiAidScenarioWorkspace
  lastSeason: boolean
  requestSet: AidRequestSet
  byTier: boolean
  locked: boolean
  draftName: string
  effectName: string
  names: RulesVocabulary
  canEdit: boolean
  printedOn: string
  onPromote: (code: string) => void
  onRename: (code: string, name: string) => void
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  if (compare === undefined) {
    return (
      <p className={error !== null ? CS_AMBER_NOTE : CS_SMALL}>
        {error ?? (loading ? 'Pricing the columns…' : '')}
      </p>
    )
  }
  const sources = compareSources(compare, lastSeason)
  const heads = columnHeads(sources, workspace, draftName, workspace.year)
  const rows = compareRows(sources, { byTier, locked, effectName, names })
  const corner = cornerWords(sources, requestSet)
  const notLoaded =
    lastSeason &&
    compare.last_season !== null &&
    compare.last_season !== undefined &&
    !compare.last_season.loaded
  return (
    <div data-print-alone className="space-y-1">
      <div data-testid="compare-print-head" className={`${CS_BODY} hidden print:block`}>
        <div className="font-bold">{`Season ${String(workspace.year)} · Scenarios compare`}</div>
        <div>{`Printed ${printedOn} · ${corner.replace(/^Priced on /, '')} · ${effectName} in effect`}</div>
      </div>
      {error !== null && <p className={`${CS_AMBER_NOTE} print:hidden`}>{error}</p>}
      {(compare.last_rules_refused ?? null) !== null && (
        <p
          className={`${CS_SMALL} print:hidden`}
        >{`Last season's rules are left out: ${compare.last_rules_refused ?? ''}`}</p>
      )}
      <div
        data-testid="compare-table"
        data-stale={stale ? '' : undefined}
        className={`${CS_CARD} overflow-x-auto p-0 data-[stale]:opacity-60`}
      >
        <table className={`${CS_BODY} w-full border-collapse tabular-nums`}>
          <thead>
            <tr>
              <th
                className={`${LABEL_COLUMN} z-10 py-1 pl-2 align-bottom font-normal shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]`}
              >
                <span className={CS_SMALL}>
                  <span>{corner}</span>
                  <DefRef n={PAGE_NOTE.compare} />
                </span>
              </th>
              {heads.map((head) => (
                <th
                  key={head.code}
                  data-testid={`compare-head-${head.code}`}
                  className="min-w-[150px] px-2 py-1 text-right align-bottom"
                >
                  {/* The chip has no size of its own: CS_SMALL gives it the mock's 12px, and its own ink wins. */}
                  <span className={CS_SMALL}>
                    <span className={CHIPS[head.chipTone]}>{head.chip}</span>
                  </span>
                  {renaming === head.code && head.option !== null ? (
                    <RenameBox
                      code={head.code}
                      name={head.name}
                      width={150}
                      onRename={onRename}
                      onDone={() => setRenaming(null)}
                    />
                  ) : (
                    <div className="font-semibold whitespace-normal">{head.name}</div>
                  )}
                  <div className={CS_SMALL}>{head.meta}</div>
                  {head.option !== null && canEdit && (
                    <div className="mt-1 flex flex-wrap justify-end gap-1 print:hidden">
                      {head.option.promotable === true ? (
                        <button
                          type="button"
                          className={CS_BTN_SM}
                          onClick={() => onPromote(head.code)}
                        >
                          {`Make ${head.code} the Rules Draft…`}
                        </button>
                      ) : (
                        head.option.blocked !== null &&
                        head.option.blocked !== undefined && (
                          <span className={CS_SMALL}>{head.option.blocked}</span>
                        )
                      )}
                      <button
                        type="button"
                        className={`${CS_LINK_SM}`}
                        onClick={() => setRenaming(head.code)}
                      >
                        Rename
                      </button>
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) =>
              row.kind === 'section' ? (
                <tr key={`s:${row.label}`}>
                  <td
                    colSpan={heads.length + 1}
                    className={`${CS_PANEL_HEAD} bg-muted/30 px-2 py-1`}
                  >
                    {row.label}
                  </td>
                </tr>
              ) : row.kind === 'note' ? (
                <tr key={`n:${row.label}`}>
                  <td colSpan={heads.length + 1} className={`${CS_SMALL} px-2 py-1`}>
                    {row.label}
                  </td>
                </tr>
              ) : (
                <tr
                  key={`${String(i)}:${row.label}`}
                  className={row.muted ? 'text-muted-foreground' : ''}
                >
                  <td
                    className={`${LABEL_COLUMN} py-0.5 ${row.indent ? 'pl-5' : 'pl-2'} ${row.bold ? 'font-bold' : ''}`}
                  >
                    {row.label}
                  </td>
                  {row.cells.map((cell, c) => (
                    <td
                      key={`${String(c)}:${heads[c]?.code ?? ''}`}
                      className={`px-2 py-0.5 text-right ${row.bold ? 'font-bold' : ''}`}
                    >
                      <CellView cell={cell} />
                    </td>
                  ))}
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
      {notLoaded && <p className={CS_SMALL}>{compare.last_season?.label}</p>}
    </div>
  )
}
