import { SortableColumnHeader, type SortDirection } from '../ui/SortableColumnHeader'

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
  title,
  colSpan,
  rowSpan,
}: {
  readonly label: string
  readonly direction: SortDirection | null
  readonly onSort: () => void
  readonly align?: 'left' | 'right'
  readonly className?: string
  /** Replaces the default header look, for a matrix with its own cell styling. */
  readonly bare?: boolean
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
      title={title}
      colSpan={colSpan}
      rowSpan={rowSpan}
      className={
        bare
          ? className
          : `text-muted-foreground px-4 py-3 font-medium ${align === 'right' ? 'text-right' : 'text-left'} ${className}`
      }
      layoutClassName={`items-center gap-1 ${bare ? 'justify-center' : align === 'right' ? 'justify-end' : ''}`}
      buttonClassName="font-medium"
    />
  )
}
