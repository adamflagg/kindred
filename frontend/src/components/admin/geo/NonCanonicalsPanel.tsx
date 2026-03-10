import { useMemo } from 'react'
import { AlertCircle, CheckCircle, ChevronDown, ChevronUp } from 'lucide-react'
import type { GapItem } from '../../../services/geoService'

export interface NonCanonicalsPanelProps {
  grouped: GapItem[]
  ungrouped: GapItem[]
  onResolve: (name: string, gapType: string) => void
  isOpen: boolean
  onToggle: () => void
}

interface TaggedGap extends GapItem {
  id: string
  gapType: 'non_canonical_grouped' | 'non_canonical_ungrouped'
}

export function NonCanonicalsPanel({
  grouped,
  ungrouped,
  onResolve,
  isOpen,
  onToggle,
}: NonCanonicalsPanelProps) {
  const merged = useMemo<TaggedGap[]>(() => {
    const items: TaggedGap[] = [
      ...grouped.map((g) => ({ ...g, id: g.name, gapType: 'non_canonical_grouped' as const })),
      ...ungrouped.map((g) => ({ ...g, id: g.name, gapType: 'non_canonical_ungrouped' as const })),
    ]
    return items.sort((a, b) => b.count - a.count)
  }, [grouped, ungrouped])

  const totalCount = merged.length

  if (totalCount === 0) {
    return (
      <div
        data-testid="section-non-canonicals"
        className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30"
      >
        <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
          All resolved
        </span>
      </div>
    )
  }

  return (
    <div
      data-testid="section-non-canonicals"
      className="overflow-hidden rounded-xl border border-red-500/20"
    >
      {/* Collapsible header */}
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full cursor-pointer items-center gap-2 bg-red-500/8 px-3 py-2.5 text-left transition-colors"
      >
        <AlertCircle className="h-4 w-4 text-red-500" />
        <span className="text-foreground text-sm font-semibold">Resolve Non-Canonicals</span>
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {totalCount}
        </span>
        <span className="ml-auto">
          {isOpen ? (
            <ChevronUp className="text-muted-foreground h-4 w-4" />
          ) : (
            <ChevronDown className="text-muted-foreground h-4 w-4" />
          )}
        </span>
      </button>

      {/* Collapsible content */}
      {isOpen && (
        <div className="divide-border/30 max-h-64 divide-y overflow-y-auto border-t border-red-500/20 bg-red-500/8">
          {merged.map((item) => {
            const isGrouped = item.gapType === 'non_canonical_grouped'
            return (
              <div
                key={item.id}
                className="hover:bg-muted/50 flex items-center gap-2 px-3 py-2 transition-colors"
              >
                <span
                  data-testid="gap-indicator"
                  className={`h-2 w-2 shrink-0 rounded-full ${isGrouped ? 'bg-red-500' : 'bg-stone-400'}`}
                />
                <span
                  data-testid="gap-name"
                  className="text-foreground min-w-0 flex-1 truncate text-sm"
                >
                  {item.name}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {item.count}
                </span>
                {/* State distribution tags */}
                {Object.keys(item.state_distribution).length > 0 && (
                  <span className="text-xs text-stone-400">
                    {Object.entries(item.state_distribution)
                      .sort(([, a], [, b]) => b - a)
                      .map(([st, ct]) => `${st}\u00a0(${ct})`)
                      .join(' \u00b7 ')}
                  </span>
                )}
                <button
                  onClick={() => onResolve(item.name, item.gapType)}
                  className="text-forest-700 hover:text-forest-900 dark:text-forest-400 dark:hover:text-forest-200 shrink-0 text-xs font-medium transition-colors"
                >
                  Resolve
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
