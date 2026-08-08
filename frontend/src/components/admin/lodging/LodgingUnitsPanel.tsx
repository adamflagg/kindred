/**
 * The unit list.
 *
 * Area is the outer ordering and each group collapses, because staff reason
 * about the site by zone and a flat 93-row table loses that. The chosen column
 * sorts within a zone (see ./unitSort).
 *
 * CONFIRMATION IS THE POINT OF THIS SCREEN. Every unit is seeded unconfirmed
 * the first time it is created, and `is_confirmed` now carries forward on a
 * season roll (see SeasonRollForwardPanel) — so "unconfirmed" holds until
 * someone unconfirms it, not forever. The roster still refuses to judge a
 * family's housing need against an unconfirmed cabin — on such a row
 * `has_power: false` means "nobody has said", not "there is no power". So
 * confirming is available inline per row and in bulk over a selection; it is
 * never buried behind opening the form.
 *
 * Deactivate, never delete (spec §3.8). The Go guard in pocketbase/lodging
 * blocks deleting a referenced unit anyway, but the UI should not offer it.
 */
import { useQueryClient } from '@tanstack/react-query'
import { Home, Map, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router'

import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useLodgingAreas } from '../../../hooks/useLodgingAreas'
import { useLodgingUnits } from '../../../hooks/useLodgingUnits'
import { confirmLodgingUnits, deactivateLodgingUnit } from '../../../services/lodgingCrud'
import type { LodgingUnitRecord } from '../../../types/lodging'
import { invalidateLodgingRegistryQueries } from '../../../utils/queryKeys'
import { QueryGuard } from '../../QueryGuard'
import { Modal } from '../../ui/Modal'
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from './lodgingStyles'
import { LodgingAreasDrawer } from './LodgingAreasDrawer'
import { LodgingUnitForm } from './LodgingUnitForm'
import { UnitAreaGroup } from './UnitAreaGroup'
import { UnitBulkBar } from './UnitBulkBar'
import { UnitsTableHeader } from './UnitsTableHeader'
import { groupUnitsByArea, type UnitSort } from './unitSort'

export function LodgingUnitsPanel() {
  const queryClient = useQueryClient()
  const { currentYear } = useCurrentYear()
  const [editing, setEditing] = useState<LodgingUnitRecord | 'new' | null>(null)
  const [areasOpen, setAreasOpen] = useState(false)
  const [sort, setSort] = useState<UnitSort>({ field: 'name', desc: false })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const formRef = useRef<HTMLDivElement>(null)

  // RENDER guard only, not a fetch gate. useLodgingUnits / useLodgingAreas
  // each gate their own fetch on year-readiness internally — currentYear > 0
  // is not passed to either call below — so this constant does not control
  // when they fetch, only when they render. It is still needed for that: a
  // disabled TanStack query is `isLoading === false` (pending but idle --
  // nothing is fetching) with `data === undefined`, which is indistinguishable
  // from a settled empty result to every consumer below. CurrentYearContext
  // returns the literal 0 until the backend supplies the configured year, and
  // PocketBase answers `year = 0` with a successful `200 []` rather than an
  // error — this guard is what keeps that from rendering as genuinely empty.
  const yearReady = currentYear > 0

  const unitsQuery = useLodgingUnits()
  const areasQuery = useLodgingAreas()

  /**
   * Move FOCUS to the editor whenever it opens — including switching straight
   * from editing one unit to another, since the form never unmounts in between
   * (see the `key` below).
   *
   * This used to scroll as well, because the editor mounted above a 93-row
   * table and opening it otherwise produced no visible change below the fold —
   * and the natural response, clicking Edit again or on a different row, is
   * exactly how a stale-record write went unnoticed. The dialog solves that
   * outright: it is unmissable without moving anything, so the staffer keeps
   * their place in the list. Only the focus half is still needed, and the
   * shared Modal does not set initial focus itself.
   *
   * `areasQuery.isSuccess` IS A DEPENDENCY, not a stray one — and it is why
   * this effect sits BELOW the query rather than up with the other state. The
   * form is gated on that flag: until the areas resolve, the dialog holds the
   * "Loading areas…" paragraph and there is nothing to focus. Opening the
   * editor during a slow areas fetch therefore runs this effect against an
   * empty dialog, and keyed on `[editing]` alone it would never re-run once
   * the real form mounts — leaving focus on the trigger behind the backdrop,
   * which for an aria-modal dialog strands a keyboard or screen-reader user
   * outside it entirely. Only the success branch renders anything focusable
   * (the error branch is a message paragraph), so this one flag covers it.
   */
  useEffect(() => {
    if (editing === null) return
    formRef.current?.querySelector<HTMLElement>('input, select, textarea')?.focus()
  }, [editing, areasQuery.isSuccess])

  const refresh = () => {
    setEditing(null)
    setSelected(new Set())
    invalidateLodgingRegistryQueries(queryClient)
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

      {/* A DIALOG, not a panel above the table. The editor used to mount at the
          top of a 93-row list and scroll the staffer to it, which lost their
          place in the list every time they corrected one row. Header, borders
          and shell follow ScenarioManagementModal so the admin surface reads as
          one product; `xl` rather than its `lg` only because this form is a
          two-column grid that `lg` would collapse. */}
      {editing !== null && (
        <Modal
          isOpen
          onClose={() => {
            setEditing(null)
          }}
          header={
            /* The forest band from the sessions landing header, same tokens and
               same shape: dark gradient, amber glyph in a translucent chip,
               white display title over a forest-200 subtitle. A staffer opening
               this from the units table should recognise it as the same product
               they run a summer session from. */
            <div className="from-forest-700 to-forest-800 bg-gradient-to-r px-6 py-5 pr-14">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-white/10 p-2">
                  <Home className="h-6 w-6 text-amber-400" aria-hidden="true" />
                </div>
                <div>
                  {/* Named, and the id is threaded to Modal's ariaLabelledBy:
                      Modal only falls back to its own `modal-title` in SIMPLE
                      TITLE mode, so a custom header without this leaves the
                      dialog with no accessible name at all. */}
                  <h2
                    id="lodging-unit-dialog-title"
                    className="font-display text-xl font-bold text-white"
                  >
                    {editing === 'new' ? 'Add a unit' : editing.name}
                  </h2>
                  {/* The area, because the row it came from is now behind a
                      backdrop and "which Tioga is this" is the first question. */}
                  <p className="text-forest-200 text-sm">
                    {editing === 'new'
                      ? 'A cabin, tent, yurt or room'
                      : (areasQuery.items.find((a) => a.id === editing.area)?.name ?? 'No area')}
                  </p>
                </div>
              </div>
            </div>
          }
          size="xl"
          noPadding
          scrollable
          headerOnDark
          ariaLabelledBy="lodging-unit-dialog-title"
        >
          <div ref={formRef} className="p-6">
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
                areas={areasQuery.items}
                units={unitsQuery.items}
                unit={editing === 'new' ? undefined : editing}
                year={currentYear}
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
        </Modal>
      )}

      <LodgingAreasDrawer
        open={areasOpen}
        onClose={() => {
          setAreasOpen(false)
        }}
      />

      <QueryGuard
        isLoading={unitsQuery.isLoading || !yearReady}
        error={unitsQuery.error}
        // Deliberately `.data`, not `.items` — QueryGuard's empty-vs-loading
        // branch below keys on `!data`. `.items` coerces to `[]` while
        // pending, which reads to QueryGuard as a settled empty result and
        // would swap "still loading" for "No lodging units yet." See the
        // warning on `UseLodgingUnitsResult.data` in useLodgingUnits.ts.
        data={unitsQuery.data}
        label="lodging units"
        emptyMessage="No lodging units yet."
      >
        {(units) =>
          units.length === 0 ? (
            // QueryGuard's emptyMessage only fires on `!data`; an empty array is
            // truthy and would otherwise render a headers-only table. An
            // un-rolled year seeds no rows at all, so the fix belongs one
            // click away rather than left for staff to discover.
            <p className="text-muted-foreground py-12 text-center text-sm">
              No lodging units for this season yet. Carry them forward from last year under{' '}
              <Link to="/manage/lodging/season" className="text-primary hover:underline">
                Season
              </Link>
              .
            </p>
          ) : (
            <div className="card-lodge overflow-x-auto p-4">
              <table className="w-full text-left text-sm">
                <UnitsTableHeader sort={sort} onToggleSort={toggleSort} />
                {groupUnitsByArea(units, areasQuery.items).map((group) => (
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
