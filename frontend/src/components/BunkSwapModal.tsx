import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { BunkWithCampers } from '../types/app-types'
import { isEligibleSwapTarget } from '../utils/bunkSwap'
import { extractSortKey } from '../utils/bunkNaming'

interface BunkSwapModalProps {
  source: BunkWithCampers
  allBunks: BunkWithCampers[]
  onCancel: () => void
  onConfirm: (target: BunkWithCampers) => void
}

export default function BunkSwapModal({
  source,
  allBunks,
  onCancel,
  onConfirm,
}: BunkSwapModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Filter to eligible candidates and sort the same way the bunks-view
  // sidebar does (Alpha/Beta first, then numeric ascending).
  const candidates = useMemo(() => {
    return allBunks
      .filter((b) => isEligibleSwapTarget(source, b))
      .sort((a, b) => {
        const aKey = extractSortKey(a.name)
        const bKey = extractSortKey(b.name)
        if (aKey.primary !== bKey.primary) return aKey.primary - bKey.primary
        return aKey.secondary.localeCompare(bKey.secondary)
      })
  }, [source, allBunks])

  const selected = candidates.find((b) => b.id === selectedId) ?? null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bunk-swap-title"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        className="bg-card border-border shadow-lodge-xl w-full max-w-md rounded-2xl border p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="bunk-swap-title" className="text-base font-semibold">
            Swap {source.name} with…
          </h2>
          <button type="button" onClick={onCancel} className="btn-ghost p-1" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {candidates.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No eligible bunks in this session
          </p>
        ) : (
          <div role="radiogroup" className="space-y-1">
            {candidates.map((b) => {
              const isSelected = b.id === selectedId
              return (
                <label
                  key={b.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                    isSelected ? 'bg-primary/10' : 'hover:bg-muted/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="bunk-swap-target"
                    value={b.id}
                    checked={isSelected}
                    onChange={() => setSelectedId(b.id)}
                    aria-label={`${b.name} (${b.campers.length} campers)`}
                  />
                  <span className="font-medium">{b.name}</span>
                  <span className="text-muted-foreground text-sm">
                    · {b.campers.length} campers
                  </span>
                </label>
              )
            })}
          </div>
        )}

        <div className="mt-4 flex justify-between">
          <button
            type="button"
            onClick={onCancel}
            className="border-border hover:bg-muted/50 rounded-lg border px-4 py-2 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected}
            className="bg-primary text-primary-foreground shadow-lodge-sm rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            Confirm swap
          </button>
        </div>
      </div>
    </div>
  )
}
