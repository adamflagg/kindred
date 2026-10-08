import type { ReactNode } from 'react'
import { Link } from 'react-router'

import type { ApiAidRulesSection } from '../../../../types/api-types'
import { DefRef } from '../../kit/DefinitionNotes'
import {
  CS_LINK,
  CS_PANEL_HEAD,
  CS_PILL,
  CS_SMALL,
  CS_TABLE_CARD,
  CS_TD_CARD,
  CS_TH_CARD,
} from '../../kit/csType'
import { checkRows, equityClasses, equityRows, namedAwardRows, settingText } from './rulesCards'
import { keyLabel, type RulesNames } from './rulesModel'

/** In the editor: the box for one editable cell, by its path within the section. */
export type CellControl = (path: readonly string[]) => ReactNode

// One text-align per class string: CS_TH_CARD carries text-left, so the others swap it rather than add a second.
const TH_NUM = CS_TH_CARD.replace('text-left', 'text-right')
const TH_MID = CS_TH_CARD.replace('text-left', 'text-center')
const TD_NUM = `${CS_TD_CARD} text-right tabular-nums`
const TD_MID = `${CS_TD_CARD} text-center`
const TD_NAME = `${CS_TD_CARD} font-bold`
const WAS = 'ml-1 text-amber-700 dark:text-amber-400'

const check = (on: boolean) => (on ? '✓' : '—')

/** A read-only column's head: its words, then "read-only" under them (§6.2 E). */
function RoTh({
  children,
  className = CS_TH_CARD,
  rowSpan,
}: {
  children: ReactNode
  className?: string
  rowSpan?: number
}) {
  return (
    <th rowSpan={rowSpan} className={className}>
      {children}
      <span className={`${CS_SMALL} block font-normal`}>read-only</span>
    </th>
  )
}

/** A table's caption line: its sub-head and its one sentence. */
function Caption({
  title,
  note,
  children,
}: {
  title: string
  note?: number
  children?: ReactNode
}) {
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
      <span className={CS_PANEL_HEAD}>
        {title}
        {note !== undefined && <DefRef n={note} />}
      </span>
      {children !== undefined && <span className={CS_SMALL}>{children}</span>}
    </div>
  )
}

function EquityTable({ content, approved, names, details, dependentsMode, control }: TablesProps) {
  const classes = equityClasses(content)
  return (
    <table data-testid="equity-table" className={`${CS_TABLE_CARD} mt-1.5`}>
      <thead>
        <tr>
          <th rowSpan={2} className={CS_TH_CARD}>
            Criterion
          </th>
          <th rowSpan={2} className={TH_MID}>
            Enabled
          </th>
          <th colSpan={classes.length} className={TH_MID}>
            Weight, by equity class
            <DefRef n={7} />
          </th>
          <RoTh rowSpan={2}>Counts when</RoTh>
          {details && <RoTh rowSpan={2}>Reads</RoTh>}
        </tr>
        <tr>
          {classes.map((cls) => (
            <th key={cls} className={TH_NUM}>
              {keyLabel(cls, names)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {equityRows(content, approved).map((row) => (
          <tr
            key={row.key}
            data-criterion={row.key}
            className={row.enabled ? undefined : 'opacity-50'}
          >
            <td className={TD_NAME}>{row.label}</td>
            <td className={TD_MID}>
              {control ? control(['criteria', String(row.index), 'enabled']) : check(row.enabled)}
              {row.was !== null && <span className={WAS}>{row.was}</span>}
            </td>
            {classes.map((cls) => (
              <td key={cls} className={TD_NUM}>
                {control
                  ? control(['weights', cls, row.key])
                  : settingText(
                      row.weights[cls] ?? '0',
                      'weight',
                      ['weights', cls, row.key],
                      names
                    )}
              </td>
            ))}
            <td className={CS_TD_CARD}>
              {row.countsWhen.words}
              {row.countsWhen.chips.map((chip) => (
                <span key={chip} className={`${CS_PILL.muted} ml-1`}>
                  {chip}
                </span>
              ))}
              {row.dependents && dependentsMode !== 'tier_shift' && (
                <span className={`${CS_SMALL} ml-1`}>not used: dependents lower the income</span>
              )}
            </td>
            {details && <td className={CS_TD_CARD}>{row.reads}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function NamedAwardsTable({ content, names, control, grantsHref }: TablesProps) {
  return (
    <>
      <Caption title="Named awards" note={5}>
        Kinds of decision with their own line in the budget, in any round.
      </Caption>
      <table data-testid="named-awards-table" className={`${CS_TABLE_CARD} mt-1`}>
        <thead>
          <tr>
            <th className={CS_TH_CARD}>Award</th>
            <RoTh>Kind</RoTh>
            <RoTh className={TH_NUM}>Round</RoTh>
            <th className={TH_NUM}>Amount</th>
            <th className={TH_NUM}>Extra amount</th>
            <RoTh className={TH_MID}>Allows an appeal</RoTh>
            <RoTh className={TH_MID}>Counts toward the budget</RoTh>
          </tr>
        </thead>
        <tbody>
          {namedAwardRows(content, names).map((row) => (
            <tr key={row.key}>
              <td className={TD_NAME}>
                {row.label}
                {row.note !== null && (
                  <span className={`${CS_SMALL} block font-normal`}>{row.note}</span>
                )}
                {row.managedInGrants && grantsHref !== undefined && (
                  <Link to={grantsHref} className={`${CS_SMALL} ${CS_LINK} block font-normal`}>
                    Managed in Grants ›
                  </Link>
                )}
              </td>
              <td className={CS_TD_CARD}>{row.kind}</td>
              <td className={TD_NUM}>{row.round}</td>
              <td className={TD_NUM}>
                {row.amount === null
                  ? '—'
                  : control
                    ? control(['decision_types', row.key, 'amount'])
                    : row.amount}
              </td>
              <td className={TD_NUM}>
                {row.extra === null
                  ? '—'
                  : control
                    ? control(['decision_types', row.key, 'extra_amount'])
                    : row.extra}
              </td>
              <td className={TD_MID}>{check(row.allowsAppeal)}</td>
              <td className={TD_MID}>{check(row.counts)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function ChecksTable({ content, names, control }: TablesProps) {
  return (
    <table data-testid="checks-table" className={`${CS_TABLE_CARD} mt-1.5`}>
      <thead>
        <tr>
          <th className={CS_TH_CARD}>Check</th>
          <th className={TH_MID}>On</th>
          <th className={CS_TH_CARD}>Hold or warn</th>
          <th className={TH_NUM}>Above</th>
        </tr>
      </thead>
      <tbody>
        {checkRows(content, names).map((row) => (
          <tr key={row.key}>
            <td className={TD_NAME}>{row.label}</td>
            <td className={TD_MID}>
              {control ? control(['checks', row.key, 'enabled']) : check(row.on)}
            </td>
            <td className={CS_TD_CARD}>
              {control ? control(['checks', row.key, 'severity']) : row.severity}
            </td>
            <td className={TD_NUM}>
              {control ? control(['checks', row.key, 'threshold']) : row.above}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface TablesProps {
  section: ApiAidRulesSection
  content: Record<string, unknown>
  approved: Record<string, unknown> | null
  names: RulesNames
  /** Equity's Show details: the read-only Reads column. */
  details: boolean
  /** income.dependents_mode, for the equity table's Dependents note; null when unknown. */
  dependentsMode: string | null
  /** In the editor: a box per editable cell (read-only columns never get one). */
  control?: CellControl | undefined
  /** Grants › Grantors with the view (owner 10-06 (c)): the named fund's row links there. It resolves once slice 3
   * ships the page, the same as History's links. */
  grantsHref?: string | undefined
}

/** A card's tables (spec §6.2 E), by section; the sections without a table draw nothing here. */
export function CardTables(props: TablesProps) {
  switch (props.section) {
    case 'equity':
      return <EquityTable {...props} />
    case 'awards':
      return <NamedAwardsTable {...props} />
    case 'quality_checks':
      return <ChecksTable {...props} />
    default:
      return null
  }
}
