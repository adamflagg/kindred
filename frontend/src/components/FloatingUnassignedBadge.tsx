/**
 * Summer's unassigned campers, over the shared corner queue.
 *
 * Everything camper-shaped stays here — the droppable, the request-status
 * lookup, the lock-group colouring, the card itself. The chrome is
 * FloatingQueueBadge's, so the weekend's equivalent cannot drift away from it.
 */
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CircleCheck } from 'lucide-react'

import { useLockGroupContext } from '../contexts/LockGroupContext'
import { useBunkRequestsFromContext } from '../hooks'
import type { Camper } from '../types/app-types'
import CamperCard from './CamperCard'
import { FloatingQueueBadge } from './ui'

interface FloatingUnassignedBadgeProps {
  campers: Camper[]
  onCamperClick: (camper: Camper) => void
  isExpanded: boolean
  onToggle: () => void
  onClose: () => void
  isPanelOpen?: boolean
  isProductionMode?: boolean
}

// Module-level so their identity is stable: they are memo dependencies inside
// the shell, and an inline arrow would re-sort and re-filter every render.
const sortKey = (camper: Camper): string[] => [
  camper.last_name ?? camper.name.split(' ').pop() ?? '',
  camper.first_name ?? camper.name.split(' ')[0] ?? '',
]

const getSearchText = (camper: Camper): string =>
  [camper.name, camper.first_name, camper.last_name, camper.preferred_name]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')

const EMPTY_STATE = (
  <div className="flex h-full flex-col items-center justify-center py-8 text-center">
    <div className="bg-primary/10 mb-3 flex h-12 w-12 items-center justify-center rounded-full">
      <CircleCheck className="text-primary h-6 w-6" />
    </div>
    <p className="text-foreground font-medium">All campers assigned!</p>
    <p className="text-muted-foreground mt-1 text-sm">Drag campers here to unassign</p>
  </div>
)

const FOOTER = (
  <p className="text-accent-foreground text-xs">
    <strong>Tip:</strong> Drag campers to bunks to assign
  </p>
)

export default function FloatingUnassignedBadge({
  campers,
  onCamperClick,
  isExpanded,
  onToggle,
  onClose,
  isPanelOpen = false,
  isProductionMode = false,
}: FloatingUnassignedBadgeProps) {
  const { setNodeRef, isOver } = useDroppable({ id: 'unassigned', disabled: isProductionMode })

  const camperPersonIds = campers.map((c) => c.person_cm_id)
  const { data: requestStatus } = useBunkRequestsFromContext(camperPersonIds)
  const { getCamperLockState, getCamperLockGroupColor, isDraftMode } = useLockGroupContext()

  return (
    <FloatingQueueBadge
      items={campers}
      sortKey={sortKey}
      getSearchText={getSearchText}
      renderList={(visible) => (
        <div className="space-y-2">
          <SortableContext items={visible.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {visible.map((camper) => (
              <CamperCard
                key={camper.id}
                camper={camper}
                isDraggable={!isProductionMode}
                isProductionMode={isProductionMode}
                // Deliberately does NOT close: the popover shifts left to make
                // room for the details panel instead.
                onClick={onCamperClick}
                hasRequests={requestStatus[camper.person_cm_id] ?? true}
                lockState={isDraftMode ? getCamperLockState(camper.person_cm_id) : 'none'}
                lockGroupColor={
                  isDraftMode ? getCamperLockGroupColor(camper.person_cm_id) : undefined
                }
                isDraftMode={isDraftMode}
              />
            ))}
          </SortableContext>
        </div>
      )}
      label="Unassigned"
      noun="campers"
      cardSelector="[data-camper-card]"
      emptyState={EMPTY_STATE}
      footer={FOOTER}
      isExpanded={isExpanded}
      onToggle={onToggle}
      onClose={onClose}
      isPanelOpen={isPanelOpen}
      listRef={setNodeRef}
      isDropTarget={isOver}
    />
  )
}
