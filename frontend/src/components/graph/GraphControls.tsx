/**
 * GraphControls component
 * Extracted from SocialNetworkGraph.tsx - handles view mode, zoom, and toggle controls
 */

import { Eye, EyeOff, ZoomIn, ZoomOut, Maximize2, Minimize2, HelpCircle, ChevronDown } from 'lucide-react';
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react';
import clsx from 'clsx';

export type ViewMode = 'all' | 'ego';

export interface GraphControlsProps {
  /** Current view mode */
  viewMode: ViewMode;
  /** Callback when view mode changes */
  onViewModeChange: (mode: ViewMode) => void;
  /** Whether labels are visible */
  showLabels: boolean;
  /** Toggle label visibility */
  onToggleLabels: () => void;
  /** Whether help panel is visible */
  showHelp: boolean;
  /** Toggle help panel visibility */
  onToggleHelp: () => void;
  /** Whether graph is expanded to fullscreen */
  isExpanded: boolean;
  /** Toggle expanded state */
  onToggleExpand: () => void;
  /** Zoom in */
  onZoomIn: () => void;
  /** Zoom out */
  onZoomOut: () => void;
  /** Fit graph to container */
  onFit: () => void;
}

export default function GraphControls({
  viewMode,
  onViewModeChange,
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
    <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
      {/* View Mode Selector */}
      <Listbox value={viewMode} onChange={onViewModeChange}>
        <div className="relative">
          <ListboxButton
            className="listbox-button-compact min-h-[44px] text-xs sm:text-sm"
            title={
              viewMode === 'ego'
                ? 'Click on a camper to see their direct connections'
                : 'Shows all social connections in the session'
            }
          >
            <span>{viewMode === 'all' ? 'All Connections' : 'Ego Network'}</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </ListboxButton>
          <ListboxOptions className="listbox-options w-auto min-w-[140px]">
            <ListboxOption value="all" className="listbox-option py-1.5">All Connections</ListboxOption>
            <ListboxOption value="ego" className="listbox-option py-1.5">Ego Network</ListboxOption>
          </ListboxOptions>
        </div>
      </Listbox>

      {/* Label Toggle - Hidden on small mobile, visible on larger screens */}
      <button
        onClick={onToggleLabels}
        className={clsx(
          'p-2.5 sm:p-2 rounded-xl transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center hidden xs:flex',
          showLabels
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted hover:bg-muted/80'
        )}
        title={showLabels ? 'Hide labels' : 'Show labels'}
      >
        {showLabels ? <Eye className="w-5 h-5 sm:w-4 sm:h-4" /> : <EyeOff className="w-5 h-5 sm:w-4 sm:h-4" />}
      </button>

      {/* Help Toggle - Hidden on mobile */}
      <button
        onClick={onToggleHelp}
        className={clsx(
          'p-2.5 sm:p-2 rounded-xl transition-colors min-w-[44px] min-h-[44px] items-center justify-center hidden sm:flex',
          showHelp
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted hover:bg-muted/80'
        )}
        title="Toggle help information"
      >
        <HelpCircle className="w-5 h-5 sm:w-4 sm:h-4" />
      </button>

      {/* Zoom Controls - Grouped for better touch targets */}
      <div className="flex items-center border border-border rounded-xl bg-background">
        <button
          onClick={onZoomOut}
          className="p-2.5 sm:p-2 hover:bg-muted transition-colors rounded-l-xl min-w-[44px] min-h-[44px] flex items-center justify-center touch-manipulation"
          title="Zoom out"
        >
          <ZoomOut className="w-5 h-5 sm:w-4 sm:h-4" />
        </button>
        <button
          onClick={onFit}
          className="p-2.5 sm:p-2 hover:bg-muted transition-colors border-x border-border min-w-[44px] min-h-[44px] flex items-center justify-center touch-manipulation"
          title="Fit to screen"
        >
          <Maximize2 className="w-5 h-5 sm:w-4 sm:h-4" />
        </button>
        <button
          onClick={onZoomIn}
          className="p-2.5 sm:p-2 hover:bg-muted transition-colors rounded-r-xl min-w-[44px] min-h-[44px] flex items-center justify-center touch-manipulation"
          title="Zoom in"
        >
          <ZoomIn className="w-5 h-5 sm:w-4 sm:h-4" />
        </button>
      </div>

      {/* Expand Toggle */}
      <button
        onClick={onToggleExpand}
        className={clsx(
          'p-2.5 sm:p-2 rounded-xl transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center touch-manipulation',
          isExpanded
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
        )}
        title={isExpanded ? 'Exit expanded view' : 'Expand graph'}
      >
        {isExpanded ? (
          <Minimize2 className="w-5 h-5 sm:w-4 sm:h-4" />
        ) : (
          <Maximize2 className="w-5 h-5 sm:w-4 sm:h-4" />
        )}
      </button>
    </div>
  );
}
