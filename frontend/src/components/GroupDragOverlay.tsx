import CamperCard from './CamperCard'
import type { Camper } from '../types/app-types'

interface GroupDragOverlayProps {
  activeCamper: Camper
  groupMembers: Camper[]
  groupColor?: string
}

function GroupDragOverlay({ activeCamper, groupMembers, groupColor }: GroupDragOverlayProps) {
  const isGroup = groupMembers.length > 1

  if (!isGroup) {
    // Single camper drag - just show the camper card
    return (
      <div className="cursor-move">
        <CamperCard camper={activeCamper} isDraggable={false} isDragging={true} />
      </div>
    )
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
      <div className="bg-primary text-primary-foreground border-background absolute -top-2 -right-2 z-40 flex h-8 min-w-8 items-center justify-center rounded-full border-2 px-2 text-sm font-bold shadow-lg">
        {groupMembers.length}
      </div>

      {/* Stacked cards effect to show it's a group */}
      {groupMembers.length > 1 && (
        <div
          className="bg-background border-border absolute top-2 right-0 bottom-0 left-2 z-20 rounded-lg border opacity-80 shadow-md"
          style={{ transform: 'translate(8px, 8px)' }}
        />
      )}
      {groupMembers.length > 2 && (
        <div
          className="bg-background border-border absolute top-4 right-0 bottom-0 left-4 z-10 rounded-lg border opacity-60 shadow-md"
          style={{ transform: 'translate(16px, 16px)' }}
        />
      )}

      {/* Optional: Show mini avatars of other group members */}
      {groupMembers.length <= 5 && (
        <div className="absolute right-0 -bottom-2 left-0 z-40 flex justify-center gap-1">
          {groupMembers.slice(1, 4).map((member) => (
            <div
              key={member.id}
              className="bg-muted border-background flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-medium shadow-sm"
              title={member.name}
            >
              {member.name.charAt(0)}
            </div>
          ))}
          {groupMembers.length > 4 && (
            <div className="bg-muted border-background flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-medium shadow-sm">
              +{groupMembers.length - 4}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default GroupDragOverlay
