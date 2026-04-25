/**
 * GraphControls component
 * Extracted from SocialNetworkGraph.tsx - handles zoom and toggle controls
 */

import { Eye, EyeOff, ZoomIn, ZoomOut, Maximize2, Minimize2, HelpCircle } from 'lucide-react'
import clsx from 'clsx'

export interface GraphControlsProps {
  /** Whether labels are visible */
  showLabels: boolean
  /** Toggle label visibility */
  onToggleLabels: () => void
  /** Whether help panel is visible */
  showHelp: boolean
  /** Toggle help panel visibility */
  onToggleHelp: () => void
  /** Whether graph is expanded to fullscreen */
  isExpanded: boolean
  /** Toggle expanded state */
  onToggleExpand: () => void
  /** Zoom in */
  onZoomIn: () => void
  /** Zoom out */
  onZoomOut: () => void
  /** Fit graph to container */
  onFit: () => void
}

export default function GraphControls({
  showLabels,
  onToggleLabels,
  showHelp,
  onToggleHelp,
  isExpanded,
  onToggleExpand,
  onZoomIn,
  onZoomOut,
  onFit,
}: GraphControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 sm:gap-2">
      {/* Label Toggle - Hidden on small mobile, visible on larger screens */}
      <button
        onClick={onToggleLabels}
        className={clsx(
          'xs:flex flex hidden min-h-[44px] min-w-[44px] items-center justify-center rounded-xl p-2.5 transition-colors sm:p-2',
          showLabels ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
        )}
        title={showLabels ? 'Hide labels' : 'Show labels'}
      >
        {showLabels ? (
          <Eye className="h-5 w-5 sm:h-4 sm:w-4" />
        ) : (
          <EyeOff className="h-5 w-5 sm:h-4 sm:w-4" />
        )}
      </button>

      {/* Help Toggle - Hidden on mobile */}
      <button
        onClick={onToggleHelp}
        className={clsx(
          'hidden min-h-[44px] min-w-[44px] items-center justify-center rounded-xl p-2.5 transition-colors sm:flex sm:p-2',
          showHelp ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
        )}
        title="Toggle help information"
      >
        <HelpCircle className="h-5 w-5 sm:h-4 sm:w-4" />
      </button>

      {/* Zoom Controls - Grouped for better touch targets */}
      <div className="border-border bg-background flex items-center rounded-xl border">
        <button
          onClick={onZoomOut}
          className="hover:bg-muted flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-l-xl p-2.5 transition-colors sm:p-2"
          title="Zoom out"
        >
          <ZoomOut className="h-5 w-5 sm:h-4 sm:w-4" />
        </button>
        <button
          onClick={onFit}
          className="hover:bg-muted border-border flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center border-x p-2.5 transition-colors sm:p-2"
          title="Fit to screen"
        >
          <Maximize2 className="h-5 w-5 sm:h-4 sm:w-4" />
        </button>
        <button
          onClick={onZoomIn}
          className="hover:bg-muted flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-r-xl p-2.5 transition-colors sm:p-2"
          title="Zoom in"
        >
          <ZoomIn className="h-5 w-5 sm:h-4 sm:w-4" />
        </button>
      </div>

      {/* Expand Toggle */}
      <button
        onClick={onToggleExpand}
        className={clsx(
          'flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-xl p-2.5 transition-colors sm:p-2',
          isExpanded
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
        )}
        title={isExpanded ? 'Exit expanded view' : 'Expand graph'}
      >
        {isExpanded ? (
          <Minimize2 className="h-5 w-5 sm:h-4 sm:w-4" />
        ) : (
          <Maximize2 className="h-5 w-5 sm:h-4 sm:w-4" />
        )}
      </button>
    </div>
  )
}
