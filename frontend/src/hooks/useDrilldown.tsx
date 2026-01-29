/**
 * useDrilldown - Reusable hook for chart drilldown functionality.
 *
 * Encapsulates the drilldown state management and modal rendering pattern
 * that was previously repeated across RegistrationTab and RegistrationOverview.
 *
 * Usage:
 * const { setFilter, DrilldownModal } = useDrilldown({
 *   year,
 *   sessionCmId,
 *   sessionTypes,
 *   statusFilter,
 * });
 *
 * // Pass setFilter to charts
 * <BreakdownChart onSegmentClick={setFilter} />
 *
 * // Render modal at end of JSX
 * <DrilldownModal />
 */

import { useState, useCallback, useMemo } from 'react';
import { DrillDownModal } from '../components/metrics/DrillDownModal';
import type { DrilldownFilter } from '../types/metrics';

interface UseDrilldownOptions {
  /** The year for drilldown data */
  year: number;
  /** Optional session filter (CampMinder session ID) */
  sessionCmId?: number;
  /** Session types to include (e.g., ['main', 'embedded', 'ag']) */
  sessionTypes: string[];
  /** Status filter (e.g., ['enrolled']) */
  statusFilter: string[];
}

interface UseDrilldownReturn {
  /** Current filter state (null when modal is closed) */
  filter: DrilldownFilter | null;
  /** Set filter to open modal with specified breakdown */
  setFilter: (filter: DrilldownFilter) => void;
  /** Clear filter to close modal */
  clearFilter: () => void;
  /** Modal component to render - returns null when filter is null */
  DrilldownModal: () => JSX.Element | null;
}

export function useDrilldown({
  year,
  sessionCmId,
  sessionTypes,
  statusFilter,
}: UseDrilldownOptions): UseDrilldownReturn {
  const [filter, setFilterState] = useState<DrilldownFilter | null>(null);

  const setFilter = useCallback((newFilter: DrilldownFilter) => {
    setFilterState(newFilter);
  }, []);

  const clearFilter = useCallback(() => {
    setFilterState(null);
  }, []);

  // Memoize the modal component to prevent unnecessary re-renders
  const DrilldownModalComponent = useMemo(() => {
    return function DrilldownModalWrapper(): JSX.Element | null {
      if (!filter) {
        return null;
      }
      return (
        <DrillDownModal
          year={year}
          filter={filter}
          sessionCmId={sessionCmId}
          sessionTypes={sessionTypes}
          statusFilter={statusFilter}
          onClose={clearFilter}
        />
      );
    };
  }, [filter, year, sessionCmId, sessionTypes, statusFilter, clearFilter]);

  return {
    filter,
    setFilter,
    clearFilter,
    DrilldownModal: DrilldownModalComponent,
  };
}
