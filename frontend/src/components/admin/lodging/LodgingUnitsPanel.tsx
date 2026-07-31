/**
 * The unit list.
 *
 * Deactivate, never delete (spec §3.8): a unit with historical assignments
 * must stay resolvable so past placements still render. The Go guard in
 * pocketbase/lodging blocks a referenced unit's deletion anyway, but the UI
 * should not offer the action in the first place.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import toast from 'react-hot-toast'

import {
  deactivateLodgingUnit,
  listLodgingAreas,
  listLodgingUnits,
} from '../../../services/lodgingCrud'
import type { LodgingUnitRecord } from '../../../types/lodging'
import { queryKeys, userDataOptions } from '../../../utils/queryKeys'
import { QueryGuard } from '../../QueryGuard'
import { LodgingUnitForm } from './LodgingUnitForm'

const PILL = 'rounded-full px-2 py-0.5 text-xs'

export function LodgingUnitsPanel() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<LodgingUnitRecord | 'new' | null>(null)

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
    void queryClient.invalidateQueries({ queryKey: queryKeys.lodgingUnits() })
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
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          Every unit is editable. Amenity values seeded from historical occupancy stay marked
          unconfirmed until staff verify them — and the roster will not judge a family&apos;s
          housing need against an unconfirmed cabin.
        </p>
        <button
          type="button"
          onClick={() => {
            setEditing('new')
          }}
          className="bg-primary inline-flex flex-shrink-0 items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-white"
        >
          <Plus className="h-4 w-4" />
          New unit
        </button>
      </div>

      {editing !== null && (
        <div className="card-lodge p-4">
          <LodgingUnitForm
            areas={areasQuery.data ?? []}
            unit={editing === 'new' ? undefined : editing}
            onSaved={refresh}
            onCancel={() => {
              setEditing(null)
            }}
          />
        </div>
      )}

      <QueryGuard
        isLoading={unitsQuery.isLoading}
        error={unitsQuery.error}
        data={unitsQuery.data}
        label="lodging units"
        emptyMessage="No lodging units yet."
      >
        {(units) => (
          <div className="card-lodge overflow-x-auto p-4">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-border text-muted-foreground border-b text-xs uppercase">
                  <th className="pb-2">Unit</th>
                  <th className="pb-2">Code</th>
                  <th className="pb-2">Sleeps</th>
                  <th className="pb-2">Allocation</th>
                  <th className="pb-2">State</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {units.map((unit) => (
                  <tr key={unit.id} className="border-border/50 border-b">
                    <td className="py-2 font-medium">{unit.name}</td>
                    <td className="text-muted-foreground py-2">{unit.code}</td>
                    {/* 0 means UNKNOWN — PocketBase stores unset numbers as 0. */}
                    <td className="py-2">{unit.sleeps > 0 ? unit.sleeps : '—'}</td>
                    <td className="py-2">
                      {unit.allocation_default === 'staff_default' ? 'Staff' : 'Family pool'}
                    </td>
                    <td className="flex flex-wrap gap-1 py-2">
                      {unit.is_container && (
                        <span className={`bg-muted text-muted-foreground ${PILL}`}>Building</span>
                      )}
                      {!unit.is_active && (
                        <span className={`bg-muted text-muted-foreground ${PILL}`}>Inactive</span>
                      )}
                      {!unit.is_confirmed && (
                        <span
                          className={`bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 ${PILL}`}
                        >
                          Unconfirmed
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(unit)
                        }}
                        className="text-primary mr-3 text-xs font-medium hover:underline"
                      >
                        Edit
                      </button>
                      {unit.is_active && (
                        <button
                          type="button"
                          onClick={() => void handleDeactivate(unit)}
                          className="text-muted-foreground text-xs font-medium hover:underline"
                        >
                          Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryGuard>
    </div>
  )
}
