/**
 * One area's rows, under a collapsible heading.
 *
 * A `tbody` per area rather than a table per area: staff reason about the site
 * by zone and a flat 93-row list loses that, but the sort control has to stay
 * singular (see `UnitsTableHeader`). The chosen column sorts WITHIN the zone.
 */
import { ChevronDown, ChevronRight } from 'lucide-react'

import type { LodgingUnitRecord } from '../../../types/lodging'
import { GROUP_HEADING, MUTED_PILL } from './lodgingStyles'
import { LodgingUnitRow } from './LodgingUnitRow'
import { sortUnits, UNIT_SORT_COLUMNS, type AreaGroup, type UnitSort } from './unitSort'

export interface UnitAreaGroupProps {
  group: AreaGroup
  sort: UnitSort
  isCollapsed: boolean
  selected: Set<string>
  onToggleCollapse: (areaId: string, unitIds: string[]) => void
  onToggleSelect: (unitId: string) => void
  onEdit: (unit: LodgingUnitRecord) => void
  onConfirm: (unit: LodgingUnitRecord) => void
  onDeactivate: (unit: LodgingUnitRecord) => void
}

export function UnitAreaGroup({
  group,
  sort,
  isCollapsed,
  selected,
  onToggleCollapse,
  onToggleSelect,
  onEdit,
  onConfirm,
  onDeactivate,
}: UnitAreaGroupProps) {
  const rows = sortUnits(group.units, sort)
  const Chevron = isCollapsed ? ChevronRight : ChevronDown

  return (
    <tbody
      data-testid={`area-group-${group.areaId}`}
      className="border-border/50 border-b last:border-b-0"
    >
      <tr>
        <td colSpan={UNIT_SORT_COLUMNS.length + 2} className="p-0">
          <button
            type="button"
            // The chevron is aria-hidden, so this is the only signal that the
            // zone collapsed and its rows left the table.
            aria-expanded={!isCollapsed}
            onClick={() => {
              onToggleCollapse(
                group.areaId,
                group.units.map((u) => u.id)
              )
            }}
            className="hover:bg-muted/40 focus-visible:ring-forest-500 bg-muted/20 flex w-full items-center gap-2 px-1 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <Chevron className="text-muted-foreground h-4 w-4" aria-hidden="true" />
            {/* The roster's area headings, exactly: the unit name is what staff
                scan for, so the zone above it stays quieter than its rows. */}
            <span className={GROUP_HEADING}>{group.areaName}</span>
            <span className={`${MUTED_PILL} tabular-nums`}>{rows.length}</span>
          </button>
        </td>
      </tr>
      {!isCollapsed &&
        rows.map((unit) => (
          <LodgingUnitRow
            key={unit.id}
            unit={unit}
            isSelected={selected.has(unit.id)}
            onToggleSelect={() => {
              onToggleSelect(unit.id)
            }}
            onEdit={() => {
              onEdit(unit)
            }}
            onConfirm={() => {
              onConfirm(unit)
            }}
            onDeactivate={() => {
              onDeactivate(unit)
            }}
          />
        ))}
    </tbody>
  )
}
