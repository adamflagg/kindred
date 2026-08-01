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
import { Map, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from './lodgingStyles'
import { LodgingAreasDrawer } from './LodgingAreasDrawer'
import { LodgingUnitForm } from './LodgingUnitForm'
import { UnitAreaGroup } from './UnitAreaGroup'
import { UnitBulkBar } from './UnitBulkBar'
import { UnitsTableHeader } from './UnitsTableHeader'
import { groupUnitsByArea, type UnitSort } from './unitSort'

export function LodgingUnitsPanel() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<LodgingUnitRecord | 'new' | null>(null)
  const [areasOpen, setAreasOpen] = useState(false)
  const [sort, setSort] = useState<UnitSort>({ field: 'name', desc: false })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const formRef = useRef<HTMLDivElement>(null)

  /**
   * Move attention to the editor whenever it opens — including switching
   * straight from editing one unit to another, since the form never
   * unmounts in between (see the `key` below). Without this, opening the
   * form on a 93-row table produces no visible change below the fold, and
   * the natural response — clicking Edit again, or on a different row — is
   * exactly how a stale-record write would go unnoticed.
   */
  useEffect(() => {
    if (editing === null) return
    formRef.current?.scrollIntoView({ block: 'nearest' })
    formRef.current?.querySelector<HTMLElement>('input, select, textarea')?.focus()
  }, [editing])

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
    // A parent_unit / is_container change drains or opens illegal-merge rows
    // via recheckIllegalMerges (pocketbase/lodging/hooks.go), but that hook
    // rewrites the DATABASE row — it does not touch this browser's cache. The
    // merge-repair panel reads lodging_ingest_issues under its own cache key,
    // so without this a fixed row would still show open here for up to
    // staleTime, or until an unrelated window blur/refocus.
    void queryClient.invalidateQueries({ queryKey: queryKeys.lodgingIllegalMergeIssues() })
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
    // The floating bulk bar sits over the table, so a selection buys the last
    // rows enough clearance to still reach their own actions.
    <div className={`flex flex-col gap-4 ${selected.size > 0 ? 'pb-20' : ''}`}>
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
            className={BUTTON_SECONDARY}
          >
            <Map className="h-4 w-4" aria-hidden="true" />
            Areas
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing('new')
            }}
            className={BUTTON_PRIMARY}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New unit
          </button>
        </div>
      </div>

      {/* Collapsing an area drops its units from the selection, so the count
          here only ever covers rows still visible. */}
      {selected.size > 0 && (
        <UnitBulkBar
          count={selected.size}
          onConfirm={() => void handleConfirm([...selected])}
          onClear={() => {
            setSelected(new Set())
          }}
        />
      )}

      {/* groupUnitsByArea buckets an unknown area under "No area" by design,
          so a unit whose area was deleted stays visible. That is precisely
          what makes a FAILED areas fetch dangerous: every unit collapses into
          one unnamed group, which reads as data loss rather than as a fetch
          that failed. The rows stay — only the grouping is untrustworthy. */}
      {areasQuery.isError && (
        <p className="text-sm text-red-600 dark:text-red-400">
          The areas could not be loaded, so these units are not grouped by zone and no unit can be
          edited.
        </p>
      )}

      {editing !== null && (
        <div ref={formRef} className="card-lodge p-4">
          {/* Area is a required relation with no blank option, so a form
              opened against an empty area list can only end in a server
              rejection the staffer reads as their own mistake. */}
          {areasQuery.isSuccess ? (
            /* Keyed on the record so React remounts rather than reusing the
               same instance — otherwise the form's useState initialisers
               never re-run when `unit` changes, and a submit after switching
               records writes the PREVIOUS unit's fields to the new one. */
            <LodgingUnitForm
              key={editing === 'new' ? 'new' : editing.id}
              areas={areasQuery.data}
              units={unitsQuery.data ?? []}
              unit={editing === 'new' ? undefined : editing}
              onSaved={refresh}
              onCancel={() => {
                setEditing(null)
              }}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              {areasQuery.isError
                ? 'The areas could not be loaded, so a unit cannot be edited right now.'
                : 'Loading areas…'}
            </p>
          )}
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
                <UnitsTableHeader sort={sort} onToggleSort={toggleSort} />
                {groupUnitsByArea(units, areasQuery.data ?? []).map((group) => (
                  <UnitAreaGroup
                    key={group.areaId}
                    group={group}
                    sort={sort}
                    isCollapsed={collapsed.has(group.areaId)}
                    selected={selected}
                    onToggleCollapse={toggleGroup}
                    onToggleSelect={(unitId) => {
                      setSelected((s) => toggleIn(s, unitId))
                    }}
                    onEdit={setEditing}
                    onConfirm={(unit) => void handleConfirm([unit.id])}
                    onDeactivate={(unit) => void handleDeactivate(unit)}
                  />
                ))}
              </table>
            </div>
          )
        }
      </QueryGuard>
    </div>
  )
}
