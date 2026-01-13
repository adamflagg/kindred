import { useRef, useEffect, useCallback } from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import clsx from 'clsx';
import { UserRoundSearch, Users, X, CircleCheck } from 'lucide-react';
import type { Camper } from '../types/app-types';
import CamperCard from './CamperCard';
import { useBunkRequestsFromContext } from '../hooks';
import { useLockGroupContext } from '../contexts/LockGroupContext';

interface FloatingUnassignedBadgeProps {
  campers: Camper[];
  onCamperClick: (camper: Camper) => void;
  isExpanded: boolean;
  onToggle: () => void;
  onClose: () => void;
  isPanelOpen?: boolean;
}

export default function FloatingUnassignedBadge({
  campers,
  onCamperClick,
  isExpanded,
  onToggle,
  onClose,
  isPanelOpen = false,
}: FloatingUnassignedBadgeProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Set up droppable for the unassigned area
  const { setNodeRef, isOver } = useDroppable({
    id: 'unassigned',
  });

  // Sort campers by lastname (alpha), then firstname
  const sortedCampers = [...campers].sort((a, b) => {
    const lastNameA = a.last_name || a.name.split(' ').pop() || '';
    const lastNameB = b.last_name || b.name.split(' ').pop() || '';
    const lastNameCompare = lastNameA.localeCompare(lastNameB);
    if (lastNameCompare !== 0) return lastNameCompare;

    const firstNameA = a.first_name || a.name.split(' ')[0] || '';
    const firstNameB = b.first_name || b.name.split(' ')[0] || '';
    return firstNameA.localeCompare(firstNameB);
  });

  // Get bunk request status for all unassigned campers
  const camperPersonIds = campers.map(c => c.person_cm_id);
  const { data: requestStatus } = useBunkRequestsFromContext(camperPersonIds);

  // Get lock group context for draft mode
  const { getCamperLockState, getCamperLockGroupColor, isDraftMode } = useLockGroupContext();

  // Handle click outside to close (but not when panel is open - user is viewing details)
  const handleClickOutside = useCallback(
    (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Never close when clicking on a camper card (user is about to view details)
      if (target.closest('[data-camper-card]')) {
        return;
      }

      if (
        isExpanded &&
        !isPanelOpen && // Don't close if camper details panel is open
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        onClose();
      }
    },
    [isExpanded, isPanelOpen, onClose]
  );

  // Handle ESC key to close
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isExpanded) {
        onClose();
      }
    },
    [isExpanded, onClose]
  );

  useEffect(() => {
    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isExpanded, handleClickOutside, handleKeyDown]);

  // Handle camper click - show details but keep popover open (shifted left)
  const handleCamperClick = (camper: Camper) => {
    onCamperClick(camper);
    // Don't close - the popover shifts left to make room for the details panel
  };

  return (
    <div
      data-floating-badge
      className="fixed bottom-14 right-6 z-[70] transition-transform duration-300"
      style={{ transform: isPanelOpen ? 'translateX(-28.5rem)' : 'none' }}
      ref={popoverRef}
    >
      {/* Collapsed Badge */}
      {!isExpanded && (
        <button
          onClick={onToggle}
          className={clsx(
            'w-14 h-14 rounded-full flex items-center justify-center shadow-lodge-lg transition-all relative',
            'hover:scale-105 hover:shadow-lodge-xl active:scale-95',
            'border-2 bg-primary text-primary-foreground border-primary-foreground/20'
          )}
          title={`${campers.length} unassigned campers`}
        >
          {campers.length > 0 ? (
            <>
              <UserRoundSearch className="w-6 h-6" />
              <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 bg-accent text-accent-foreground text-xs font-bold rounded-full flex items-center justify-center shadow-md">
                {campers.length > 99 ? '99+' : campers.length}
              </span>
            </>
          ) : (
            <CircleCheck className="w-6 h-6" />
          )}
        </button>
      )}

      {/* Expanded Popover */}
      {isExpanded && (
        <div
          className={clsx(
            'w-80 max-w-[calc(100vw-3rem)] max-h-[70vh] card-lodge shadow-lodge-xl flex flex-col animate-scale-in',
            'border-2',
            isOver ? 'border-primary' : 'border-border'
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-muted-foreground" />
              <span className="font-semibold">
                Unassigned
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                  ({campers.length})
                </span>
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              title="Close"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          {/* Camper List - Droppable area */}
          <div
            ref={setNodeRef}
            className={clsx(
              'flex-1 overflow-y-auto p-3 min-h-[200px]',
              isOver && 'bg-primary/5'
            )}
          >
            {campers.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-8">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                  <CircleCheck className="w-6 h-6 text-primary" />
                </div>
                <p className="text-foreground font-medium">
                  All campers assigned!
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Drag campers here to unassign
                </p>
              </div>
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
                      onClick={handleCamperClick}
                      hasRequests={requestStatus?.[camper.person_cm_id] ?? true}
                      bunkCampers={[]}
                      lockState={isDraftMode ? getCamperLockState(camper.person_cm_id) : 'none'}
                      lockGroupColor={isDraftMode ? getCamperLockGroupColor(camper.person_cm_id) : undefined}
                      isDraftMode={isDraftMode}
                    />
                  ))}
                </SortableContext>
              </div>
            )}
          </div>

          {/* Footer Tip */}
          {campers.length > 0 && (
            <div className="px-3 py-2 border-t border-border bg-accent/10 flex-shrink-0">
              <p className="text-xs text-accent-foreground">
                <strong>Tip:</strong> Drag campers to bunks to assign
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
