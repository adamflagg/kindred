/**
 * ImpactedCabinChipRow
 *
 * Renders a wrapping row of chips — one per impacted cabin — above the split
 * view on the Scenario Comparison page.
 *
 * Each chip shows:  "CabinName (N)"  where N = number of campers affected.
 *
 * Behaviour:
 * - Click a chip  → smooth-scrolls both split-view sides so the target cabin
 *   section sits at the top of the viewport.
 * - Re-clicking the same chip re-scrolls (useful after manual scrolling).
 * - Active chip   → the cabin whose section is currently visible in the
 *   viewport gets a highlighted chip state (tracked via IntersectionObserver).
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import clsx from 'clsx'
import type { ImpactedCabinChip } from '../utils/scenarioComparisonUtils'

export interface ImpactedCabinChipRowProps {
  /** Alphabetically-sorted list of impacted cabin chips. */
  chips: ImpactedCabinChip[]
  /**
   * Returns the DOM elements for cabin sections (both left and right panes).
   * Each element must have a `data-cabin` attribute equal to the cabin name.
   * Called lazily on click / observer setup so it always returns current DOM.
   */
  getCabinSectionElements: () => Element[]
}

export default function ImpactedCabinChipRow({
  chips,
  getCabinSectionElements,
}: ImpactedCabinChipRowProps) {
  const [activeChip, setActiveChip] = useState<string | null>(null)
  // Track which chips are currently intersecting
  const intersectingRef = useRef<Set<string>>(new Set())

  // Stable scroll handler — called on chip click
  const handleChipClick = useCallback(
    (cabinName: string) => {
      const elements = getCabinSectionElements()
      const matching = elements.filter((el) => el.getAttribute('data-cabin') === cabinName)
      matching.forEach((el) => {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    },
    [getCabinSectionElements]
  )

  // Set up IntersectionObserver to track which cabin is in viewport
  useEffect(() => {
    if (chips.length === 0) return

    const elements = getCabinSectionElements()
    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const cabinName = entry.target.getAttribute('data-cabin')
          if (!cabinName) continue
          if (entry.isIntersecting) {
            intersectingRef.current.add(cabinName)
          } else {
            intersectingRef.current.delete(cabinName)
          }
        }
        // The active chip is the first alphabetically-ordered intersecting cabin
        const sorted = chips.map((c) => c.name).filter((name) => intersectingRef.current.has(name))
        setActiveChip(sorted[0] ?? null)
      },
      { threshold: 0.1 }
    )

    elements.forEach((el) => observer.observe(el))

    return () => observer.disconnect()
  }, [chips, getCabinSectionElements])

  if (chips.length === 0) return null

  // Sort alphabetically regardless of prop order — computeImpactedCabins already
  // sorts, but we defend here so the component is self-contained.
  const sortedChips = [...chips].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div
      className="mb-4 flex flex-wrap gap-2"
      role="group"
      aria-label="Impacted cabins — click to scroll"
    >
      {sortedChips.map((chip) => (
        <button
          key={chip.name}
          onClick={() => handleChipClick(chip.name)}
          aria-pressed={activeChip === chip.name}
          className={clsx(
            'rounded-full px-3 py-1.5 text-sm font-medium transition-all',
            activeChip === chip.name
              ? 'bg-amber-500 text-white shadow-sm ring-2 ring-amber-400/50'
              : 'bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-800/40'
          )}
        >
          {chip.name} ({chip.count})
        </button>
      ))}
    </div>
  )
}
