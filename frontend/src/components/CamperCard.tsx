import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';
import { Lock, Eye, UserPlus, UserMinus, Users, ChevronRight, Home } from 'lucide-react';
import { getGenderIdentityDisplay, getGenderCategory, getGenderColorClasses } from '../utils/genderUtils';
import { getSessionShorthand } from '../utils/sessionDisplay';
import { formatGradeOrdinal } from '../utils/gradeUtils';
import { getDisplayAgeForYear } from '../utils/displayAge';
import { useYear } from '../hooks/useCurrentYear';
import type { Camper } from '../types/app-types';
import type { BunkmateInfo } from '../contexts/BunkRequestContext';
import { useBunkRequestContext, useCamperHistoryContext } from '../hooks';
import { useLockGroupContext } from '../contexts/LockGroupContext';


interface CamperCardProps {
  camper: Camper;
  isDraggable?: boolean;
  isDragging?: boolean;
  onClick?: (camper: Camper) => void;
  hasRequests?: boolean; // Indicates if camper has bunk requests
  onLockToggle?: (camper: Camper) => void;
  onUnassign?: (camper: Camper) => void; // Unassign from current bunk
  bunkCampers?: BunkmateInfo[]; // Campers in the same bunk with their grades
  lockState?: 'none' | 'pending' | 'locked'; // Lock state
  lockGroupColor?: string | undefined; // Color of the lock group
  isDraftMode?: boolean; // True when viewing a draft scenario (enables lock features)
}

function CamperCard({
  camper,
  isDraggable = true,
  isDragging = false,
  onClick,
  hasRequests: _hasRequests = true, // Default to true to avoid visual noise until we have data
  onLockToggle,
  onUnassign,
  bunkCampers = [],
  lockState = 'none',
  lockGroupColor,
  isDraftMode = false
}: CamperCardProps) {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [showGroupSubmenu, setShowGroupSubmenu] = useState(false);
  const [submenuPosition, setSubmenuPosition] = useState<'below' | 'above'>('below');
  const viewingYear = useYear();

  // Get lock group context for adding/removing pending campers and animation delay
  const { addPendingCamper, removePendingCamper, getPendingAnimationDelay, groups, addCamperToGroup, getCamperLockGroup, getGroupMembers } = useLockGroupContext();

  // Get bunk request context
  const { getSatisfiedRequestInfo } = useBunkRequestContext();
  const { getLastYearHistory } = useCamperHistoryContext();
  
  // Get satisfied requests information from context
  // React Compiler will optimize this computation
  const getSatisfiedInfo = () => {
    if (isDragging || !camper.assigned_bunk_cm_id) {
      return {
        totalRequests: 0,
        satisfiedCount: 0,
        topPrioritySatisfied: false,
        priorityLevels: [],
        hasLockedPriority: false
      };
    }

    // Use passed bunk campers or default to just the current camper
    const campersForCalc = bunkCampers.length > 0
      ? bunkCampers
      : [{ cmId: camper.person_cm_id, grade: camper.grade }];

    return getSatisfiedRequestInfo(
      camper.person_cm_id,
      camper.assigned_bunk_cm_id,
      campersForCalc,
      camper.grade
    );
  };
  
  const satisfiedInfo = getSatisfiedInfo();

  // Get last year's history from context
  const lastYearHistory = getLastYearHistory(camper.person_cm_id);

  // Check if camper is in a locked group and get group size
  const isInLockedGroup = lockState === 'locked';
  const lockGroup = isInLockedGroup ? getCamperLockGroup(camper.person_cm_id) : null;
  const groupSize = lockGroup ? getGroupMembers(lockGroup.id).length : 0;

  // Listen for global close event from other context menus
  useEffect(() => {
    const handleCloseAll = () => setShowContextMenu(false);
    window.addEventListener('closeAllContextMenus', handleCloseAll);
    return () => window.removeEventListener('closeAllContextMenus', handleCloseAll);
  }, []);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({
    id: camper.id,
    disabled: !isDraggable,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    willChange: isDragging ? 'transform' : 'auto',
  };
  
  const handleClick = (e: React.MouseEvent) => {
    // Only trigger click if not dragging
    if (isDragging || isSortableDragging) return;

    // Ctrl/Cmd+click for multi-select lock group mode (only in draft mode)
    if ((e.ctrlKey || e.metaKey) && isDraftMode) {
      e.preventDefault();
      e.stopPropagation();

      if (lockState === 'pending') {
        // Already pending - remove from selection
        removePendingCamper(camper.id);
      } else if (lockState === 'none') {
        // Not in a group - add to pending selection
        addPendingCamper(camper);
      }
      // If locked, do nothing (can't add locked campers to new groups)
      return;
    }

    // Normal click - view camper details
    if (onClick) {
      e.stopPropagation();
      onClick(camper);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Close any other open context menus first, then open ours after a microtask
    // This ensures the close event is fully processed before opening
    window.dispatchEvent(new CustomEvent('closeAllContextMenus'));
    requestAnimationFrame(() => {
      setContextMenuPosition({ x: e.clientX, y: e.clientY });
      setShowContextMenu(true);
    });
  };

  const handleViewDetails = () => {
    setShowContextMenu(false);
    if (onClick) {
      onClick(camper);
    }
  };

  const handleAddToLockGroup = () => {
    setShowContextMenu(false);
    addPendingCamper(camper);
  };

  const handleRemoveFromLockGroup = () => {
    setShowContextMenu(false);
    // If pending, just remove from pending
    if (lockState === 'pending') {
      removePendingCamper(camper.id);
    }
    // If locked, removal is handled via LockGroupPanel
  };

  const handleLockToggle = () => {
    if (onLockToggle) {
      onLockToggle(camper);
    }
    setShowContextMenu(false);
  };
  

  const genderIdentity = getGenderIdentityDisplay(camper);
  const genderCategory = getGenderCategory(genderIdentity);
  const genderColorClass = getGenderColorClasses(genderCategory, genderIdentity);

  // Format historical data for display
  const historyDisplay = lastYearHistory 
    ? `${getSessionShorthand(lastYearHistory.sessionName, lastYearHistory.sessionType)} ${lastYearHistory.bunkName}`
    : '';

  return (
    <>
      <div
        data-camper-card
        ref={setNodeRef}
        style={{
          ...style,
          ...(lockState === 'pending' ? { animationDelay: `${getPendingAnimationDelay(camper.id)}ms` } : {})
        } as React.CSSProperties}
        className={clsx(
          'p-2.5 rounded-xl border-2 select-none relative transition-all overflow-hidden',
          genderColorClass,
          isDraggable && 'hover:shadow-lodge cursor-move',
          !isDraggable && 'cursor-default',
          (isSortableDragging || isDragging) && 'opacity-50',
          // Pending lock group selection - synchronized glow animation
          lockState === 'pending' && 'border-amber-400 dark:border-amber-500 pending-lock-glow'
        )}
        {...(isDraggable ? attributes : {})}
        {...(isDraggable ? listeners : {})}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <div className="flex flex-col gap-0.5">
          {/* Line 1: Name (left) and Status icons (right) */}
          <div className="flex items-center justify-between gap-1.5">
            <p
              className="font-medium text-sm dark:text-gray-100 truncate flex-1 min-w-0"
              style={isInLockedGroup && lockGroupColor ? {
                textShadow: `0 0 8px ${lockGroupColor}, 0 0 12px ${lockGroupColor}80`
              } : undefined}
            >
              {camper.name}
            </p>
            <div className="flex items-center gap-1 flex-shrink-0">
              {/* Warning: has requests but none satisfied */}
              {satisfiedInfo && satisfiedInfo.totalRequests > 0 && satisfiedInfo.satisfiedCount === 0 && (
                <span
                  className="text-orange-500 dark:text-orange-400"
                  title={`${satisfiedInfo.totalRequests} request${satisfiedInfo.totalRequests > 1 ? 's' : ''}, none satisfied`}
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                </span>
              )}
              {/* Lock: in friend group with member count */}
              {isInLockedGroup && (
                <span
                  className="inline-flex items-center gap-0.5"
                  style={{ color: lockGroupColor || '#eab308' }}
                  title={`Friend group (${groupSize} members)`}
                >
                  {groupSize > 1 && (
                    <span className="text-xs font-semibold leading-none">
                      {groupSize}
                    </span>
                  )}
                  <Lock className="w-4 h-4" />
                </span>
              )}
            </div>
          </div>

          {/* Line 2: Age/Grade (left) and History (right) */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Age {(getDisplayAgeForYear(camper, viewingYear) ?? 0).toFixed(1)} • {formatGradeOrdinal(camper.grade)}
            </p>
            {historyDisplay && (
              <p className="text-xs text-muted-foreground whitespace-nowrap">
                {historyDisplay}
              </p>
            )}
          </div>
        </div>

        {/* Bottom gradient overlay for locked groups - temporarily disabled
        {isInLockedGroup && lockGroupColor && (
          <div
            className="absolute bottom-0 left-0 right-0 h-4 pointer-events-none"
            style={{
              background: `linear-gradient(to bottom, transparent 0%, ${lockGroupColor}40 100%)`,
              borderBottomLeftRadius: 'inherit',
              borderBottomRightRadius: 'inherit'
            }}
          />
        )}
        */}
      </div>

      {/* Context Menu - rendered via Portal to escape stacking context issues */}
      {showContextMenu && createPortal(
        <>
          <div
            className="fixed inset-0 z-[9998]"
            data-backdrop="true"
            onClick={() => setShowContextMenu(false)}
            onContextMenu={(e) => {
              e.preventDefault();
              setShowContextMenu(false);
              // Find element under all backdrops and re-dispatch contextmenu to it
              const elements = document.elementsFromPoint(e.clientX, e.clientY);
              for (const el of elements) {
                if (el instanceof HTMLElement && el.dataset['backdrop']) continue;
                el.dispatchEvent(new MouseEvent('contextmenu', {
                  bubbles: true,
                  cancelable: true,
                  clientX: e.clientX,
                  clientY: e.clientY,
                  view: window
                }));
                break;
              }
            }}
          />
          <div
            className="fixed z-[9999] card-lodge p-1 shadow-lodge-lg animate-scale-in"
            style={{
              left: `${Math.min(contextMenuPosition.x, window.innerWidth - 200)}px`,
              top: `${Math.min(contextMenuPosition.y, window.innerHeight - 120)}px`,
              minWidth: '180px'
            }}
          >
            {/* View Details - always available */}
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50 flex items-center gap-2 transition-colors rounded-md"
              onClick={handleViewDetails}
            >
              <Eye className="w-4 h-4" />
              View Details
            </button>

            {/* Unassign - only for assigned campers in draft mode */}
            {isDraftMode && camper.assigned_bunk_cm_id && onUnassign && (
              <>
                <div className="border-t border-border my-1" />
                <button
                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50 flex items-center gap-2 transition-colors rounded-md text-amber-600"
                  onClick={() => {
                    onUnassign(camper);
                    setShowContextMenu(false);
                  }}
                >
                  <Home className="w-4 h-4" />
                  Unassign
                </button>
              </>
            )}

            {/* Friend Group Options - available in draft mode for any camper */}
            {isDraftMode && (
              <>
                <div className="border-t border-border my-1" />

                {/* Add to New Friend Group - always available for unlocked campers */}
                {lockState === 'none' && (
                  <button
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50 flex items-center gap-2 transition-colors rounded-md"
                    onClick={handleAddToLockGroup}
                  >
                    <UserPlus className="w-4 h-4" />
                    Add to New Group
                  </button>
                )}

                {/* Add to Existing Group - shown when groups exist and camper is unlocked */}
                {lockState === 'none' && groups.length > 0 && (
                  <div
                    className="relative"
                    onMouseEnter={(e) => {
                      // Calculate if submenu would overflow bottom of viewport
                      const rect = e.currentTarget.getBoundingClientRect();
                      const submenuHeight = groups.length * 40 + 16; // ~40px per item + padding
                      const spaceBelow = window.innerHeight - rect.bottom;
                      const spaceAbove = rect.top;

                      // Position above if not enough space below and more space above
                      if (spaceBelow < submenuHeight && spaceAbove > spaceBelow) {
                        setSubmenuPosition('above');
                      } else {
                        setSubmenuPosition('below');
                      }
                      setShowGroupSubmenu(true);
                    }}
                    onMouseLeave={() => setShowGroupSubmenu(false)}
                  >
                    <button
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50 flex items-center justify-between transition-colors rounded-md"
                    >
                      <span className="flex items-center gap-2">
                        <Users className="w-4 h-4" />
                        Add to Group
                      </span>
                      <ChevronRight className="w-3 h-3 opacity-60" />
                    </button>

                    {/* Group Submenu - positions above or below based on viewport space */}
                    {showGroupSubmenu && (
                      <div
                        className="absolute left-full ml-1 card-lodge p-1 shadow-lodge-lg min-w-[160px] animate-scale-in"
                        style={{
                          transformOrigin: submenuPosition === 'above' ? 'left bottom' : 'left top',
                          ...(submenuPosition === 'above'
                            ? { bottom: 0 }
                            : { top: 0 })
                        }}
                      >
                        {groups.map((group) => (
                          <button
                            key={group.id}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50 flex items-center gap-2 transition-colors rounded-md"
                            onClick={() => {
                              addCamperToGroup(camper, group.id);
                              setShowContextMenu(false);
                            }}
                          >
                            <span
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: group.color }}
                            />
                            <span className="truncate">{group.name || 'Unnamed Group'}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Cancel Selection - for pending */}
                {lockState === 'pending' && (
                  <button
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50 flex items-center gap-2 transition-colors rounded-md text-amber-600"
                    onClick={handleRemoveFromLockGroup}
                  >
                    <UserMinus className="w-4 h-4" />
                    Cancel Selection
                  </button>
                )}

                {/* View/Manage Friend Group - for locked campers */}
                {lockState === 'locked' && (
                  <button
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50 flex items-center gap-2 transition-colors rounded-md"
                    onClick={handleLockToggle}
                  >
                    <Lock className="w-4 h-4" style={{ color: lockGroupColor }} />
                    Manage Friend Group
                  </button>
                )}
              </>
            )}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

export default CamperCard;