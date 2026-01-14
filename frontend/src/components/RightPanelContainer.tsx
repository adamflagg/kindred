import { useState, lazy, Suspense, Activity } from 'react';
import { Users, User, Loader2 } from 'lucide-react';
import type { Camper } from '../types/app-types';
import UnassignedCampers from './UnassignedCampers';

// Lazy load CamperDetailsPanel - only needed when a camper is selected
const CamperDetailsPanel = lazy(() => import('./CamperDetailsPanel'));

type RightPanelView = 'unassigned' | 'camper-details';

interface RightPanelContainerProps {
  selectedCamperId: string | null;
  unassignedCampers: Camper[];
  onCamperClick: (camper: Camper) => void;
  onCloseDetails: () => void;
}

export default function RightPanelContainer({
  selectedCamperId,
  unassignedCampers,
  onCamperClick,
  onCloseDetails,
}: RightPanelContainerProps) {
  // Track manual tab selection (when no camper is selected)
  const [manualView, setManualView] = useState<RightPanelView>('unassigned');
  // Track the last selected camper to keep the panel mounted (preserves state)
  const [lastCamperId, setLastCamperId] = useState<string | null>(null);

  // Update last camper during render when selection changes (React pattern for derived state)
  // This avoids useEffect and cascading renders
  if (selectedCamperId && selectedCamperId !== lastCamperId) {
    setLastCamperId(selectedCamperId);
  }

  // Derive active view: auto-switch to details when camper selected, otherwise use manual choice
  const activeView: RightPanelView = selectedCamperId ? 'camper-details' : manualView;

  // The camper to display - current selection or last selected (for preserving state)
  const displayCamperId = selectedCamperId ?? lastCamperId;

  // Handle closing details - switch back to unassigned view
  const handleCloseDetails = () => {
    setManualView('unassigned');
    onCloseDetails();
  };

  // Handle tab click
  const handleTabClick = (view: RightPanelView) => {
    setManualView(view);
    // If switching to unassigned, clear the selected camper
    if (view === 'unassigned') {
      onCloseDetails();
    }
  };

  return (
    <div className="lg:sticky lg:top-4">
      {/* Tab Header */}
      <div className="flex gap-1 mb-4 p-1 bg-muted/50 rounded-xl">
        <button
          onClick={() => handleTabClick('unassigned')}
          className={`
            flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all
            ${activeView === 'unassigned'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
            }
          `}
        >
          <Users className="h-4 w-4" />
          <span>Unassigned</span>
          <span className={`
            px-1.5 py-0.5 text-xs rounded-full
            ${activeView === 'unassigned'
              ? 'bg-primary/10 text-primary'
              : 'bg-muted text-muted-foreground'
            }
          `}>
            {unassignedCampers.length}
          </span>
        </button>

        <button
          onClick={() => handleTabClick('camper-details')}
          disabled={!selectedCamperId}
          className={`
            flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all
            ${activeView === 'camper-details'
              ? 'bg-card text-foreground shadow-sm'
              : selectedCamperId
                ? 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                : 'text-muted-foreground/50 cursor-not-allowed'
            }
          `}
        >
          <User className="h-4 w-4" />
          <span>Details</span>
          {selectedCamperId && activeView !== 'camper-details' && (
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          )}
        </button>
      </div>

      {/* Content Area - Using Activity to preserve state across tab switches */}
      <div className="relative">
        {/* Unassigned Campers - preserves scroll position and filter state */}
        <Activity mode={activeView === 'unassigned' ? 'visible' : 'hidden'}>
          <UnassignedCampers
            campers={unassignedCampers}
            onCamperClick={onCamperClick}
          />
        </Activity>

        {/* Camper Details - lazy loaded, preserves expanded sections and loaded data */}
        <Activity mode={activeView === 'camper-details' && displayCamperId ? 'visible' : 'hidden'}>
          {displayCamperId ? (
            <Suspense fallback={
              <div className="card-lodge p-8 text-center">
                <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary mb-4" />
                <p className="text-muted-foreground">Loading details...</p>
              </div>
            }>
              <CamperDetailsPanel
                camperId={displayCamperId}
                onClose={handleCloseDetails}
                embedded={true}
              />
            </Suspense>
          ) : null}
        </Activity>

        {/* Placeholder when no camper has been selected yet */}
        {activeView === 'camper-details' && !displayCamperId && (
          <div className="card-lodge p-8 text-center">
            <User className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground">
              Click on a camper to view their details
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
