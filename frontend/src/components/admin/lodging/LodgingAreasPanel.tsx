/**
 * Areas: the named zones of the site. Add, rename, and reorder them.
 *
 * The list itself is deliberately not enumerated anywhere in source (spec
 * §3.8) — it is rows, seeded from the camp map and corrected here.
 *
 * Deleting an area that still has units is refused by PocketBase with HTTP
 * 400: `lodging_units.area` is a REQUIRED relation, and PocketBase blocks
 * deleting behind one rather than clearing the reference. We surface that
 * error rather than pre-checking, so the DB stays the single source of truth.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import toast from 'react-hot-toast'

import {
  createLodgingArea,
  deleteLodgingArea,
  listLodgingAreas,
  updateLodgingArea,
} from '../../../services/lodgingCrud'
import type { LodgingAreaRecord } from '../../../types/lodging'
import { queryKeys, userDataOptions } from '../../../utils/queryKeys'
import { QueryGuard } from '../../QueryGuard'

const FIELD = 'border-border bg-background w-full rounded-md border px-2 py-1 text-sm'
const LABEL = 'text-muted-foreground mb-1 block text-xs font-medium'

export function LodgingAreasPanel() {
  const queryClient = useQueryClient()
  const [draftName, setDraftName] = useState('')
  const [draftCode, setDraftCode] = useState('')

  const areasQuery = useQuery({
    queryKey: queryKeys.lodgingAreas(),
    ...userDataOptions,
    queryFn: listLodgingAreas,
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.lodgingAreas() })
  }

  const handleCreate = async () => {
    try {
      await createLodgingArea({
        name: draftName,
        code: draftCode,
        map_x: 0,
        map_y: 0,
        sort_order: (areasQuery.data?.length ?? 0) + 1,
      })
      setDraftName('')
      setDraftCode('')
      toast.success('Area created')
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create the area')
    }
  }

  const handleRename = async (area: LodgingAreaRecord, name: string) => {
    try {
      await updateLodgingArea(area.id, { name })
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to rename the area')
    }
  }

  const handleDelete = async (area: LodgingAreaRecord) => {
    try {
      await deleteLodgingArea(area.id)
      toast.success(`${area.name} deleted`)
      refresh()
    } catch {
      toast.error(`Cannot delete ${area.name} while units still belong to it.`)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card-lodge flex flex-wrap items-end gap-2 p-4">
        <label className="text-sm">
          <span className={LABEL}>Name</span>
          <input
            className={FIELD}
            value={draftName}
            onChange={(e) => {
              setDraftName(e.target.value)
            }}
          />
        </label>
        <label className="text-sm">
          <span className={LABEL}>Code</span>
          <input
            className={FIELD}
            value={draftCode}
            onChange={(e) => {
              setDraftCode(e.target.value)
            }}
          />
        </label>
        <button
          type="button"
          disabled={draftName === '' || draftCode === ''}
          onClick={() => void handleCreate()}
          className="bg-primary inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Add area
        </button>
      </div>

      <QueryGuard
        isLoading={areasQuery.isLoading}
        error={areasQuery.error}
        data={areasQuery.data}
        label="lodging areas"
        emptyMessage="No areas yet."
      >
        {(areas) =>
          areas.length === 0 ? (
            // QueryGuard's emptyMessage only fires on `!data`; an empty array is
            // truthy and would otherwise render an empty card.
            <p className="text-muted-foreground py-12 text-center text-sm">No areas yet.</p>
          ) : (
            <ul className="card-lodge flex flex-col gap-2 p-4">
              {areas.map((area) => (
                <li key={area.id} className="flex flex-wrap items-center gap-2">
                  <input
                    className={`${FIELD} max-w-64`}
                    defaultValue={area.name}
                    aria-label={`Name of ${area.code}`}
                    onBlur={(e) => {
                      if (e.target.value !== area.name) void handleRename(area, e.target.value)
                    }}
                  />
                  <span className="text-muted-foreground text-xs">{area.code}</span>
                  <button
                    type="button"
                    onClick={() => void handleDelete(area)}
                    className="text-muted-foreground ml-auto text-xs font-medium hover:underline"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )
        }
      </QueryGuard>
    </div>
  )
}
