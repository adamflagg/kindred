/**
 * Areas, as a slide-in over the units table.
 *
 * Eight rows of name and order do not warrant a top-level tab — and areas
 * exist to serve Units, which is where staff already are. Codes are hidden
 * for the same reason unit codes are: they are a back-end join key, not
 * something staff think in.
 *
 * This used to also edit each area's map centroid as two bare number inputs
 * with nothing to compare them against — typing `0.4389` was never a usable
 * editing affordance (kindred#2397, following the same call `UnitMapPositionField`
 * already made for units in kindred#2013/#2024). `map_x`/`map_y` are still on
 * the collection and still read elsewhere; this removed one editing surface,
 * not the fields. A later phase may render the actual camp map and let a
 * centroid be dragged onto it the way `UnitMapPositionField` does for units —
 * that is what "is this family next to a bathhouse" (spec §7.2b) still needs.
 */
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { useState } from 'react'
import toast from 'react-hot-toast'

import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useLodgingAreas } from '../../../hooks/useLodgingAreas'
import {
  createLodgingArea,
  deleteLodgingArea,
  reorderLodgingAreas,
  updateLodgingArea,
} from '../../../services/lodgingCrud'
import { invalidateLodgingRegistryQueries } from '../../../utils/queryKeys'
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
  const { currentYear } = useCurrentYear()
  const [draftName, setDraftName] = useState('')

  // Not gated on `open`: LodgingUnitsPanel — this drawer's only mount point —
  // already calls useLodgingAreas() unconditionally to feed the units table's
  // grouping and the unit edit form's area picker, under this identical query
  // key. That call has already warmed the cache by the time a staffer opens
  // this drawer, so a per-drawer "while open" gate would never observably
  // defer a fetch; an earlier version of this hook carried one and it was
  // dead weight (kindred#2132). useLodgingAreas still gates on the year
  // itself: CurrentYearContext returns the literal 0 until the backend
  // supplies the configured year, and PocketBase answers `year = 0` with a
  // successful `200 []` rather than an error.
  const areasQuery = useLodgingAreas()

  const refresh = () => {
    invalidateLodgingRegistryQueries(queryClient)
  }

  const areas = areasQuery.items

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
                className="border-border hover:border-primary/50 flex items-center gap-2 rounded-lg border p-3 transition-colors"
              >
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
                <button
                  type="button"
                  onClick={() => {
                    // The units table never offers delete at all (spec §3.8).
                    // Areas must, since an area with no units is genuinely
                    // removable — and an empty area deletes silently and
                    // unrecoverably without this confirmation.
                    if (!window.confirm(`Delete the area “${area.name}”? This cannot be undone.`)) {
                      return
                    }
                    void run(
                      () => deleteLodgingArea(area.id),
                      `Cannot delete ${area.name} while units still belong to it.`
                    )
                  }}
                  aria-label={`Delete ${area.name}`}
                  className={`text-muted-foreground hover:text-foreground ${ACTION_LINK}`}
                >
                  Delete
                </button>
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
                    year: currentYear,
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
              <Plus className="h-4 w-4" />
              Add
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
