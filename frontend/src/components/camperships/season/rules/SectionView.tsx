import type { ReactNode } from 'react'

import type { ApiAidFieldChange } from '../../../../types/api-types'
import { BINDING_TEXT } from '../../kit/kitStyles'
import { TD_LABEL, TH_LABEL } from '../seasonStyles'
import { formatSetting, isChanged, settingNodes, type SettingNode } from './rulesModel'

/** A setting the draft changed reads in amber (rules.html A), as a binding limit does on a receipt. */
const CHANGED = BINDING_TEXT

/** Draws one setting's figure; the editor passes its own, which puts a box where a figure can be typed. */
export type RenderSetting = (path: readonly string[], value: unknown) => ReactNode

interface TreeProps {
  readonly changes: readonly ApiAidFieldChange[]
  readonly renderValue: RenderSetting | undefined
}

function Value({
  value,
  path,
  changes,
  renderValue,
}: TreeProps & { value: unknown; path: readonly string[] }) {
  if (renderValue) return <>{renderValue(path, value)}</>
  return (
    <span className={isChanged(path, changes) ? CHANGED : undefined}>
      {formatSetting(value, path)}
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
          {node.children.map((child) => (
            <Node key={child.path.join('.')} node={child} {...tree} />
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-1 py-1">
      <div className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {node.label}
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={TH_LABEL} />
              {node.columns.map((column) => (
                <th key={column.key} className={TH_LABEL}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {node.rows.map((row) => (
              <tr key={row.key}>
                <td className={`${TD_LABEL} font-medium`}>{row.label}</td>
                {node.columns.map((column) => (
                  <td key={column.key} className={TD_LABEL}>
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
}: {
  content: Readonly<Record<string, unknown>>
  changes?: readonly ApiAidFieldChange[] | undefined
  renderValue?: RenderSetting | undefined
}) {
  return (
    <div className="text-sm">
      {settingNodes(content).map((node) => (
        <Node key={node.path.join('.')} node={node} changes={changes} renderValue={renderValue} />
      ))}
    </div>
  )
}
