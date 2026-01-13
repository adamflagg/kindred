import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import clsx from 'clsx';
import type { Camper } from '../types/app-types';
import CamperCard from './CamperCard';
import { useBunkRequestsFromContext } from '../hooks';
import { getDisplayAgeForYear } from '../utils/displayAge';
import { useYear } from '../hooks/useCurrentYear';

interface UnassignedCampersProps {
  campers: Camper[];
  onCamperClick?: (camper: Camper) => void;
  embedded?: boolean; // When true, hide header and adjust for sidebar
}

export default function UnassignedCampers({ campers, onCamperClick, embedded = false }: UnassignedCampersProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'unassigned',
  });
  const viewingYear = useYear();

  // Sort campers by age (youngest to oldest)
  const sortedCampers = React.useMemo(() => {
    return [...campers].sort((a, b) =>
      (getDisplayAgeForYear(a, viewingYear) ?? 0) - (getDisplayAgeForYear(b, viewingYear) ?? 0)
    );
  }, [campers, viewingYear]);

  // Get bunk request status for all unassigned campers
  const camperPersonIds = campers.map(c => c.person_cm_id);
  const { data: requestStatus } = useBunkRequestsFromContext(camperPersonIds);

  return (
    <div className={embedded ? 'h-full flex flex-col' : 'lg:sticky lg:top-4'}>
      {!embedded && (
        <h2 className="text-lg sm:text-xl font-semibold mb-4">
          Unassigned Campers ({campers.length})
        </h2>
      )}
      <div
        ref={setNodeRef}
        className={clsx(
          'border-2 border-dashed rounded-xl p-3 overflow-y-auto',
          embedded
            ? 'flex-1 min-h-0'
            : 'min-h-[300px] lg:min-h-[400px] max-h-[400px] lg:max-h-[calc(100vh-200px)]',
          isOver ? 'border-primary bg-primary/5' : 'border-border/50 bg-muted/30'
        )}
      >
        {campers.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            All campers are assigned! 🎉
          </p>
        ) : (
          <div className="space-y-2">
            <SortableContext
              items={sortedCampers.map(c => c.id)}
              strategy={verticalListSortingStrategy}
            >
              {sortedCampers.map(camper => (
                <CamperCard 
                  key={camper.id} 
                  camper={camper} 
                  {...(onCamperClick && { onClick: onCamperClick })} 
                  hasRequests={requestStatus?.[camper.person_cm_id] ?? true}
                  bunkCampers={[]} // Unassigned campers have no bunk mates
                />
              ))}
            </SortableContext>
          </div>
        )}
      </div>

      {!embedded && campers.length > 0 && (
        <div className="mt-4 p-3 bg-accent/10 border border-accent/30 rounded-xl">
          <p className="text-sm text-amber-700 dark:text-accent">
            <strong>Tip:</strong> Drag campers to bunks to assign them.
            Use constraints to ensure friends bunk together!
          </p>
        </div>
      )}
    </div>
  );
}