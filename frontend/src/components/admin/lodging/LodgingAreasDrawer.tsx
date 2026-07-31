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

  /**
   * Runs a write and reports whether it landed.
   *
   * The boolean is not decoration: the fields below are uncontrolled, so a
   * caller has to know a write failed in order to put the stored value back.
   */
  const run = async (action: () => Promise<unknown>, failure: string): Promise<boolean> => {
    try {
      await action()
      refresh()
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : failure)
      return false
    }
  }

  /**
   * Write an uncontrolled field, restoring the stored value if it is refused.
   *
   * `defaultValue` is read once on mount, and `refresh()` only runs on
   * success, so without this a rejected edit leaves the value PocketBase
   * refused sitting in the field — indistinguishable from a saved one, and
   * surviving every later refetch.
   */
  const saveField = async (
    field: HTMLInputElement,
    stored: string,
    action: () => Promise<unknown>,
    failure: string
  ) => {
    const ok = await run(action, failure)
    if (!ok) field.value = stored
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

  const saveCentroid = async (
    area: LodgingAreaRecord,
    axis: 'map_x' | 'map_y',
    field: HTMLInputElement
  ) => {
    const stored = String(area[axis])
    const value = Number.parseFloat(field.value)
    // Cleared or unparseable: skip the write, but put the stored value back.
    // Leaving the empty box is the same failure a rejected write would be —
    // the field disagrees with what is stored and survives every refetch —
    // and here it reads as "this area has no map position", a real state that
    // the later map view would render very differently.
    if (Number.isNaN(value)) {
      field.value = stored
      return
    }
    if (value === area[axis]) return
    await saveField(
      field,
      stored,
      () => updateLodgingArea(area.id, { [axis]: value }),
      'Failed to save the centroid'
    )
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
                        const field = e.target
                        void saveField(
                          field,
                          area.name,
                          () => updateLodgingArea(area.id, { name: field.value }),
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
                    onBlur={(e) => void saveCentroid(area, 'map_x', e.target)}
                  />
                  <input
                    className={`${FIELD} w-20`}
                    type="number"
                    step="0.001"
                    min={0}
                    max={1}
                    defaultValue={area.map_y}
                    aria-label={`${area.name} map Y`}
                    onBlur={(e) => void saveCentroid(area, 'map_y', e.target)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      // The units table never offers delete at all (spec §3.8).
                      // Areas must, since an area with no units is genuinely
                      // removable — but it sits one click from a numeric input
                      // and an empty area deletes silently and unrecoverably.
                      if (
                        !window.confirm(`Delete the area “${area.name}”? This cannot be undone.`)
                      ) {
                        return
                      }
                      void run(
                        () => deleteLodgingArea(area.id),
                        `Cannot delete ${area.name} while units still belong to it.`
                      )
                    }}
                    aria-label={`Delete ${area.name}`}
                    className={`text-muted-foreground hover:text-foreground ml-auto ${ACTION_LINK}`}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {/* Creating against an unloaded list is not merely useless, it is
              wrong: the next sort_order is derived from the ranks in use, and
              an empty list yields 1 — a rank an existing area already holds.
              So the control waits for the query rather than falling back. */}
          {areasQuery.isError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              The areas could not be loaded, so they cannot be edited right now.
            </p>
          )}

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
              disabled={draftName.trim() === '' || !areasQuery.isSuccess}
              onClick={() =>
                void run(async () => {
                  await createLodgingArea({
                    name: draftName.trim(),
                    // Codes are a back-end key; derive rather than ask.
                    code: slugify(draftName),
                    map_x: 0,
                    map_y: 0,
                    // From the highest rank in use, not the count: sort_order
                    // carries gaps as soon as an area is deleted, and
                    // `length + 1` then reissues a value another area already
                    // holds. groupUnitsByArea breaks that tie on insertion
                    // order, so the units table would stack two zones at one
                    // position.
                    sort_order: Math.max(0, ...areas.map((a) => a.sort_order)) + 1,
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
