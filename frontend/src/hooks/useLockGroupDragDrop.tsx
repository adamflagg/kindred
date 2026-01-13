import { useState, useCallback, useMemo } from 'react';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import { toast } from 'react-hot-toast';
import { useLockGroupContext } from '../contexts/LockGroupContext';
import type { Camper, DragItem } from '../types/app-types';

interface LockGroupDragDropOptions {
  campers: Camper[];
  onCamperMove: (camperId: string, toBunkId: string | null) => Promise<void>;
  isProductionMode?: boolean;
  onDragStart?: (event: DragStartEvent) => void;
  onDragEnd?: (event: DragEndEvent) => void;
  onDragCancel?: () => void;
}

export function useLockGroupDragDrop({
  campers,
  onCamperMove,
  isProductionMode: _isProductionMode = false,
  onDragStart: onDragStartCallback,
  onDragEnd: onDragEndCallback,
  onDragCancel: onDragCancelCallback
}: LockGroupDragDropOptions) {
  // Note: _isProductionMode is kept for API compatibility but production mode
  // dragging is now disabled at the component level
  const { getCamperLockGroup, getGroupMembers, getCamperLockState } = useLockGroupContext();
  const [activeDragItem, setActiveDragItem] = useState<DragItem | null>(null);
  const [draggedGroupMembers, setDraggedGroupMembers] = useState<Camper[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Get all campers in the same lock group
  const getCampersInSameGroup = useCallback((camper: Camper): Camper[] => {
    const group = getCamperLockGroup(camper.person_cm_id);
    if (!group) return [camper];

    const memberCmIds = getGroupMembers(group.id);
    return campers.filter(c => memberCmIds.includes(c.person_cm_id));
  }, [campers, getCamperLockGroup, getGroupMembers]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    setIsDragging(true);

    const camper = campers.find(c => c.id === active.id);
    if (!camper) return;

    // Check if camper is in a lock group
    const lockState = getCamperLockState(camper.person_cm_id);
    
    if (lockState === 'locked') {
      // Get all members of the lock group - they move together
      const groupMembers = getCampersInSameGroup(camper);
      setDraggedGroupMembers(groupMembers);

      // Show group drag notification
      toast.success(`Moving group of ${groupMembers.length} campers`, {
        duration: 2000,
        icon: '👥'
      });
    } else {
      // Single camper drag
      setDraggedGroupMembers([camper]);
    }

    // Production mode dragging is now disabled at the component level

    setActiveDragItem({
      id: active.id as string,
      type: 'camper',
      camper,
      sourceBunkId: camper.assigned_bunk || '',
    });

    // Call the original onDragStart if provided
    onDragStartCallback?.(event);
  }, [campers, getCamperLockState, getCampersInSameGroup, onDragStartCallback]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    setIsDragging(false);
    setActiveDragItem(null);

    if (!over || active.id === over.id) {
      setDraggedGroupMembers([]);
      return;
    }

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

    // Move all group members
    const activeCamper = campers.find(c => c.id === active.id);
    const campersToMove = draggedGroupMembers.length > 0 ? draggedGroupMembers : (activeCamper ? [activeCamper] : []);
    
    if (campersToMove.length > 1) {
      toast(`Moving ${campersToMove.length} locked campers together...`, {
        duration: 2000,
        icon: '🔄'
      });
    }

    try {
      // Move all campers in the group
      for (const camper of campersToMove) {
        if (camper) {
          await onCamperMove(camper.id, targetBunkId);
        }
      }
      
      if (campersToMove.length > 1) {
        toast.success(`Moved ${campersToMove.length} campers as a group`);
      }
    } catch (error) {
      toast.error('Failed to move campers');
      console.error('Error moving campers:', error);
    }

    setDraggedGroupMembers([]);
    
    // Call the original onDragEnd if provided
    onDragEndCallback?.(event);
  }, [draggedGroupMembers, campers, onCamperMove, onDragEndCallback]);

  const handleDragCancel = useCallback(() => {
    setIsDragging(false);
    setActiveDragItem(null);
    setDraggedGroupMembers([]);
    
    // Call the original onDragCancel if provided
    onDragCancelCallback?.();
  }, [onDragCancelCallback]);

  // Create a custom drag overlay that shows all group members
  const dragOverlay = useMemo(() => {
    if (!activeDragItem || draggedGroupMembers.length <= 1) {
      return null;
    }

    return (
      <div className="relative">
        {/* Main camper card */}
        <div className="opacity-90">
          {/* This would be your CamperCard component */}
          <div className="p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border-2 border-primary">
            <div className="font-medium">{activeDragItem.camper?.name}</div>
          </div>
        </div>
        
        {/* Badge showing group size */}
        <div className="absolute -top-2 -right-2 bg-primary text-primary-foreground rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold shadow-lg">
          {draggedGroupMembers.length}
        </div>
        
        {/* Stacked cards effect */}
        <div className="absolute top-2 left-2 w-full h-full bg-white dark:bg-gray-800 rounded-lg shadow-md opacity-60 -z-10" />
        <div className="absolute top-4 left-4 w-full h-full bg-white dark:bg-gray-800 rounded-lg shadow-md opacity-40 -z-20" />
      </div>
    );
  }, [activeDragItem, draggedGroupMembers]);

  return {
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    activeDragItem,
    draggedGroupMembers,
    isDragging,
    dragOverlay
  };
}

export default useLockGroupDragDrop;