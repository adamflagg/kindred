import type { ReactNode } from 'react'

import type { ApiAidFieldChange } from '../../../../types/api-types'
import { BINDING_TEXT } from '../../kit/kitStyles'
import { TD_LABEL, TH_LABEL } from '../seasonStyles'
import {
  formatSetting,
  isChanged,
  settingNodes,
  type RulesNames,
  type SettingNode,
} from './rulesModel'

/** A setting the draft changed reads in amber (rules.html A), as a binding limit does on a receipt. */
const CHANGED = BINDING_TEXT

/**
 * A settings table's headers and cells wrap (#28): a table of many settings (Awards' decision types)
 * would otherwise run past its panel at 1100 and 1440; a slightly narrower padding lets Stages' eleven
 * columns fit at 1100 too.
 */
const TH_SETTING = TH_LABEL.replace(' whitespace-nowrap', ' align-bottom').replace('px-2', 'px-1.5')
const TD_SETTING = TD_LABEL.replace(' whitespace-nowrap', '').replace('px-2', 'px-1.5')

/** Draws one setting's figure; the editor passes its own, which puts a box where a figure can be typed. */
export type RenderSetting = (path: readonly string[], value: unknown) => ReactNode

interface TreeProps {
  readonly changes: readonly ApiAidFieldChange[]
  readonly renderValue: RenderSetting | undefined
  readonly names: RulesNames | undefined
}

/**
 * In the read view, a label that only repeats the name its row or group already reads as (a pool's,
 * a program's, a decision type's own label) is left out. The editor keeps it: it is a box there.
 */
const repeatsName = (key: string, value: unknown, name: string) => key === 'label' && value === name

function Value({
  value,
  path,
  changes,
  renderValue,
  names,
}: TreeProps & { value: unknown; path: readonly string[] }) {
  if (renderValue) return <>{renderValue(path, value)}</>
  return (
    <span className={isChanged(path, changes) ? CHANGED : undefined}>
      {formatSetting(value, path, names)}
    </span>
  )
}

function Node({ node, ...tree }: TreeProps & { node: SettingNode }) {
  if (node.kind === 'leaf') {
    return (
      <div className="grid grid-cols-[minmax(0,16rem)_minmax(0,1fr)] items-center gap-3 py-0.5">
        <span className="text-muted-foreground">{node.label}</span>
        <Value value={node.value} path={node.path} {...tree} />
      </div>
    )
  }
  if (node.kind === 'group') {
    return (
      <div className="space-y-0.5 py-1">
        <div className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          {node.label}
        </div>
        <div className="border-border space-y-0.5 border-l pl-3">
          {node.children
            .filter(
              (child) =>
                tree.renderValue !== undefined ||
                child.kind !== 'leaf' ||
                !repeatsName(child.path.at(-1) ?? '', child.value, node.label)
            )
            .map((child) => (
              <Node key={child.path.join('.')} node={child} {...tree} />
            ))}
        </div>
      </div>
    )
  }
  const columns =
    tree.renderValue !== undefined
      ? node.columns
      : node.columns.filter(
          (column) =>
            !node.rows.every((row) => repeatsName(column.key, row.cells[column.key], row.label))
        )
  return (
    <div className="space-y-1 py-1">
      <div className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {node.label}
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={TH_SETTING} />
              {columns.map((column) => (
                <th key={column.key} className={TH_SETTING}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {node.rows.map((row) => (
              <tr key={row.key}>
                <td className={`${TD_SETTING} font-medium`}>{row.label}</td>
                {columns.map((column) => (
                  <td key={column.key} className={TD_SETTING}>
                    <Value
                      value={row.cells[column.key] ?? null}
                      path={[...node.path, row.key, column.key]}
                      {...tree}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * One rules section's settings (spec §7.5; D76: every section has a read-only view): lines, groups
 * and small tables, each figure as staff read it, a draft's changes in amber. The editor (D39) draws
 * the same layout with `renderValue`, so a section reads alike whether it is being read or edited.
 */
export function SectionView({
  content,
  changes = [],
  renderValue,
  names,
}: {
  content: Readonly<Record<string, unknown>>
  changes?: readonly ApiAidFieldChange[] | undefined
  renderValue?: RenderSetting | undefined
  /** The rules' own names for their keys (#15); without them a key reads as its words. */
  names?: RulesNames | undefined
}) {
  return (
    <div className="text-sm">
      {settingNodes(content, names).map((node) => (
        <Node
          key={node.path.join('.')}
          node={node}
          changes={changes}
          renderValue={renderValue}
          names={names}
        />
      ))}
    </div>
  )
}
