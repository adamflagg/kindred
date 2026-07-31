/**
 * Areas, as a slide-in over the units table.
 *
 * Eight rows of name, order and map centroid do not warrant a top-level tab —
 * and areas exist to serve Units, which is where staff already are. Codes are
 * hidden for the same reason unit codes are: they are a back-end join key, not
 * something staff think in.
 *
 * The map centroid is not decorative. A later phase renders the actual camp
 * map from these coordinates, which is where "is this family next to a
 * bathhouse" gets answered (spec §7.2b).
 */
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { useState } from 'react'
import toast from 'react-hot-toast'

import {
  createLodgingArea,
  deleteLodgingArea,
  listLodgingAreas,
  reorderLodgingAreas,
  updateLodgingArea,
} from '../../../services/lodgingCrud'
import type { LodgingAreaRecord } from '../../../types/lodging'
import { queryKeys, userDataOptions } from '../../../utils/queryKeys'
import { ACTION_LINK, BUTTON_PRIMARY, FIELD_INLINE as FIELD, LABEL } from './lodgingStyles'

function slugify(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface LodgingAreasDrawerProps {
  open: boolean
  onClose: () => void
}

export function LodgingAreasDrawer({ open, onClose }: LodgingAreasDrawerProps) {
  const queryClient = useQueryClient()
  const [draftName, setDraftName] = useState('')

  const areasQuery = useQuery({
    queryKey: queryKeys.lodgingAreas(),
    ...userDataOptions,
    queryFn: listLodgingAreas,
    enabled: open,
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.lodgingAreas() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.lodgingUnits() })
  }

  const areas = areasQuery.data ?? []

  const run = async (action: () => Promise<unknown>, failure: string) => {
    try {
      await action()
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : failure)
    }
  }

  const move = async (index: number, delta: number) => {
    const next = [...areas]
    const item = next[index]
    const target = next[index + delta]
    if (!item || !target) return
    next[index] = target
    next[index + delta] = item
    await run(() => reorderLodgingAreas(next.map((a) => a.id)), 'Failed to reorder the areas')
  }

  const saveCentroid = async (area: LodgingAreaRecord, axis: 'map_x' | 'map_y', raw: string) => {
    const value = Number.parseFloat(raw)
    if (Number.isNaN(value) || value === area[axis]) return
    await run(() => updateLodgingArea(area.id, { [axis]: value }), 'Failed to save the centroid')
  }

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
        <DialogPanel className="bg-card flex w-screen max-w-md flex-col gap-4 overflow-y-auto p-6 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="font-display text-lg font-bold">Areas</DialogTitle>
              <p className="text-muted-foreground text-sm">
                The named zones of the site. Order sets how they stack on the units table.
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close areas">
              <X className="text-muted-foreground hover:text-foreground h-5 w-5" />
            </button>
          </div>

          <ul className="flex flex-col gap-3">
            {areas.map((area, index) => (
              <li
                key={area.id}
                className="border-border hover:border-primary/50 flex flex-col gap-2 rounded-lg border p-3 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <input
                    className={`${FIELD} flex-1`}
                    defaultValue={area.name}
                    aria-label={`${area.name} name`}
                    onBlur={(e) => {
                      if (e.target.value !== area.name) {
                        void run(
                          () => updateLodgingArea(area.id, { name: e.target.value }),
                          'Failed to rename the area'
                        )
                      }
                    }}
                  />
                  {index > 0 && (
                    <button
                      type="button"
                      aria-label={`Move ${area.name} up`}
                      onClick={() => void move(index, -1)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                  )}
                  {index < areas.length - 1 && (
                    <button
                      type="button"
                      aria-label={`Move ${area.name} down`}
                      onClick={() => void move(index, 1)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Map centre</span>
                  <input
                    className={`${FIELD} w-20`}
                    type="number"
                    step="0.001"
                    min={0}
                    max={1}
                    defaultValue={area.map_x}
                    aria-label={`${area.name} map X`}
                    onBlur={(e) => void saveCentroid(area, 'map_x', e.target.value)}
                  />
                  <input
                    className={`${FIELD} w-20`}
                    type="number"
                    step="0.001"
                    min={0}
                    max={1}
                    defaultValue={area.map_y}
                    aria-label={`${area.name} map Y`}
                    onBlur={(e) => void saveCentroid(area, 'map_y', e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void run(
                        () => deleteLodgingArea(area.id),
                        `Cannot delete ${area.name} while units still belong to it.`
                      )
                    }
                    aria-label={`Delete ${area.name}`}
                    className={`text-muted-foreground hover:text-foreground ml-auto ${ACTION_LINK}`}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="border-border flex items-end gap-2 border-t pt-4">
            <label className="flex-1 text-sm">
              <span className={LABEL}>New area</span>
              <input
                className={`${FIELD} w-full`}
                value={draftName}
                onChange={(e) => {
                  setDraftName(e.target.value)
                }}
              />
            </label>
            <button
              type="button"
              disabled={draftName.trim() === ''}
              onClick={() =>
                void run(async () => {
                  await createLodgingArea({
                    name: draftName.trim(),
                    // Codes are a back-end key; derive rather than ask.
                    code: slugify(draftName),
                    map_x: 0,
                    map_y: 0,
                    sort_order: areas.length + 1,
                  })
                  setDraftName('')
                }, 'Failed to create the area')
              }
              className={BUTTON_PRIMARY}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
