/**
 * The units table's one sortable header.
 *
 * ONE shared thead, not one per area group. An earlier version rendered the
 * header inside each area's own table; with two or more areas expanded at once
 * (the default — nothing starts collapsed) that put multiple `columnheader`
 * elements with the same name in the DOM, which is ambiguous for both
 * assistive tech and `getByRole`. A single header over a `tbody` per area
 * keeps the sort control singular while each area still collapses on its own.
 */
import { SortableColumnHeader } from '../../ui/SortableColumnHeader'
import { HEADER_ROW } from './lodgingStyles'
import { UNIT_SORT_COLUMNS, type UnitSort } from './unitSort'

export interface UnitsTableHeaderProps {
  sort: UnitSort
  onToggleSort: (field: UnitSort['field']) => void
}

export function UnitsTableHeader({ sort, onToggleSort }: UnitsTableHeaderProps) {
  return (
    <thead>
      <tr className={HEADER_ROW}>
        <th className="pb-2" />
        {UNIT_SORT_COLUMNS.map((col) => (
          <SortableColumnHeader
            key={col.field}
            label={col.label}
            direction={sort.field === col.field ? (sort.desc ? 'descending' : 'ascending') : null}
            onSort={() => {
              onToggleSort(col.field)
            }}
            className="pr-3 pb-2"
            buttonClassName="hover:text-foreground focus-visible:ring-forest-500 select-none focus-visible:ring-2 focus-visible:outline-none"
          />
        ))}
        <th className="pb-2" />
      </tr>
    </thead>
  )
}
