import type { ReactNode } from 'react'

import { CS_AMBER_NOTE, CS_CARD_HEADING, CS_SMALL } from '../../kit/csType'
import {
  RG_TABLE_FIT,
  RG_TD_GROUP_NUM,
  RG_TD_NAME,
  RG_TD_NUM,
  RG_TH,
  RG_TH_GROUP_NUM,
  RG_TH_NUM,
  RG_WRAP_FIT,
} from '../rules/gridStyles'
import {
  bandsIn,
  gridCell,
  documentGroups,
  gridClasses,
  gridColumns,
  rangeWords,
  type TableShape,
} from '../rules/tierGrid'
import { SandboxBox } from './SandboxBox'
import {
  CEILING,
  MINIMUM,
  TIER_COUNT,
  TIER_START,
  TIER_WIDTH,
  cardProblems,
  cellEditable,
  cellKey,
  classLabel,
  poolHeadLabel,
  fixFirstWords,
  type SandboxBinding,
} from './sandboxModel'
import { TITLE_WORDS } from './scenarioNotes'
import { CARD_SHELL, GROUP_HEAD } from './scenarioStyles'

type Tables = Readonly<Record<string, TableShape>>
type Programs = Readonly<Record<string, { readonly equity_class?: string | null }>>

/** A settings-line label (the mock's `.sc-set label`): 13px/600, the unit beside its box muted. */
const SET_LABEL =
  'text-foreground inline-flex items-center gap-1 text-[13px] font-semibold whitespace-nowrap'

function Cell({
  part,
  table,
  tier,
  tables,
  binding,
  first,
}: {
  part: 'r1' | 'cap'
  table: string
  tier: number
  tables: Tables
  binding: SandboxBinding
  /** The first column of its block: the firmer group rule. */
  first: boolean
}) {
  const td = first ? RG_TD_GROUP_NUM : RG_TD_NUM
  if (cellEditable(binding.typed, part, table)) {
    const name = `${part === 'r1' ? 'Round 1 %' : 'Round 1 + 2 cap'} · ${classLabel(table, binding.typed)} · tier ${String(tier)}`
    return (
      <td className={td}>
        <SandboxBox
          boxKey={cellKey(part, table, tier)}
          label={name}
          width={64}
          unit={null}
          binding={binding}
        />
      </td>
    )
  }
  const cell = gridCell(tables, table, tier, part === 'r1' ? 'r1_pct' : 'total_pct')
  return (
    <td data-inherited="" className={`${td} text-muted-foreground`}>
      {cell.value === null ? '—' : `${cell.value}%`}
    </td>
  )
}

/**
 * Tiers & Round 1 (§S5 F1): the Rules tab's tiers editor (start, band width, count, ceiling) and the minimum on one
 * line, then PR 9's combined grid. Only a table's own cells are boxes; an inheriting table shows its parent's
 * values and its overrides, read only. Fit to Budget sits on the header; its answer between the line and the grid.
 */
export function SandboxTierCard({
  binding,
  fitButton,
  fitAnswer,
}: {
  binding: SandboxBinding
  fitButton: ReactNode
  fitAnswer: ReactNode
}) {
  const doc = binding.typed
  const awardTables = doc.award_tables as Tables
  const capTables = (doc.round2.tables ?? {}) as Tables
  // The server sends no groups here (the document is the one being typed): the pools come from the document itself.
  const classes = gridClasses(doc.programs as Programs, awardTables, documentGroups(doc))
  const r1 = gridColumns(awardTables, classes, (key) => poolHeadLabel(key, doc))
  const caps = gridColumns(capTables, classes, (key) => poolHeadLabel(key, doc))
  const fixFirst = fixFirstWords(cardProblems(binding.problems, 'tiers'), doc)
  return (
    <section data-card="sandbox-tiers" className={CARD_SHELL}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={CS_CARD_HEADING}>Tiers &amp; Round 1</h3>
        {fitButton}
      </div>
      {fixFirst !== null && <p className={CS_AMBER_NOTE}>{fixFirst}</p>}
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 pt-1 pb-1.5 tabular-nums">
        <label className={SET_LABEL}>
          Start{' '}
          <SandboxBox boxKey={TIER_START} label="Start" width={84} unit="$" binding={binding} />
        </label>
        <label className={SET_LABEL}>
          Band width{' '}
          <SandboxBox
            boxKey={TIER_WIDTH}
            label="Band width"
            width={84}
            unit="$"
            binding={binding}
          />
        </label>
        <label className={SET_LABEL}>
          Tiers{' '}
          <SandboxBox boxKey={TIER_COUNT} label="Tiers" width={48} unit={null} binding={binding} />
        </label>
        <label className={SET_LABEL} title={TITLE_WORDS.ceiling}>
          Income ceiling{' '}
          <SandboxBox
            boxKey={CEILING}
            label="Income ceiling"
            width={84}
            unit="$"
            placeholder="none"
            binding={binding}
          />
        </label>
        <label className={SET_LABEL}>
          Minimum award{' '}
          <SandboxBox
            boxKey={MINIMUM}
            label="Minimum award"
            width={64}
            unit="$"
            binding={binding}
          />
        </label>
      </div>
      {fitAnswer}
      <div className={RG_WRAP_FIT}>
        <table data-testid="sandbox-grid" className={RG_TABLE_FIT}>
          <thead>
            <tr>
              <th colSpan={2} className={RG_TH} />
              <th colSpan={r1.length} className={GROUP_HEAD}>
                Round 1 % of the cost
              </th>
              <th colSpan={caps.length} className={GROUP_HEAD}>
                Round 1 + 2 cap, % of the cost
              </th>
            </tr>
            <tr>
              <th className={RG_TH} title={TITLE_WORDS.tier}>
                Tier
              </th>
              <th className={RG_TH_NUM}>Counted income</th>
              {[...r1, ...caps].map((col, i) => (
                <th
                  key={`${String(i)}:${col.table}`}
                  className={i === 0 || i === r1.length ? RG_TH_GROUP_NUM : RG_TH_NUM}
                >
                  {col.label}
                  <span className={`${CS_SMALL} block font-normal`}>{col.caption}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bandsIn(doc.tiers).map((band, i) => {
              const tier = i + 1
              return (
                <tr key={tier} data-tier={tier}>
                  <td className={RG_TD_NAME}>{tier}</td>
                  <td className={RG_TD_NUM}>{rangeWords(band)}</td>
                  {r1.map((col, c) => (
                    <Cell
                      key={`r1:${col.table}`}
                      part="r1"
                      table={col.table}
                      tier={tier}
                      tables={awardTables}
                      binding={binding}
                      first={c === 0}
                    />
                  ))}
                  {caps.map((col, c) => (
                    <Cell
                      key={`cap:${col.table}`}
                      part="cap"
                      table={col.table}
                      tier={tier}
                      tables={capTables}
                      binding={binding}
                      first={c === 0}
                    />
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
