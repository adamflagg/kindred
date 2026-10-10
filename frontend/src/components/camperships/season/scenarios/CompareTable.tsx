import { useState } from 'react'

import type { AidRequestSet } from '../../../../services/camperships/aidApi'
import type { ApiAidScenarioCompare, ApiAidScenarioWorkspace } from '../../../../types/api-types'
import { NEGATIVE_INK, POOL_NEGATIVE_INK } from '../../kit/aidStyles'
import { AidPickerMulti } from '../../kit/AidPicker'
import {
  CS_AMBER_NOTE,
  CS_BAND_EDGE,
  CS_BAND_WARN,
  CS_BODY,
  CS_BTN2,
  CS_LINK_SM,
  CS_RULE,
  CS_RULE_GROUP,
  CS_SMALL,
} from '../../kit/csType'
import { DefRef } from '../../kit/DefinitionNotes'
import { GROUP_ROW, TABLE_CARD, TD, TH } from '../../kit/kitStyles'
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
import { PAGE_NOTE } from './scenarioNotes'
import { UP_INK } from './scenarioStyles'

/** The kit grid (design-language §8): the header fill incl. the corner, a light rule on every column, the firmer
 * group rule before the first option column, 5px 8px cells. */
const HEAD = `${TH.replace('text-left', 'text-right').replace('whitespace-normal', 'whitespace-nowrap')} overflow-hidden`
const HEAD_GROUP = HEAD.replace(CS_RULE, CS_RULE_GROUP)
/** The corner: the same header cell, pinned with the label column. */
const CORNER = `${TH} sticky left-0 z-10`
const CELL = TD.replace('align-top', 'align-middle')
const LABEL = `${CELL.replace('overflow-hidden ', '')} bg-card sticky left-0 whitespace-normal`
const OPTION = `${CELL} text-right whitespace-nowrap`
const OPTION_GROUP = OPTION.replace(CS_RULE, CS_RULE_GROUP)
/** The label column's width (the mock's 300px); the option columns share the rest equally. */
const LABEL_WIDTH = 300
const OPTION_MIN = 170
/** The kit's dashed empty box (the mock's `.cf-empty`), standing where the table would. */
const EMPTY = `bg-card border-border text-muted-foreground rounded-xl border border-dashed px-4 py-3.5 ${CS_BODY}`

/** Columns · N, By tier and Print, on the toolbar's right in Compare (§S5 A6, §S5 H; scenarios-11). Columns' four-option
 * refusal is the toolbar's status (ScenarioControls), not a line here. */
export function CompareTools({
  choices,
  checked,
  onToggle,
  byTier,
  onByTier,
}: {
  choices: readonly ColumnChoice[]
  checked: readonly ColumnKey[]
  onToggle: (key: ColumnKey) => void
  byTier: boolean
  onByTier: (on: boolean) => void
}) {
  return (
    <>
      <AidPickerMulti<ColumnKey>
        label="Columns"
        values={checked}
        options={choices.map((choice) => ({
          value: choice.key,
          label: choice.label,
          disabled: choice.disabled,
        }))}
        noun="columns"
        none="Columns"
        faceText={`Columns · ${String(checked.length)}`}
        // The picker hands back the whole list: the one key that moved is the toggle (a refused add leaves it as was).
        onChange={(next) => {
          const moved =
            next.find((key) => !checked.includes(key)) ?? checked.find((key) => !next.includes(key))
          if (moved !== undefined) onToggle(moved)
        }}
      />
      <label className="text-foreground inline-flex cursor-pointer items-center gap-[5px] text-[12.5px] whitespace-nowrap">
        <input
          type="checkbox"
          className="accent-primary m-0 h-[13px] w-[13px]"
          checked={byTier}
          onChange={(event) => onByTier(event.target.checked)}
        />
        By tier
      </label>
      <button type="button" className={CS_BTN2} onClick={() => window.print()}>
        Print
      </button>
    </>
  )
}

function CellView({ cell }: { cell: CompareCell }) {
  if (cell.upDown !== undefined) {
    return (
      <>
        <span className={UP_INK}>{`▲${String(cell.upDown.up)}`}</span>{' '}
        <span className={POOL_NEGATIVE_INK}>{`▼${String(cell.upDown.down)}`}</span>
      </>
    )
  }
  const tone =
    cell.tone === 'pool-negative'
      ? POOL_NEGATIVE_INK
      : cell.tone === 'total-negative'
        ? NEGATIVE_INK
        : cell.tone === 'muted'
          ? 'text-muted-foreground'
          : ''
  // One line each: the second part muted after "·" (the mock), never a second line.
  return (
    <>
      <span className={tone}>{cell.text}</span>
      {cell.note !== undefined && (
        <span className="text-muted-foreground font-normal">{` · ${cell.note}`}</span>
      )}
      {cell.sub !== undefined && (
        <span className="text-muted-foreground font-normal">{` · ${cell.sub}`}</span>
      )}
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
  held,
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
  /** An applications pile is held: with none, Compare has nothing to price (scenarios-12). */
  held: boolean
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
  if (!held) {
    return (
      <p className={`${EMPTY} print:hidden`}>
        No applications are held yet: <b className="text-foreground">Update Applications</b> first,
        then Compare prices every column on them.
      </p>
    )
  }
  if (compare === undefined) {
    return (
      <p className={error !== null ? CS_AMBER_NOTE : CS_SMALL}>
        {error ?? (loading ? 'Pricing the columns…' : '')}
      </p>
    )
  }
  const sources = compareSources(compare, lastSeason)
  const heads = columnHeads(sources, workspace, draftName)
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
        className={`${TABLE_CARD} data-[stale]:opacity-60`}
      >
        <table
          className={`${CS_BODY} w-full table-fixed border-separate border-spacing-0 tabular-nums`}
          style={{ minWidth: LABEL_WIDTH + heads.length * OPTION_MIN }}
        >
          <colgroup>
            <col style={{ width: LABEL_WIDTH }} />
            {heads.map((head) => (
              <col key={head.code} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className={CORNER}>
                <span>{corner}</span>
                <DefRef n={PAGE_NOTE.colours} />
              </th>
              {heads.map((head, c) => (
                <th
                  key={head.code}
                  data-testid={`compare-head-${head.code}`}
                  title={head.title}
                  className={c === 0 ? HEAD_GROUP : HEAD}
                >
                  <div className="flex min-w-0 flex-col items-end gap-px">
                    {renaming === head.code && head.option !== null ? (
                      <RenameBox
                        code={head.code}
                        name={head.name}
                        width={150}
                        onRename={onRename}
                        onDone={() => setRenaming(null)}
                      />
                    ) : (
                      <b
                        className="text-foreground max-w-full truncate text-[12.5px]"
                        title={head.headline}
                      >
                        {head.headline}
                      </b>
                    )}
                    <span className="text-muted-foreground max-w-full truncate text-[11px] font-normal">
                      {head.meta}
                    </span>
                    {head.option !== null && canEdit ? (
                      <span className="flex max-w-full min-w-0 gap-2 print:hidden">
                        {head.option.promotable === true ? (
                          <button
                            type="button"
                            className={`${CS_LINK_SM} font-normal`}
                            onClick={() => onPromote(head.code)}
                          >
                            {`Make ${head.code} the Rules Draft…`}
                          </button>
                        ) : (
                          head.option.blocked !== null &&
                          head.option.blocked !== undefined && (
                            <span
                              className="text-muted-foreground truncate text-xs font-normal"
                              title={head.option.blocked}
                            >
                              {head.option.blocked}
                            </span>
                          )
                        )}
                        <button
                          type="button"
                          className={`${CS_LINK_SM} font-normal`}
                          onClick={() => setRenaming(head.code)}
                        >
                          Rename
                        </button>
                      </span>
                    ) : (
                      <span className="text-xs print:hidden">&nbsp;</span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) =>
              row.kind === 'section' ? (
                <tr key={`s:${row.label}`}>
                  <td colSpan={heads.length + 1} className={`${GROUP_ROW} ${CS_BAND_EDGE}`}>
                    {row.label}
                  </td>
                </tr>
              ) : row.kind === 'note' ? (
                <tr key={`n:${row.label}`}>
                  <td colSpan={heads.length + 1} className={`${LABEL} text-muted-foreground`}>
                    {row.label}
                  </td>
                </tr>
              ) : (
                <tr
                  key={`${String(i)}:${row.label}`}
                  className={row.muted ? 'text-muted-foreground' : ''}
                >
                  <td
                    className={`${LABEL} ${row.indent ? 'pl-5' : ''} ${row.bold ? 'font-bold' : ''}`}
                  >
                    {row.label}
                    {row.defNote !== undefined && <DefRef n={row.defNote} />}
                  </td>
                  {row.cells.map((cell, c) => (
                    <td
                      key={`${String(c)}:${heads[c]?.code ?? ''}`}
                      title={cell.title}
                      className={`${c === 0 ? OPTION_GROUP : OPTION} ${row.bold ? 'font-bold' : ''} ${cell.tone === 'changed' ? CS_BAND_WARN : ''}`}
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
      {notLoaded && <p className={`${CS_SMALL} mt-1.5 ml-0.5`}>{compare.last_season?.label}</p>}
    </div>
  )
}
