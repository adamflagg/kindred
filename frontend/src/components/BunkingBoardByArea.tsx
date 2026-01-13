import { useState, useTransition, useEffect, useCallback, lazy, Suspense } from 'react';
import type {
  DragEndEvent,
  DragStartEvent} from '@dnd-kit/core';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
} from '@dnd-kit/core';
import { toast } from 'react-hot-toast';
import type { Bunk, Camper, BunkWithCampers, DragItem } from '../types/app-types';
import BunkCard from './BunkCard';
import FloatingUnassignedBadge from './FloatingUnassignedBadge';
import CamperDetailsPanel from './CamperDetailsPanel';

// Lazy load heavy components - only loads when needed
const BunkSocialGraphModal = lazy(() => import('./BunkSocialGraphModal'));

// Lazy load lock group components - only needed in draft mode
const LockGroupActionBar = lazy(() => import('./LockGroupActionBar'));
const LockGroupPanel = lazy(() => import('./LockGroupPanel'));
const LockGroupsHub = lazy(() => import('./LockGroupsHub'));
import { useLockGroupContext } from '../contexts/LockGroupContext';
import { formatGradeOrdinal } from '../utils/gradeUtils';
import { useYear } from '../hooks/useCurrentYear';
import { Home } from 'lucide-react';

interface BunkingBoardByAreaProps {
  sessionId: string;
  sessionCmId: number;
  bunks: Bunk[];
  campers: Camper[];
  selectedArea: 'all' | 'boys' | 'girls' | 'all-gender';
  onAreaChange: (area: 'all' | 'boys' | 'girls' | 'all-gender') => void;
  onCamperMove: (camperId: string, toBunkId: string | null) => Promise<void>;
  onCamperLockToggle?: (camperId: string, locked: boolean, reason?: string) => Promise<void>;
  isProductionMode?: boolean;
  defaultCapacity?: number;
}

type BunkArea = 'boys' | 'girls' | 'all-gender';

export default function BunkingBoardByArea(props: BunkingBoardByAreaProps) {
  const {
    sessionCmId,
    bunks,
    campers,
    selectedArea,
    onCamperMove,
    isProductionMode = false,
    defaultCapacity = 12,
  } = props;
  // props.sessionId and props.onAreaChange are available if needed later
  const [, setActiveId] = useState<string | null>(null);
  const [activeDragItem, setActiveDragItem] = useState<DragItem | null>(null);
  const [selectedCamperId, setSelectedCamperId] = useState<string | null>(null);
  const [requestCloseDetails, setRequestCloseDetails] = useState(false);
  const [requestCloseLockPanel, setRequestCloseLockPanel] = useState(false);
  const [selectedBunkForGraph, setSelectedBunkForGraph] = useState<{ cmId: number; name: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUnassignedExpanded, setIsUnassignedExpanded] = useState(false);
  const [draggedGroupMembers, setDraggedGroupMembers] = useState<Camper[]>([]);
  const [, startTransition] = useTransition();
  const currentYear = useYear();

  // Get lock group context for action bar and pending camper management
  const {
    pendingCampers,
    clearPendingCampers,
    addPendingCamper,
    removePendingCamper,
    getCamperLockState,
    getCamperLockGroup,
    getGroupMembers,
    scenarioId,
    sessionPbId: lockGroupSessionPbId,
    isDraftMode,
    isLockPanelOpen,
    setIsLockPanelOpen,
    selectedGroupId,
    setSelectedGroupId,
    groups,
    membersByGroup
  } = useLockGroupContext();

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 10 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 100, tolerance: 5 },
    })
  );

  // Custom collision detection: pointer must be within a droppable
  // Falls back to rect intersection if pointer isn't directly over anything
  // This prevents "snapping" to the nearest valid bunk when dropping on invalid areas
  const customCollisionDetection = (args: Parameters<typeof pointerWithin>[0]) => {
    // First, try pointer-within (most precise - pointer must be inside droppable)
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    // Fall back to rect intersection for edge cases
    return rectIntersection(args);
  };

  // Categorize bunks by area
  // React Compiler will optimize this computation
  const getBunksByArea = () => {
    const areas: Record<BunkArea, BunkWithCampers[]> = {
      boys: [],
      girls: [],
      'all-gender': [],
    };

    bunks.forEach(bunk => {
      const assignedCampers = campers.filter(c => c.assigned_bunk === bunk.id);
      const bunkWithCampers: BunkWithCampers = {
        ...bunk,
        campers: assignedCampers,
        occupancy: assignedCampers.length,
        utilization: (assignedCampers.length / bunk.capacity) * 100,
      };

      // Categorize by bunk name prefix
      const bunkName = bunk.name.toUpperCase();
      if (bunkName.startsWith('B-')) {
        areas.boys.push(bunkWithCampers);
      } else if (bunkName.startsWith('G-')) {
        areas.girls.push(bunkWithCampers);
      } else if (bunkName.startsWith('AG-')) {
        areas['all-gender'].push(bunkWithCampers);
      }
    });

    // Sort bunks within each area
    Object.keys(areas).forEach(area => {
      areas[area as BunkArea].sort((a, b) => {
        // Extract the part after the dash
        const aPart = a.name.split('-')[1] || '';
        const bPart = b.name.split('-')[1] || '';
        
        // Check if parts are numeric
        const aIsNumeric = /^\d+/.test(aPart);
        const bIsNumeric = /^\d+/.test(bPart);
        
        // Non-numeric names (like Aleph, Bet) come first
        if (!aIsNumeric && bIsNumeric) return -1;
        if (aIsNumeric && !bIsNumeric) return 1;
        
        // If both are numeric, sort numerically
        if (aIsNumeric && bIsNumeric) {
          // For numeric parts, extract the full number (including suffixes like A, B)
          const aMatch = aPart.match(/^(\d+)(.*)$/);
          const bMatch = bPart.match(/^(\d+)(.*)$/);
          
          if (aMatch && bMatch) {
            const aNumStr = aMatch[1];
            const bNumStr = bMatch[1];
            if (!aNumStr || !bNumStr) {
              return 0;
            }
            const aNum = parseInt(aNumStr);
            const bNum = parseInt(bNumStr);
            
            // Compare numbers first
            if (aNum !== bNum) {
              return aNum - bNum;
            }
            
            // If numbers are equal, compare suffixes (e.g., 6A vs 6B)
            const aSuffix = aMatch[2];
            const bSuffix = bMatch[2];
            if (aSuffix === undefined || bSuffix === undefined) {
              return 0;
            }
            return aSuffix.localeCompare(bSuffix);
          }
        }
        
        // If both are non-numeric, sort alphabetically
        return aPart.localeCompare(bPart);
      });
    });

    return areas;
  };
  
  const bunksByArea = getBunksByArea();

  // Get displayed bunks based on selected area
  // React Compiler will optimize this computation
  const getDisplayedBunks = () => {
    if (selectedArea === 'all') {
      return [...bunksByArea.boys, ...bunksByArea.girls, ...bunksByArea['all-gender']];
    }
    return bunksByArea[selectedArea];
  };
  
  const displayedBunks = getDisplayedBunks();

  // Get unassigned campers
  // React Compiler will optimize this computation
  const getUnassignedCampers = () => {
    const unassigned = campers.filter(c => !c.assigned_bunk);
    
    // If showing all areas, return all unassigned campers
    if (selectedArea === 'all') {
      return unassigned;
    }
    
    // The campers are already filtered by session in the parent component
    // Now we need to filter by area type
    return unassigned.filter(camper => {
      // For AG area, we want to show AG bunks, which means we're viewing a main session
      // and the AG campers are included from AG sessions
      if (selectedArea === 'all-gender') {
        // Only show campers from AG sessions (any gender allowed in AG)
        return camper.expand?.session?.session_type === 'ag';
      }

      // For boys/girls areas in main or embedded sessions
      // AG session campers should NOT appear in boys/girls areas
      const isFromAGSession = camper.expand?.session?.session_type === 'ag';
      
      if (isFromAGSession) {
        // AG campers should only appear in AG area, not in boys/girls areas
        return false;
      }
      
      // For non-AG campers, filter by gender
      if (selectedArea === 'boys') {
        return camper.gender === 'M';
      } else if (selectedArea === 'girls') {
        return camper.gender === 'F';
      }
      
      return true;
    });
  };
  
  const unassignedCampers = getUnassignedCampers();

  const handleCamperClick = (camper: Camper) => {
    // Use transition to defer non-critical update
    startTransition(() => {
      setSelectedCamperId(String(camper.person_cm_id));
    });
  };

  const handleCamperUnassign = async (camper: Camper) => {
    // Only allow in draft mode
    if (!isDraftMode) return;

    try {
      await onCamperMove(camper.id, null);
      toast.success(`Unassigned ${camper.name}`);
    } catch (error) {
      console.error('Failed to unassign camper:', error);
      toast.error('Failed to unassign camper');
    }
  };

  const handleCamperLockToggle = (camper: Camper) => {
    // Only allow in draft mode
    if (!isDraftMode) return;

    const lockState = getCamperLockState(camper.person_cm_id);
    if (lockState === 'pending') {
      // Already pending - remove from selection
      removePendingCamper(camper.id);
    } else if (lockState === 'none') {
      // Not in a group - add to pending selection
      addPendingCamper(camper);
    } else if (lockState === 'locked') {
      // Already in a group - open panel and select the group
      const group = getCamperLockGroup(camper.person_cm_id);
      if (group) {
        setSelectedGroupId(group.id);
        setIsLockPanelOpen(true);
      }
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveId(active.id as string);
    setIsDragging(true);

    const camper = campers.find(c => c.id === active.id);
    if (camper) {
      // Check if camper is in a lock group - track all members for the overlay
      const lockState = getCamperLockState(camper.person_cm_id);
      if (lockState === 'locked') {
        const group = getCamperLockGroup(camper.person_cm_id);
        if (group) {
          const memberCmIds = getGroupMembers(group.id);
          // Get other group members (excluding the dragged camper)
          const otherMembers = campers.filter(
            c => memberCmIds.includes(c.person_cm_id) && c.id !== camper.id
          );
          setDraggedGroupMembers(otherMembers);
        }
      } else {
        setDraggedGroupMembers([]);
      }

      // Show warning if in production mode
      if (isProductionMode) {
        toast('⚠️ Production Mode: Changes will be overwritten by sync', {
          duration: 5000,
          style: {
            background: '#FEF3C7',
            color: '#92400E',
            border: '2px solid #FCD34D',
          },
        });
      }

      setActiveDragItem({
        id: active.id as string,
        type: 'camper',
        camper,
        sourceBunkId: camper.assigned_bunk || '',
      });
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setActiveDragItem(null);
    setIsDragging(false);
    setDraggedGroupMembers([]);

    if (!over || active.id === over.id) {
      return;
    }

    const camperId = active.id as string;
    const targetId = over.id as string;

    let targetBunkId: string | null = null;

    if (targetId === 'unassigned') {
      targetBunkId = null;
    } else if (targetId.startsWith('bunk-')) {
      targetBunkId = targetId.replace('bunk-', '');
    } else {
      const targetCamper = campers.find(c => c.id === targetId);
      if (targetCamper?.assigned_bunk) {
        targetBunkId = targetCamper.assigned_bunk;
      }
    }

    // No-op detection: if camper is already in the target location, do nothing silently
    const sourceCamperForNoop = campers.find(c => c.id === camperId);
    const currentBunkId = sourceCamperForNoop?.assigned_bunk || null;
    if (currentBunkId === targetBunkId) {
      // Already in the same place - no action needed
      return;
    }

    // Bunk locking has been removed - lock groups handle keeping campers together

    // Validate gender compatibility before attempting move
    if (targetBunkId) {
      const targetBunk = displayedBunks.find(b => b.id === targetBunkId);
      const sourceCamper = campers.find(c => c.id === camperId);

      if (targetBunk && sourceCamper) {
        const bunkGender = targetBunk.gender?.toLowerCase();
        const isFromAGSession = sourceCamper.expand?.session?.session_type === 'ag';

        let isValidGender = true;

        if (isFromAGSession) {
          // AG campers can only go to Mixed (AG) bunks
          isValidGender = bunkGender === 'mixed';
        } else {
          // Non-AG campers must go to matching gendered bunks
          if (sourceCamper.gender === 'M') {
            isValidGender = bunkGender === 'm' || targetBunk.name?.startsWith('B-');
          } else if (sourceCamper.gender === 'F') {
            isValidGender = bunkGender === 'f' || targetBunk.name?.startsWith('G-');
          }
        }

        if (!isValidGender) {
          toast.error(`Cannot place ${sourceCamper.gender === 'M' ? 'male' : 'female'} camper in ${targetBunk.name}`);
          return;
        }
      }
    }

    // Check capacity (allow up to 14, but warn at 12)
    if (targetBunkId) {
      const targetBunk = displayedBunks.find(b => b.id === targetBunkId);
      if (targetBunk && targetBunk.occupancy >= 14) {
        const sourceCamper = campers.find(c => c.id === camperId);
        if (sourceCamper?.assigned_bunk !== targetBunkId) {
          toast.error('Target bunk has reached maximum capacity (14 campers)');
          return;
        }
      } else if (targetBunk && targetBunk.occupancy >= targetBunk.capacity) {
        // Still allow move but show warning
        const sourceCamper = campers.find(c => c.id === camperId);
        if (sourceCamper?.assigned_bunk !== targetBunkId) {
          toast('⚠️ Warning: Bunk will exceed standard capacity (12 campers)', {
            style: {
              background: '#FEF3C7',
              color: '#92400E',
            },
          });
        }
      }
    }

    // Check if camper is in a lock group - if so, move all group members together
    const sourceCamper = campers.find(c => c.id === camperId);
    const lockState = sourceCamper ? getCamperLockState(sourceCamper.person_cm_id) : 'none';

    let campersToMove: Camper[] = sourceCamper ? [sourceCamper] : [];

    if (lockState === 'locked' && sourceCamper) {
      const group = getCamperLockGroup(sourceCamper.person_cm_id);
      if (group) {
        const memberCmIds = getGroupMembers(group.id);
        campersToMove = campers.filter(c => memberCmIds.includes(c.person_cm_id));

        if (campersToMove.length > 1) {
          toast(`Moving ${campersToMove.length} campers as a group`, {
            duration: 2000,
            icon: '👥'
          });
        }
      }
    }

    try {
      // Move all campers in the group
      for (const camper of campersToMove) {
        await onCamperMove(camper.id, targetBunkId);
      }
      // Success toast moved to parent component after actual move completes
    } catch (error) {
      toast.error('Failed to move camper(s)');
      console.error('Error moving camper(s):', error);
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setActiveDragItem(null);
    setIsDragging(false);
    setDraggedGroupMembers([]);
  };


  // Handle closing details panel (called after animation completes)
  const handleCloseDetails = () => {
    setSelectedCamperId(null);
    setRequestCloseDetails(false);
  };

  // Request animated close of details panel
  const requestAnimatedCloseDetails = useCallback(() => {
    if (selectedCamperId) {
      setRequestCloseDetails(true);
    }
  }, [selectedCamperId]);

  // Request animated close of lock panel
  const requestAnimatedCloseLockPanel = useCallback(() => {
    if (isLockPanelOpen) {
      setRequestCloseLockPanel(true);
    }
  }, [isLockPanelOpen]);

  // Handle close of lock panel (called after animation completes)
  const handleCloseLockPanel = () => {
    setIsLockPanelOpen(false);
    setSelectedGroupId(null);
    setRequestCloseLockPanel(false);
  };

  // Close all panels when clicking on empty board space
  const handleBoardClick = (e: React.MouseEvent) => {
    // Only close if clicking directly on the grid container, not on a child (bunk card)
    if (e.target === e.currentTarget) {
      requestAnimatedCloseDetails();
      requestAnimatedCloseLockPanel();
    }
  };

  // Check if any panel is open
  const isAnyPanelOpen = !!selectedCamperId || isLockPanelOpen;

  // Close panels when clicking on dead space (nav, page sides, board gaps)
  // Uses document-level handler to avoid blocking right-clicks and other interactions
  const handleGlobalClick = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement;

    // Don't close if clicking on:
    // 1. A panel itself
    // 2. An interactive element (button, link, input, etc.)
    // 3. Context menu, dropdown, or other UI elements
    // 4. Camper/bunk cards (user is interacting with the board)
    const isOnPanel = target.closest('[data-panel="camper-details"], [data-panel="lock-group"]');
    const isOnFloatingBadge = target.closest('[data-floating-badge]');
    const isInteractive = target.closest('button, a, input, select, textarea, [role="button"], [role="menu"], [role="menuitem"]');
    const isContextMenu = target.closest('[data-context-menu]');
    const isModal = target.closest('[role="dialog"]');
    const isCard = target.closest('[data-camper-card], [data-bunk-card]');

    if (isOnPanel || isOnFloatingBadge || isInteractive || isContextMenu || isModal || isCard) {
      return;
    }

    // Close all panels with animation
    requestAnimatedCloseDetails();
    requestAnimatedCloseLockPanel();
  }, [requestAnimatedCloseDetails, requestAnimatedCloseLockPanel]);

  // Set up global click listener when panels are open
  // Small delay prevents catching the click that opened the panel
  useEffect(() => {
    if (!isAnyPanelOpen) return;

    // Add listener after a microtask to avoid catching the opening click
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleGlobalClick);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleGlobalClick);
    };
  }, [isAnyPanelOpen, handleGlobalClick]);

  return (
    <>
    <DndContext
      sensors={sensors}
      collisionDetection={customCollisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* Main bunks area */}
      <div>
        {/* Bunks Grid - 4 columns, full width */}
        {displayedBunks.length === 0 ? (
          <div className="bg-card rounded-xl border border-border p-8 text-center">
            <Home className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground font-medium">No bunks in this area</p>
          </div>
        ) : (
          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
            style={{ contain: 'layout style' }}
            onClick={handleBoardClick}
          >
            {displayedBunks.map(bunk => (
              <BunkCard
                key={bunk.id}
                bunk={bunk}
                onCamperClick={handleCamperClick}
                onCamperLockToggle={handleCamperLockToggle}
                onCamperUnassign={handleCamperUnassign}
                onShowSocialGraph={() => {
                  startTransition(() => {
                    setSelectedBunkForGraph({ cmId: bunk.cm_id, name: bunk.name });
                  });
                }}
                isDragging={isDragging}
                isProductionMode={isProductionMode}
                defaultCapacity={defaultCapacity}
                activeDragCamper={activeDragItem?.camper ?? null}
              />
            ))}
          </div>
        )}
      </div>

      {/* Floating Unassigned Badge */}
      <FloatingUnassignedBadge
        campers={unassignedCampers}
        onCamperClick={handleCamperClick}
        isExpanded={isUnassignedExpanded}
        onToggle={() => setIsUnassignedExpanded(!isUnassignedExpanded)}
        onClose={() => setIsUnassignedExpanded(false)}
        isPanelOpen={!!selectedCamperId}
      />

      {/* Drag Overlay - Shows group members when dragging locked groups */}
      <DragOverlay>
        {activeDragItem ? (
          <div className="relative">
            {/* Stacked cards for other group members (behind) */}
            {draggedGroupMembers.slice(0, 3).map((member, index) => (
              <div
                key={member.id}
                className="absolute p-2 rounded-md border bg-white dark:bg-gray-800 shadow-md"
                style={{
                  top: (index + 1) * 6,
                  left: (index + 1) * 6,
                  zIndex: -index - 1,
                  opacity: 0.7 - index * 0.15,
                  transform: `rotate(${3 + (index + 1) * 2}deg)`,
                }}
              >
                <div className="font-medium text-sm">{member.name}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  {formatGradeOrdinal(member.grade)}
                </div>
              </div>
            ))}

            {/* Main dragged camper card (on top) */}
            <div className="opacity-90 rotate-3 relative z-10">
              <div className="p-2 rounded-md border bg-white dark:bg-gray-800 shadow-lg">
                <div className="font-medium text-sm">{activeDragItem.camper.name}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  {formatGradeOrdinal(activeDragItem.camper.grade)}
                </div>
              </div>
              {/* Badge showing total group size */}
              {draggedGroupMembers.length > 0 && (
                <div className="absolute -top-2 -right-2 bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow-lg">
                  {draggedGroupMembers.length + 1}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>

    {/* Camper Details Panel - Slides in from right */}
    {selectedCamperId && (
      <CamperDetailsPanel
        camperId={selectedCamperId}
        onClose={handleCloseDetails}
        requestClose={requestCloseDetails}
      />
    )}

    {/* Bunk Social Graph Modal - lazy loaded */}
    {selectedBunkForGraph && (
      <Suspense fallback={null}>
        <BunkSocialGraphModal
          bunkCmId={selectedBunkForGraph.cmId}
          bunkName={selectedBunkForGraph.name}
          sessionCmId={sessionCmId}
          year={currentYear}
          isOpen={true}
          onClose={() => setSelectedBunkForGraph(null)}
          onBunkChange={(cmId, name) => setSelectedBunkForGraph({ cmId, name })}
        />
      </Suspense>
    )}

    {/* Lock Group Action Bar - only shown in draft mode with pending selections (lazy loaded) */}
    {isDraftMode && scenarioId && lockGroupSessionPbId && pendingCampers.length > 0 && (
      <Suspense fallback={null}>
        <LockGroupActionBar
          pendingCampers={pendingCampers}
          sessionPbId={lockGroupSessionPbId}
          scenarioId={scenarioId}
          year={currentYear}
          onClearPending={clearPendingCampers}
          onGroupCreated={() => {
            toast.success('Lock group created successfully');
          }}
        />
      </Suspense>
    )}

    {/* Friend Groups Hub - always visible in draft mode (lazy loaded) */}
    {isDraftMode && scenarioId && lockGroupSessionPbId && (
      <Suspense fallback={null}>
        <LockGroupsHub
          groups={groups}
          membersByGroup={membersByGroup}
          pendingCampers={pendingCampers}
          selectedArea={selectedArea}
          campers={campers}
          onOpenPanel={() => setIsLockPanelOpen(true)}
          isDraftMode={isDraftMode}
        />
      </Suspense>
    )}

    {/* Lock Group Panel (lazy loaded) */}
    {isDraftMode && scenarioId && lockGroupSessionPbId && (
      <Suspense fallback={null}>
        <LockGroupPanel
          isOpen={isLockPanelOpen}
          onClose={handleCloseLockPanel}
          sessionPbId={lockGroupSessionPbId}
          scenarioId={scenarioId}
          selectedGroupId={selectedGroupId}
          onGroupSelect={setSelectedGroupId}
          requestClose={requestCloseLockPanel}
          selectedArea={selectedArea}
          campers={campers}
        />
      </Suspense>
    )}
    </>
  );
}