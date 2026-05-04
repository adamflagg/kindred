/**
 * GraphControls component
 * Extracted from SocialNetworkGraph.tsx - handles zoom and toggle controls
 */

import type { ReactNode } from 'react'
import {
  Download,
  Eye,
  EyeOff,
  ZoomIn,
  ZoomOut,
  Maximize,
  Maximize2,
  Minimize2,
  HelpCircle,
} from 'lucide-react'
import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'

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
  /** Optional download-as-PNG handler. Receives the mode the user picked. */
  onDownload?: (mode: 'fit' | 'viewport') => void
  /** Optional filter button slot */
  filterButton?: ReactNode
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
  onDownload,
  filterButton,
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

      {/* Filter Button Slot */}
      {filterButton}

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
          <Maximize className="h-5 w-5 sm:h-4 sm:w-4" />
        </button>
        <button
          onClick={onZoomIn}
          className="hover:bg-muted flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-r-xl p-2.5 transition-colors sm:p-2"
          title="Zoom in"
        >
          <ZoomIn className="h-5 w-5 sm:h-4 sm:w-4" />
        </button>
      </div>

      {/* Download as PNG — only rendered when a handler is wired in */}
      {onDownload && <DownloadMenu onSelect={onDownload} />}

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

function DownloadMenu({ onSelect }: { onSelect: (mode: 'fit' | 'viewport') => void }) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  function pick(mode: 'fit' | 'viewport') {
    setOpen(false)
    onSelect(mode)
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="bg-muted hover:bg-muted/80 flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-xl p-2.5 transition-colors sm:p-2"
        title="Download as PNG"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Download className="h-5 w-5 sm:h-4 sm:w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="border-border bg-card shadow-lodge-md absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-xl border"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => pick('fit')}
            className="hover:bg-muted text-foreground block w-full px-3 py-2 text-left text-sm"
          >
            Fit to graph
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => pick('viewport')}
            className="hover:bg-muted text-foreground block w-full px-3 py-2 text-left text-sm"
          >
            Current view
          </button>
        </div>
      )}
    </div>
  )
}
