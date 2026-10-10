import { Lock } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  CS_AMBER_NOTE,
  CS_CARD,
  CS_CARD_HEADING,
  CS_CLABEL,
  CS_SMALL,
  CS_TABLE_CARD,
  CS_TD_CARD,
  CS_TH_CARD,
} from '../../kit/csType'
import { DefRef } from '../../kit/DefinitionNotes'
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
  lockNote,
  type SandboxBinding,
} from './sandboxModel'
import { PAGE_NOTE } from './scenarioNotes'
import { LOCKED_CARD } from './scenarioStyles'

type Tables = Readonly<Record<string, TableShape>>
type Programs = Readonly<Record<string, { readonly equity_class?: string | null }>>

const TH_NUM = CS_TH_CARD.replace('text-left', 'text-right')
const TH_MID = CS_TH_CARD.replace('text-left', 'text-center')
const TD_NUM = `${CS_TD_CARD} text-right tabular-nums`

export function LockNoteView({ text }: { text: string }) {
  return (
    <span className={`${CS_SMALL} inline-flex items-center gap-1 font-semibold`}>
      <Lock size={12} />
      <span>{text}</span>
      <DefRef n={PAGE_NOTE.locked} />
    </span>
  )
}

function Cell({
  part,
  table,
  tier,
  tables,
  binding,
  locked,
}: {
  part: 'r1' | 'cap'
  table: string
  tier: number
  tables: Tables
  binding: SandboxBinding
  locked: boolean
}) {
  const tint = locked ? LOCKED_CARD : ''
  if (cellEditable(binding.typed, part, table)) {
    const name = `${part === 'r1' ? 'Round 1 %' : 'Round 1 + 2 cap'} · ${classLabel(table, binding.typed)} · tier ${String(tier)}`
    return (
      <td className={`${TD_NUM} ${tint}`}>
        <SandboxBox
          boxKey={cellKey(part, table, tier)}
          label={name}
          width={46}
          unit={null}
          binding={binding}
        />
      </td>
    )
  }
  const cell = gridCell(tables, table, tier, part === 'r1' ? 'r1_pct' : 'total_pct')
  return (
    <td data-inherited="" className={`${TD_NUM} ${tint} text-muted-foreground`}>
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
  const note = lockNote('tiers', binding.locked, binding.byRound)
  const r1Locked = binding.locked.includes('award_tables')
  const capLocked = binding.locked.includes('round2')
  const awardTables = doc.award_tables as Tables
  const capTables = (doc.round2.tables ?? {}) as Tables
  // The server sends no groups here (the document is the one being typed): the pools come from the document itself.
  const classes = gridClasses(doc.programs as Programs, awardTables, documentGroups(doc))
  const r1 = gridColumns(awardTables, classes, (key) => poolHeadLabel(key, doc))
  const caps = gridColumns(capTables, classes, (key) => poolHeadLabel(key, doc))
  const fixFirst = fixFirstWords(cardProblems(binding.problems, 'tiers'), doc)
  return (
    <section data-card="sandbox-tiers" className={`${CS_CARD} ${r1Locked ? LOCKED_CARD : ''}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className={CS_CARD_HEADING}>Tiers &amp; Round 1</h3>
        {note !== null && <LockNoteView text={note} />}
        {fitButton}
      </div>
      {fixFirst !== null && <p className={CS_AMBER_NOTE}>{fixFirst}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-4.5 gap-y-1.5 tabular-nums">
        <label className={`${CS_CLABEL} inline-flex items-baseline gap-1`}>
          Start{' '}
          <SandboxBox boxKey={TIER_START} label="Start" width={96} unit="$" binding={binding} />
        </label>
        <label className={`${CS_CLABEL} inline-flex items-baseline gap-1`}>
          Band width{' '}
          <SandboxBox
            boxKey={TIER_WIDTH}
            label="Band width"
            width={96}
            unit="$"
            binding={binding}
          />
        </label>
        <label className={`${CS_CLABEL} inline-flex items-baseline gap-1`}>
          Tiers{' '}
          <SandboxBox boxKey={TIER_COUNT} label="Tiers" width={46} unit={null} binding={binding} />
        </label>
        <label className={`${CS_CLABEL} inline-flex items-baseline gap-1`}>
          Income ceiling
          <DefRef n={PAGE_NOTE.ceiling} />
          <SandboxBox
            boxKey={CEILING}
            label="Income ceiling"
            width={96}
            unit="$"
            placeholder="none"
            binding={binding}
          />
        </label>
        <span className="bg-border h-5 w-px" />
        <label className={`${CS_CLABEL} inline-flex items-baseline gap-1`}>
          Minimum award{' '}
          <SandboxBox
            boxKey={MINIMUM}
            label="Minimum award"
            width={96}
            unit="$"
            binding={binding}
          />
        </label>
      </div>
      {fitAnswer}
      <table data-testid="sandbox-grid" className={`${CS_TABLE_CARD} mt-2`}>
        <thead>
          <tr>
            <th rowSpan={2} className={CS_TH_CARD}>
              Tier
              <DefRef n={PAGE_NOTE.tier} />
            </th>
            <th rowSpan={2} className={TH_NUM}>
              Counted income
            </th>
            <th colSpan={r1.length} className={TH_MID}>
              {r1Locked && <Lock size={12} className="mr-1 inline" />}
              Round 1 % of the cost
            </th>
            <th colSpan={caps.length} className={TH_MID}>
              {capLocked && <Lock size={12} className="mr-1 inline" />}
              Round 1 + 2 cap, % of the cost
            </th>
          </tr>
          <tr>
            {[...r1, ...caps].map((col, i) => (
              <th key={`${String(i)}:${col.table}`} className={TH_NUM}>
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
                <td className={`${CS_TD_CARD} font-bold`}>{tier}</td>
                <td className={TD_NUM}>{rangeWords(band)}</td>
                {r1.map((col) => (
                  <Cell
                    key={`r1:${col.table}`}
                    part="r1"
                    table={col.table}
                    tier={tier}
                    tables={awardTables}
                    binding={binding}
                    locked={r1Locked}
                  />
                ))}
                {caps.map((col) => (
                  <Cell
                    key={`cap:${col.table}`}
                    part="cap"
                    table={col.table}
                    tier={tier}
                    tables={capTables}
                    binding={binding}
                    locked={capLocked}
                  />
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
