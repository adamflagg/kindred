import type { ReactNode } from 'react'

import { DefRef } from '../../kit/DefinitionNotes'
import { CS_MUTED, CS_PANEL_HEAD, CS_SMALL } from '../../kit/csType'
import {
  dependentsNote,
  rowWords,
  type CardRow,
  type CardSpec,
  type ReadOnlyItem,
} from './rulesCards'
import type { RulesNames } from './rulesModel'

/** A value the draft changed (budget-v9's moved mark), beside "was ‹old›" in amber. */
const CHANGED =
  'rounded-sm bg-amber-100/75 shadow-[inset_0_-2px_0_var(--color-amber-500)] dark:bg-amber-900/55 dark:text-amber-100'

export function CardRows({
  spec,
  content,
  approved,
  names,
  control,
}: {
  spec: CardSpec
  content: Record<string, unknown>
  approved: Record<string, unknown> | null
  names: RulesNames
  /** In the editor: the box for an editable row. */
  control?: ((row: CardRow) => ReactNode) | undefined
}) {
  return (
    <div className="mt-1.5 space-y-2.5">
      {spec.groups.map((group, g) => (
        <div key={group.head ?? String(g)}>
          {/* rules-v3 .sgh: the group's head is cs-phead (muted, smaller), so groups don't run together. */}
          {group.head !== null && <div className={CS_PANEL_HEAD}>{group.head}</div>}
          <div>
            {group.rows.map((r) => {
              const { text, was } = rowWords(r, content, approved, names)
              const desc =
                r.path.at(-1) === 'per_dependent_reduction'
                  ? `${r.desc}${dependentsNote(content)}`
                  : r.desc
              return (
                // rules-v3 .srow: a 20px lead column (a yes/no row's mark) indents every label 26px; a hairline
                // divides the rows of a group.
                <div
                  key={r.path.join('.')}
                  data-card-row
                  className="border-border/65 grid grid-cols-[20px_minmax(0,1fr)] items-baseline gap-x-1.5 border-t py-1 first:border-t-0"
                >
                  <span>{r.type === 'bool' && control === undefined ? text : null}</span>
                  <div className="flex flex-wrap items-baseline gap-x-2.5">
                    <span className="font-semibold">{r.label}</span>
                    {control !== undefined ? (
                      control(r)
                    ) : r.type === 'bool' ? null : (
                      <span className={`tabular-nums ${was === null ? '' : CHANGED}`}>{text}</span>
                    )}
                    {was !== null && control === undefined && (
                      <span className="text-amber-700 dark:text-amber-400">{`was ${was}`}</span>
                    )}
                    {desc !== '' && <span className={CS_MUTED}>{desc}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/** The card's read-only settings (§6.2 D): one muted band; never a control, even while the card is edited. */
export function ReadOnlyStrip({
  items,
  content,
  names,
}: {
  items: readonly ReadOnlyItem[]
  content: Record<string, unknown>
  names: RulesNames
}) {
  return (
    <div
      data-testid="read-only-strip"
      className={`${CS_SMALL} bg-muted/40 mt-2 flex flex-wrap gap-x-4 rounded-md px-2 py-1`}
    >
      <span className="font-semibold">
        Read-only
        <DefRef n={4} />
      </span>
      {items.map((item) => {
        const { text } = rowWords(item, content, null, names)
        return item.type === 'bool' ? (
          <span key={item.path.join('.')}>
            {text} <span>{item.label}</span>
          </span>
        ) : (
          <span key={item.path.join('.')}>
            {item.label} <b className="text-foreground">{text}</b>
            {item.desc !== undefined && ` ${item.desc}`}
          </span>
        )
      })}
    </div>
  )
}
