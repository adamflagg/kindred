import type { ReactNode } from 'react'

export type SortDirection = 'ascending' | 'descending'

export interface SortableColumnHeaderProps {
  /** Visible column label. Also the accessible name of both the cell and the button. */
  label: string
  /** How this column is currently sorted; null when it is not the active sort column. */
  direction: SortDirection | null
  /** Fired on click, Enter and Space — a real <button> gives the latter two for free. */
  onSort: () => void
  /** Sort indicator rendered after the label, inside the button. Always aria-hidden.
   *  Defaults to a text arrow (↑ / ↓ / nothing). */
  indicator?: ReactNode
  /** Host element. 'th' inside a real <table>; 'div' for ARIA-grid surfaces. Default 'th'. */
  as?: 'th' | 'div'
  /** Classes on the host cell — grid sizing, responsive hiding, borders. */
  className?: string
  /** Classes on the inner button — padding, hover, focus ring. */
  buttonClassName?: string
}

/**
 * One sortable column header, shared by every sortable table/grid in the app.
 *
 * No aria-label. A `<th>` takes its accessible name from its contents, so an
 * aria-label on this button would rename the column itself and every data
 * cell would announce as "Sort by sleeps, 4". The button role is what makes
 * the control discoverable; issue #1897 attributed that to the aria-label,
 * which is where it was wrong.
 *
 * aria-sort is omitted, not "none", on inactive columns — matches the
 * WAI-ARIA APG sortable-table example; "none" is the implicit default and
 * conveys nothing.
 */
export function SortableColumnHeader({
  label,
  direction,
  onSort,
  indicator,
  as = 'th',
  className,
  buttonClassName,
}: SortableColumnHeaderProps) {
  const Host = as
  const defaultIndicator = direction === 'ascending' ? '↑' : direction === 'descending' ? '↓' : null

  return (
    <Host role="columnheader" aria-sort={direction ?? undefined} className={className}>
      <button
        type="button"
        onClick={onSort}
        className={`inline-flex w-full cursor-pointer items-center gap-1 bg-transparent text-left ${buttonClassName ?? ''}`}
      >
        {label}
        <span aria-hidden="true">{indicator ?? defaultIndicator}</span>
      </button>
    </Host>
  )
}
