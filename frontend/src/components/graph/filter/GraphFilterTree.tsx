/**
 * GraphFilterTree — nested tree picker (locked design 2026-04-30, Option 4).
 *
 * Layout per row:
 *   [caret] [☐ checkbox] Name             [count or pill]
 *
 *   - Click checkbox or label → toggle (calls onAdd/onRemove for unit or bunk)
 *   - Click caret → expand/collapse (no selection side effect)
 *   - Selecting a unit disables/greys child checkboxes (showing "Included" pill)
 *   - Bunks indented (ml-9) without a treeline guide
 *   - Search filters across both unit names and bunk names; matching bunk
 *     names auto-expand their parent unit
 *
 * Stateless except for expansion state and search query — selection is driven
 * by the parent via `selectedUnits` / `selectedBunks` props.
 */
import { useMemo, useState } from 'react'
import { ChevronRight, X } from 'lucide-react'
import clsx from 'clsx'
import { UNIT_NAMES, getUnitForBunk } from '../../../utils/unitMapping'
import { bunkToCode, type BunkSummary } from '../graphFilter'

export interface GraphFilterTreeProps {
  selectedUnits: string[]
  selectedBunks: string[]
  allBunks: BunkSummary[]
  onAddUnit: (unit: string) => void
  onRemoveUnit: (unit: string) => void
  onAddBunk: (code: string) => void
  onRemoveBunk: (code: string) => void
  onClear: () => void
  /** When true (gender mode), unit rows become non-selectable headers — no
   *  unit checkbox or selection pill is rendered. Only bunk-level and chip-rail
   *  interactions remain active. */
  disableUnitSelect?: boolean
}

interface UnitGroup {
  name: string
  bunks: BunkSummary[]
}

function groupBunksByUnit(allBunks: BunkSummary[]): UnitGroup[] {
  const buckets = new Map<string, BunkSummary[]>()
  for (const bunk of allBunks) {
    const unit = getUnitForBunk(bunk.name)
    if (!unit) continue
    if (!buckets.has(unit)) buckets.set(unit, [])
    buckets.get(unit)!.push(bunk)
  }
  // Render units in canonical age order, only those present in the roster.
  return UNIT_NAMES.filter((name) => buckets.has(name)).map((name) => ({
    name,
    bunks: buckets.get(name)!,
  }))
}

function matchesSearch(query: string, text: string): boolean {
  if (!query) return true
  return text.toLowerCase().includes(query.toLowerCase().trim())
}

export default function GraphFilterTree({
  selectedUnits,
  selectedBunks,
  allBunks,
  onAddUnit,
  onRemoveUnit,
  onAddBunk,
  onRemoveBunk,
  onClear,
  disableUnitSelect = false,
}: GraphFilterTreeProps) {
  const groups = useMemo(() => groupBunksByUnit(allBunks), [allBunks])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [search, setSearch] = useState('')

  const selectedUnitSet = useMemo(() => new Set(selectedUnits), [selectedUnits])
  const selectedBunkSet = useMemo(
    () => new Set(selectedBunks.map((c) => c.toLowerCase())),
    [selectedBunks]
  )

  const isFilterActive = selectedUnits.length > 0 || selectedBunks.length > 0

  // Search auto-expands units whose bunks contain a match
  const searchExpandedSet = useMemo(() => {
    if (!search.trim()) return new Set<string>()
    const result = new Set<string>()
    for (const group of groups) {
      const hasBunkMatch = group.bunks.some((b) => matchesSearch(search, b.name))
      if (hasBunkMatch) result.add(group.name)
    }
    return result
  }, [groups, search])

  const visibleGroups = useMemo(() => {
    if (!search.trim()) return groups
    return groups.filter(
      (g) => matchesSearch(search, g.name) || g.bunks.some((b) => matchesSearch(search, b.name))
    )
  }, [groups, search])

  const toggleExpand = (unit: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(unit)) next.delete(unit)
      else next.add(unit)
      return next
    })
  }

  const onUnitToggle = (unit: string) => {
    if (selectedUnitSet.has(unit)) onRemoveUnit(unit)
    else onAddUnit(unit)
  }

  const onBunkToggle = (bunk: BunkSummary) => {
    const code = bunkToCode(bunk.name)
    if (selectedBunkSet.has(code)) onRemoveBunk(code)
    else onAddBunk(code)
  }

  // Resolve bunk codes in the chip rail back to bunk records for the
  // "B-9 · Eilat" parent hint
  const bunkByCode = useMemo(() => {
    const m = new Map<string, BunkSummary>()
    for (const b of allBunks) m.set(bunkToCode(b.name), b)
    return m
  }, [allBunks])

  return (
    <div className="flex flex-col">
      {/* Chip rail (only renders when chips exist) */}
      {(selectedUnits.length > 0 || selectedBunks.length > 0) && (
        <div className="border-border flex flex-wrap gap-1 border-b p-2">
          {selectedUnits.map((unit) => (
            <span
              key={`u-${unit}`}
              className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium"
            >
              <span className="bg-primary inline-block h-1.5 w-1.5 rounded-full" />
              {unit}
              <button
                type="button"
                aria-label={`Remove ${unit}`}
                onClick={() => onRemoveUnit(unit)}
                className="hover:bg-primary/20 ml-0.5 rounded p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {selectedBunks.map((code) => {
            const bunk = bunkByCode.get(code.toLowerCase())
            const parentUnit = bunk ? getUnitForBunk(bunk.name) : null
            const display = bunk?.name ?? code
            return (
              <span
                key={`b-${code}`}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
              >
                <span className="inline-block h-1.5 w-1.5 rounded-sm bg-emerald-500" />
                {display}
                {parentUnit && <span className="text-[10px] text-emerald-400">· {parentUnit}</span>}
                <button
                  type="button"
                  aria-label={`Remove ${display}`}
                  onClick={() => onRemoveBunk(code.toLowerCase())}
                  className="ml-0.5 rounded p-0.5 hover:bg-emerald-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )
          })}
        </div>
      )}

      {/* Search */}
      <div className="border-border border-b p-3">
        <input
          type="search"
          role="searchbox"
          placeholder="Search units or bunks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border-input focus:ring-ring w-full rounded border px-2 py-1.5 text-sm focus:ring-2 focus:outline-none"
        />
      </div>

      {/* Tree */}
      <ul className="max-h-72 overflow-y-auto py-1">
        {visibleGroups.map((group) => {
          const isUnitSelected = selectedUnitSet.has(group.name)
          const isExpanded = expanded.has(group.name) || searchExpandedSet.has(group.name)
          return (
            <li key={group.name}>
              <div
                className={clsx(
                  'flex items-center gap-1 px-2 py-1.5 text-sm',
                  isUnitSelected && 'bg-primary/5'
                )}
              >
                <button
                  type="button"
                  aria-label={`Expand ${group.name}`}
                  onClick={() => toggleExpand(group.name)}
                  className="text-muted-foreground hover:text-foreground flex h-6 w-6 items-center justify-center rounded"
                >
                  <ChevronRight
                    className={clsx('h-3 w-3 transition-transform', isExpanded && 'rotate-90')}
                  />
                </button>
                {disableUnitSelect ? (
                  <span className="flex flex-1 items-center px-1.5 py-0.5">
                    <span className="text-foreground flex-1 font-medium">{group.name}</span>
                  </span>
                ) : (
                  <label className="-mx-1 -my-0.5 flex flex-1 cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 hover:bg-blue-50 dark:hover:bg-blue-950/30">
                    <input
                      type="checkbox"
                      aria-label={`Select ${group.name}`}
                      checked={isUnitSelected}
                      onChange={() => onUnitToggle(group.name)}
                      className="text-primary focus:ring-ring h-4 w-4 rounded"
                    />
                    <span className="text-foreground flex-1 font-medium">{group.name}</span>
                    {isUnitSelected ? (
                      <span className="bg-primary/20 text-primary rounded px-1.5 py-0.5 text-xs font-medium">
                        Selected
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs font-normal">
                        {group.bunks.length} {group.bunks.length === 1 ? 'bunk' : 'bunks'}
                      </span>
                    )}
                  </label>
                )}
              </div>
              {isExpanded && (
                <ul className="ml-9">
                  {group.bunks.map((bunk) => {
                    const code = bunkToCode(bunk.name)
                    const isBunkSelected = selectedBunkSet.has(code)
                    const isIncluded = isUnitSelected
                    return (
                      <li key={code}>
                        <div
                          className={clsx(
                            'flex items-center gap-1 py-1 pr-2 pl-3 text-sm',
                            isIncluded
                              ? 'cursor-not-allowed opacity-60'
                              : isBunkSelected
                                ? 'bg-emerald-50 dark:bg-emerald-950/30'
                                : ''
                          )}
                        >
                          <label
                            className={clsx(
                              'flex flex-1 items-center gap-2',
                              isIncluded ? 'cursor-not-allowed' : 'cursor-pointer'
                            )}
                            title={
                              isIncluded
                                ? `Already included via ${getUnitForBunk(bunk.name)}`
                                : undefined
                            }
                          >
                            <input
                              type="checkbox"
                              aria-label={`Select ${bunk.name}`}
                              checked={isIncluded || isBunkSelected}
                              disabled={isIncluded}
                              onChange={() => onBunkToggle(bunk)}
                              className="text-primary h-3.5 w-3.5 rounded"
                            />
                            <span
                              className={clsx(
                                'flex-1',
                                isIncluded
                                  ? 'text-muted-foreground'
                                  : isBunkSelected
                                    ? 'font-medium text-emerald-800 dark:text-emerald-300'
                                    : 'text-foreground'
                              )}
                            >
                              {bunk.name}
                            </span>
                            {isIncluded ? (
                              <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                                Included
                              </span>
                            ) : isBunkSelected ? (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200">
                                Selected
                              </span>
                            ) : null}
                          </label>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
        {visibleGroups.length === 0 && (
          <li className="text-muted-foreground px-3 py-3 text-sm">No matching units or bunks.</li>
        )}
      </ul>

      {/* Footer */}
      {isFilterActive && (
        <div className="border-border flex items-center justify-end border-t p-3">
          <button
            type="button"
            onClick={onClear}
            className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-xs font-medium"
          >
            <X className="h-3 w-3" />
            Clear filter
          </button>
        </div>
      )}
    </div>
  )
}
