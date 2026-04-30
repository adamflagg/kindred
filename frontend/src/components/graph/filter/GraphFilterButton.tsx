import { forwardRef } from 'react'
import { Filter } from 'lucide-react'
import clsx from 'clsx'

interface GraphFilterButtonProps {
  count: number
  open: boolean
  onToggle: () => void
}

const GraphFilterButton = forwardRef<HTMLButtonElement, GraphFilterButtonProps>(
  function GraphFilterButton({ count, open, onToggle }, ref) {
    const isActive = count > 0
    return (
      <button
        ref={ref}
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Filter${isActive ? ` (${count} active)` : ''}`}
        className={clsx(
          'relative flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-medium transition-colors sm:px-3 sm:py-2',
          isActive || open ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
        )}
      >
        <Filter className="h-4 w-4" />
        <span className="hidden sm:inline">Filter</span>
        {isActive && (
          <span className="bg-background text-foreground ml-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-xs font-bold">
            {count}
          </span>
        )}
      </button>
    )
  }
)

export default GraphFilterButton
