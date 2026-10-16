import type { ReactNode } from 'react'
import { SortableColumnHeader, type SortDirection } from '../ui/SortableColumnHeader'

/** The button fills the cell, so the label's side is set on the button, not by the cell's text-align. */
const JUSTIFY = { left: 'justify-start', right: 'justify-end', center: 'justify-center' } as const

/**
 * A sortable column header for an Analytics table (#3207 PR 10): the shared SortableColumnHeader in the
 * metrics tables' header look, with a faint two-way arrow on every unsorted column so the headers read
 * as clickable without a hover (owner taste). The sorted column shows its direction.
 */
export function MetricSortHeader({
  label,
  direction,
  onSort,
  align = 'right',
  className = '',
  bare = false,
  labelSuffix,
  title,
  colSpan,
  rowSpan,
}: {
  readonly label: string
  readonly direction: SortDirection | null
  readonly onSort: () => void
  /** Which side the label sits, matching the column's cells; 'center' for a grouped band. */
  readonly align?: 'left' | 'right' | 'center'
  readonly className?: string
  /** Replaces the default header look, for a matrix with its own cell styling. */
  readonly bare?: boolean
  readonly labelSuffix?: ReactNode
  readonly title?: string
  readonly colSpan?: number
  readonly rowSpan?: number
}) {
  return (
    <SortableColumnHeader
      label={label}
      direction={direction}
      onSort={onSort}
      indicator={
        direction === null ? (
          <span className="opacity-40">↕</span>
        ) : direction === 'ascending' ? (
          '↑'
        ) : (
          '↓'
        )
      }
      labelSuffix={labelSuffix}
      title={title}
      colSpan={colSpan}
      rowSpan={rowSpan}
      className={
        bare ? className : `text-muted-foreground px-4 py-3 font-medium text-${align} ${className}`
      }
      layoutClassName={`items-center gap-1 ${JUSTIFY[align]}`}
      buttonClassName="font-medium"
    />
  )
}
