/**
 * The unit list.
 *
 * Area is the outer ordering and each group collapses, because staff reason
 * about the site by zone and a flat 93-row table loses that. The chosen column
 * sorts within a zone (see ./unitSort).
 *
 * CONFIRMATION IS THE POINT OF THIS SCREEN. Every unit is seeded unconfirmed,
 * and the roster refuses to judge a family's housing need against an
 * unconfirmed cabin — on such a row `has_power: false` means "nobody has
 * said", not "there is no power". So confirming is available inline per row
 * and in bulk over a selection; it is never buried behind opening the form.
 *
 * Deactivate, never delete (spec §3.8). The Go guard in pocketbase/lodging
 * blocks deleting a referenced unit anyway, but the UI should not offer it.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Map, Plus } from 'lucide-react'
import { useState } from 'react'
import toast from 'react-hot-toast'

import {
  confirmLodgingUnits,
  deactivateLodgingUnit,
  listLodgingAreas,
  listLodgingUnits,
} from '../../../services/lodgingCrud'
import type { LodgingUnitRecord } from '../../../types/lodging'
import { queryKeys, userDataOptions } from '../../../utils/queryKeys'
import { QueryGuard } from '../../QueryGuard'
import { LodgingAreasDrawer } from './LodgingAreasDrawer'
import { LodgingUnitForm } from './LodgingUnitForm'
import { LodgingUnitRow } from './LodgingUnitRow'
import { groupUnitsByArea, sortUnits, UNIT_SORT_COLUMNS, type UnitSort } from './unitSort'

export function LodgingUnitsPanel() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<LodgingUnitRecord | 'new' | null>(null)
  const [areasOpen, setAreasOpen] = useState(false)
  const [sort, setSort] = useState<UnitSort>({ field: 'name', desc: false })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const unitsQuery = useQuery({
    queryKey: queryKeys.lodgingUnits(),
    ...userDataOptions,
    queryFn: listLodgingUnits,
  })
  const areasQuery = useQuery({
    queryKey: queryKeys.lodgingAreas(),
    ...userDataOptions,
    queryFn: listLodgingAreas,
  })

  const refresh = () => {
    setEditing(null)
    setSelected(new Set())
    void queryClient.invalidateQueries({ queryKey: queryKeys.lodgingUnits() })
  }

  const toggleSort = (field: UnitSort['field']) => {
    setSort((current) =>
      current.field === field ? { field, desc: !current.desc } : { field, desc: false }
    )
  }

  const toggleIn = (set: Set<string>, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  /**
   * Collapsing a group drops its units from the selection.
   *
   * The bulk bar's only subject is what staff can see. Left selected, a
   * collapsed group would keep feeding "Confirm N selected" with rows that are
   * no longer on screen — a bulk write whose targets nobody can check. The
   * selection does not come back on expand: re-selecting rows staff last saw
   * minutes ago would be the same surprise in the other direction.
   */
  const toggleGroup = (areaId: string, unitIds: string[]) => {
    const collapsing = !collapsed.has(areaId)
    setCollapsed((c) => toggleIn(c, areaId))
    if (!collapsing) return
    setSelected((current) => {
      if (!unitIds.some((id) => current.has(id))) return current
      const next = new Set(current)
      for (const id of unitIds) next.delete(id)
      return next
    })
  }

  const handleConfirm = async (ids: string[]) => {
    try {
      const count = await confirmLodgingUnits(ids)
      if (count < ids.length) {
        toast.error(`Confirmed ${String(count)} of ${String(ids.length)} — the rest failed.`)
      } else {
        toast.success(count === 1 ? 'Unit confirmed' : `${String(count)} units confirmed`)
      }
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to confirm')
    }
  }

  const handleDeactivate = async (unit: LodgingUnitRecord) => {
    try {
      await deactivateLodgingUnit(unit.id)
      toast.success(`${unit.name} deactivated`)
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to deactivate the unit')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground max-w-2xl text-sm">
          Amenity values seeded from historical occupancy stay marked unconfirmed until staff verify
          them — and the roster will not judge a family&apos;s housing need against an unconfirmed
          cabin.
        </p>
        <div className="flex flex-shrink-0 gap-2">
          <button
            type="button"
            onClick={() => {
              setAreasOpen(true)
            }}
            className="border-border inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium"
          >
            <Map className="h-4 w-4" />
            Areas
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing('new')
            }}
            className="bg-primary inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-white"
          >
            <Plus className="h-4 w-4" />
            New unit
          </button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="border-forest-300 bg-forest-50 dark:border-forest-800 dark:bg-forest-950/40 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <button
            type="button"
            onClick={() => void handleConfirm([...selected])}
            className="bg-primary rounded-md px-3 py-1.5 text-sm font-medium text-white"
          >
            Confirm {selected.size} selected
          </button>
          <button
            type="button"
            onClick={() => {
              setSelected(new Set())
            }}
            className="text-muted-foreground text-sm font-medium hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      {editing !== null && (
        <div className="card-lodge p-4">
          <LodgingUnitForm
            areas={areasQuery.data ?? []}
            units={unitsQuery.data ?? []}
            unit={editing === 'new' ? undefined : editing}
            onSaved={refresh}
            onCancel={() => {
              setEditing(null)
            }}
          />
        </div>
      )}

      <LodgingAreasDrawer
        open={areasOpen}
        onClose={() => {
          setAreasOpen(false)
        }}
      />

      <QueryGuard
        isLoading={unitsQuery.isLoading}
        error={unitsQuery.error}
        data={unitsQuery.data}
        label="lodging units"
        emptyMessage="No lodging units yet."
      >
        {(units) =>
          units.length === 0 ? (
            // QueryGuard's emptyMessage only fires on `!data`; an empty array is
            // truthy and would otherwise render a headers-only table.
            <p className="text-muted-foreground py-12 text-center text-sm">No lodging units yet.</p>
          ) : (
            <div className="card-lodge overflow-x-auto p-4">
              <table className="w-full text-left text-sm">
                {/*
                  ONE shared thead, not one per area group. An earlier version
                  rendered the header inside each area's own table; with two
                  or more areas expanded at once (the default — nothing starts
                  collapsed) that put multiple `columnheader`-role elements
                  with the same name in the DOM, which is ambiguous for both
                  assistive tech and `getByRole`. A single header with a
                  `tbody` per area group keeps the sort control singular while
                  each area still collapses independently.
                */}
                <thead>
                  <tr className="border-border text-muted-foreground border-b text-xs uppercase">
                    <th className="pb-2" />
                    {UNIT_SORT_COLUMNS.map((col) => {
                      const isActive = sort.field === col.field
                      return (
                        <th
                          key={col.field}
                          role="columnheader"
                          tabIndex={0}
                          aria-sort={
                            isActive ? (sort.desc ? 'descending' : 'ascending') : undefined
                          }
                          onClick={() => {
                            toggleSort(col.field)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              toggleSort(col.field)
                            }
                          }}
                          className="hover:text-foreground focus-visible:ring-forest-500 cursor-pointer pr-3 pb-2 select-none focus-visible:ring-2 focus-visible:outline-none"
                        >
                          {col.label}
                          {isActive && (sort.desc ? ' ↓' : ' ↑')}
                        </th>
                      )
                    })}
                    <th className="pb-2" />
                  </tr>
                </thead>
                {groupUnitsByArea(units, areasQuery.data ?? []).map((group) => {
                  const isCollapsed = collapsed.has(group.areaId)
                  const rows = sortUnits(group.units, sort)
                  return (
                    <tbody
                      key={group.areaId}
                      data-testid={`area-group-${group.areaId}`}
                      className="border-border/50 border-b last:border-b-0"
                    >
                      <tr>
                        <td colSpan={UNIT_SORT_COLUMNS.length + 2} className="p-0">
                          <button
                            type="button"
                            onClick={() => {
                              toggleGroup(
                                group.areaId,
                                group.units.map((u) => u.id)
                              )
                            }}
                            className="hover:bg-muted/40 flex w-full items-center gap-2 py-2 text-left transition-colors"
                          >
                            {isCollapsed ? (
                              <ChevronRight className="text-muted-foreground h-4 w-4" />
                            ) : (
                              <ChevronDown className="text-muted-foreground h-4 w-4" />
                            )}
                            <span className="font-display text-sm font-semibold">
                              {group.areaName}
                            </span>
                            <span className="text-muted-foreground text-xs">{rows.length}</span>
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
                              setSelected((s) => toggleIn(s, unit.id))
                            }}
                            onEdit={() => {
                              setEditing(unit)
                            }}
                            onConfirm={() => void handleConfirm([unit.id])}
                            onDeactivate={() => void handleDeactivate(unit)}
                          />
                        ))}
                    </tbody>
                  )
                })}
              </table>
            </div>
          )
        }
      </QueryGuard>
    </div>
  )
}
