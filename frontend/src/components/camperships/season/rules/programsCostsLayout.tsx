/** Programs and costs' layout helpers (spec §5.2 F-G): the flow's items, the width hook, the row style. */
import { useCallback, useRef, useState, type ReactNode } from 'react'

import { SUBSECTION_LABELS, type CardRow } from './programsCostsModel'

export interface FlowItem {
  readonly key: string
  /** A label or the Per person column head: kept with the next line, and repeated "continued" atop a column. */
  readonly head: boolean
  readonly node: ReactNode
  readonly repeat?: ReactNode
}

/**
 * The width of the box its callback ref sits on, kept current (0 in jsdom). A callback ref, not an effect over a ref
 * object: the box can unmount while the editor is open and mount again after Cancel, and each mount is observed afresh.
 */
export function useBoxWidth(): [(box: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((box: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (box === null) return
    const read = () => setWidth(box.clientWidth)
    read()
    if (typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver(read)
    observer.current.observe(box)
  }, [])
  return [ref, width]
}

const LABEL = 'text-muted-foreground text-[11.5px] leading-5 font-bold'

/** A group's flow: its session-priced rows (a label above each sub-section when the group mixes them), then the Per person run. */
export function flowItems(
  rows: readonly CardRow[],
  subLabels: boolean,
  columnHead: ReactNode,
  render: (row: CardRow) => ReactNode
): FlowItem[] {
  const items: FlowItem[] = []
  const priced = rows.filter((r) => r.kind !== 'per_person')
  const perPerson = rows.filter((r) => r.kind === 'per_person')
  let last: string | null = null
  for (const row of priced) {
    if (subLabels && row.sub !== last) {
      last = row.sub
      const label = SUBSECTION_LABELS[row.sub]
      items.push({
        key: `sub:${row.sub}`,
        head: true,
        node: <div className={LABEL}>{label}</div>,
        repeat: (
          <div className={LABEL}>
            {label} <span className="font-normal">continued</span>
          </div>
        ),
      })
    }
    items.push({ key: `row:${String(row.session.cmId)}`, head: false, node: render(row) })
  }
  if (perPerson.length > 0) {
    items.push({ key: 'colhead', head: true, node: columnHead })
    for (const row of perPerson) {
      items.push({ key: `row:${String(row.session.cmId)}`, head: false, node: render(row) })
    }
  }
  return items
}

export const ROW =
  'flex items-baseline gap-2 border-b border-[color-mix(in_oklab,var(--border)_55%,transparent)] text-[13px] leading-5'
