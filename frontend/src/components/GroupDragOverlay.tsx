import CamperCard from './CamperCard';
import type { Camper } from '../types/app-types';

interface GroupDragOverlayProps {
  activeCamper: Camper;
  groupMembers: Camper[];
  groupColor?: string;
}

function GroupDragOverlay({ activeCamper, groupMembers, groupColor }: GroupDragOverlayProps) {
  const isGroup = groupMembers.length > 1;

  if (!isGroup) {
    // Single camper drag - just show the camper card
    return (
      <div className="cursor-move">
        <CamperCard
          camper={activeCamper}
          isDraggable={false}
          isDragging={true}
        />
      </div>
    );
  }

  // Group drag - show stacked effect with count
  return (
    <div className="relative cursor-move">
      {/* Main camper card */}
      <div className="relative z-30">
        <CamperCard
          camper={activeCamper}
          isDraggable={false}
          isDragging={true}
          lockState="locked"
          {...(groupColor && { lockGroupColor: groupColor })}
        />
      </div>
      
      {/* Group size badge */}
      <div className="absolute -top-2 -right-2 z-40 bg-primary text-primary-foreground rounded-full min-w-8 h-8 px-2 flex items-center justify-center text-sm font-bold shadow-lg border-2 border-background">
        {groupMembers.length}
      </div>
      
      {/* Stacked cards effect to show it's a group */}
      {groupMembers.length > 1 && (
        <div 
          className="absolute top-2 left-2 right-0 bottom-0 bg-background rounded-lg shadow-md border border-border opacity-80 z-20"
          style={{ transform: 'translate(8px, 8px)' }}
        />
      )}
      {groupMembers.length > 2 && (
        <div 
          className="absolute top-4 left-4 right-0 bottom-0 bg-background rounded-lg shadow-md border border-border opacity-60 z-10"
          style={{ transform: 'translate(16px, 16px)' }}
        />
      )}
      
      {/* Optional: Show mini avatars of other group members */}
      {groupMembers.length <= 5 && (
        <div className="absolute -bottom-2 left-0 right-0 flex justify-center gap-1 z-40">
          {groupMembers.slice(1, 4).map((member) => (
            <div
              key={member.id}
              className="w-6 h-6 rounded-full bg-muted border-2 border-background flex items-center justify-center text-xs font-medium shadow-sm"
              title={member.name}
            >
              {member.name.charAt(0)}
            </div>
          ))}
          {groupMembers.length > 4 && (
            <div className="w-6 h-6 rounded-full bg-muted border-2 border-background flex items-center justify-center text-xs font-medium shadow-sm">
              +{groupMembers.length - 4}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default GroupDragOverlay;