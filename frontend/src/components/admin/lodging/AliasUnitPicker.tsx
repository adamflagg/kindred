/**
 * Pick the unit(s) a cabin-name alias resolves to.
 *
 * Shared by the alias editor and the unresolved-name queue, which both used
 * to render every bookable unit (~100) as one flat wrap of checkboxes. Picks
 * sit as chips in the search field; the list drops down only while searching,
 * grouped by area and then by building, so a queue page of many rows stays
 * compact.
 *
 * What the old fieldset guarded still holds here: only bookable units are
 * offered, but a member the alias ALREADY names is always offered whatever its
 * state (eligibleAliasMembers), and a member from another season carries a
 * marker in its accessible name so it cannot be confused with its same-named
 * current-season twin — roll-forward copies `name` verbatim.
 */
import { Home, Search, X } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'

import { useClickOutside } from '../../../hooks/useClickOutside'
import type { LodgingUnitRecord } from '../../../types/lodging'
import { eligibleAliasMembers } from './aliasMembers'
import { GROUP_HEADING, MUTED_PILL, PILL } from './lodgingStyles'

export interface AliasUnitPickerProps {
  /** Candidate units: this season's list, plus any out-of-season members the alias names. */
  units: LodgingUnitRecord[]
  selected: string[]
  onChange: (ids: string[]) => void
  /** Units from another season, labelled so they are not mistaken for a current twin. */
  outOfSeasonIds?: ReadonlySet<string> | undefined
}

const DIFFERENT_SEASON = 'Different season'

type AreaEntry =
  | { kind: 'unit'; unit: LodgingUnitRecord }
  | { kind: 'building'; name: string; rooms: LodgingUnitRecord[] }

interface AreaGroup {
  name: string
  /** Top-level rooms, and buildings with the rooms under them, in list order. */
  entries: AreaEntry[]
}

export function AliasUnitPicker({
  units,
  selected,
  onChange,
  outOfSeasonIds,
}: AliasUnitPickerProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])
  useClickOutside(rootRef, close, open)

  const byId = useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units])
  const label = (unit: LodgingUnitRecord) =>
    outOfSeasonIds?.has(unit.id) ? `${unit.name} (different season)` : unit.name

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const result: AreaGroup[] = []
    for (const unit of eligibleAliasMembers(units, selected)) {
      const areaName = outOfSeasonIds?.has(unit.id)
        ? DIFFERENT_SEASON
        : (unit.expand?.area?.name ?? '')
      const building = unit.expand?.parent_unit?.name ?? ''
      if (needle && !`${areaName} ${building} ${unit.name}`.toLowerCase().includes(needle)) continue

      let group = result.find((g) => g.name === areaName)
      if (!group) result.push((group = { name: areaName, entries: [] }))
      if (building === '') {
        group.entries.push({ kind: 'unit', unit })
        continue
      }
      const existing = group.entries.find((e) => e.kind === 'building' && e.name === building)
      if (existing?.kind === 'building') existing.rooms.push(unit)
      else group.entries.push({ kind: 'building', name: building, rooms: [unit] })
    }
    return result
  }, [units, selected, query, outOfSeasonIds])

  // The query survives a tick: a merge is usually of same-named rooms, so one
  // search should serve every pick. Escape or clicking away still clears it.
  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((u) => u !== id) : [...selected, id])
    inputRef.current?.focus()
  }

  const renderOption = (unit: LodgingUnitRecord, indent: boolean) => {
    const checked = selected.includes(unit.id)
    return (
      <label
        key={unit.id}
        className={`hover:bg-primary/5 flex cursor-pointer items-center gap-2 py-1 pr-3 text-sm ${
          indent ? 'pl-7' : 'pl-3'
        } ${checked ? 'font-semibold' : ''}`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => {
            toggle(unit.id)
          }}
        />
        {label(unit)}
      </label>
    )
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-1.5">
      <div className="relative">
        <div
          className={`border-border bg-background flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border py-1 pr-2 pl-8 ${
            open ? 'ring-primary/50 ring-2' : ''
          }`}
        >
          <Search className="text-muted-foreground absolute top-2.5 left-2.5 h-3.5 w-3.5" />
          {selected.map((id) => {
            const unit = byId.get(id)
            const name = unit ? label(unit) : id
            const building = unit?.expand?.parent_unit?.name
            return (
              <span
                key={id}
                className={`bg-primary/10 text-primary border-primary/30 inline-flex items-center gap-0.5 border py-0.5 pr-1 pl-2.5 ${PILL}`}
              >
                {building && <span className="font-normal opacity-75">{building} ›&nbsp;</span>}
                {name}
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => {
                    toggle(id)
                  }}
                  className="hover:bg-primary/15 rounded-full p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )
          })}
          <input
            ref={inputRef}
            type="search"
            aria-label="Search units"
            value={query}
            placeholder={
              selected.length > 0
                ? 'Add another unit for a merge…'
                : 'Search units, buildings or areas…'
            }
            autoComplete="off"
            className="min-w-40 flex-1 bg-transparent py-1 text-sm focus:outline-none"
            onFocus={() => {
              setOpen(true)
            }}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              else if (e.key === 'Backspace' && query === '' && selected.length > 0) {
                onChange(selected.slice(0, -1))
              }
            }}
          />
        </div>

        {open && (
          <div className="border-border bg-card shadow-lodge absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border">
            {groups.length === 0 ? (
              <p className="text-muted-foreground p-3 text-xs">
                No bookable unit matches “{query.trim()}”.
              </p>
            ) : (
              groups.map((group) => {
                const picked = group.entries.reduce(
                  (n, e) =>
                    n +
                    (e.kind === 'unit'
                      ? Number(selected.includes(e.unit.id))
                      : e.rooms.filter((r) => selected.includes(r.id)).length),
                  0
                )
                return (
                  <div key={group.name} role="group" aria-label={group.name || 'No area'}>
                    <div
                      className={`bg-muted sticky top-0 flex justify-between px-3 py-1 ${GROUP_HEADING}`}
                    >
                      <span>{group.name || 'No area'}</span>
                      {picked > 0 && (
                        <span className="text-primary normal-case">{picked} picked</span>
                      )}
                    </div>
                    {group.entries.map((entry) =>
                      entry.kind === 'unit' ? (
                        renderOption(entry.unit, false)
                      ) : (
                        <div key={entry.name}>
                          <p className="text-muted-foreground flex items-center gap-1 px-3 pt-1 text-xs font-semibold">
                            <Home className="h-3 w-3" />
                            {entry.name}
                          </p>
                          {entry.rooms.map((room) => renderOption(room, true))}
                        </div>
                      )
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
      {selected.length > 0 && (
        <span className={`w-fit ${MUTED_PILL}`}>
          {selected.length > 1 ? `Merge of ${String(selected.length)} units` : 'Single unit'}
        </span>
      )}
    </div>
  )
}
