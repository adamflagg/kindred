import { AlertCircle, CheckCircle, ChevronDown, ChevronUp, Loader2, MapPin } from 'lucide-react'
import type { GapItem } from '../../../services/geoService'

export interface AddCoordsPanelProps {
  gaps: GapItem[]
  onAdd: (name: string) => void
  onBatchResolve: () => void
  isBatchResolving: boolean
  isOpen: boolean
  onToggle: () => void
}

export function AddCoordsPanel({
  gaps,
  onAdd,
  onBatchResolve,
  isBatchResolving,
  isOpen,
  onToggle,
}: AddCoordsPanelProps) {
  if (gaps.length === 0) {
    return (
      <div
        data-testid="section-add-coords"
        className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30"
      >
        <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
          All coordinates added
        </span>
      </div>
    )
  }

  return (
    <div
      data-testid="section-add-coords"
      className="overflow-hidden rounded-xl border border-amber-500/20 cursor-pointer"
      onClick={onToggle}
    >
      {/* Collapsible header */}
      <div className="flex w-full items-center gap-2 bg-amber-500/8 px-3 py-2.5 text-left transition-colors">
        <AlertCircle className="h-4 w-4 text-amber-500" />
        <span className="text-foreground text-sm font-semibold">Add Coordinates</span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          {gaps.length}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onBatchResolve()
          }}
          disabled={isBatchResolving}
          className="text-forest-700 hover:text-forest-900 dark:text-forest-400 dark:hover:text-forest-200 ml-auto flex items-center gap-1 text-xs font-medium transition-colors disabled:opacity-50"
        >
          {isBatchResolving ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Resolving...
            </>
          ) : (
            <>
              <MapPin className="h-3 w-3" />
              Auto-fill All
            </>
          )}
        </button>
        <span>
          {isOpen ? (
            <ChevronUp className="text-muted-foreground h-4 w-4" />
          ) : (
            <ChevronDown className="text-muted-foreground h-4 w-4" />
          )}
        </span>
      </div>

      {/* Collapsible content */}
      {isOpen && (
        <div
          className="divide-border/30 max-h-64 divide-y overflow-y-auto border-t border-amber-500/20 bg-amber-500/8"
          onClick={(e) => e.stopPropagation()}
          role="presentation"
        >
          {gaps.map((item) => (
            <div
              key={item.name}
              className="hover:bg-muted/50 flex items-center gap-2 px-3 py-2 transition-colors"
            >
              <span
                data-testid="gap-name"
                className="text-foreground min-w-0 flex-1 truncate text-sm"
              >
                {item.name}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {item.count}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onAdd(item.name)
                }}
                className="text-forest-700 hover:text-forest-900 dark:text-forest-400 dark:hover:text-forest-200 shrink-0 text-xs font-medium transition-colors"
              >
                Add
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
