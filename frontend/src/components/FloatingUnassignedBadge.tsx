import { useRef, useEffect, useCallback } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import clsx from 'clsx'
import { UserRoundSearch, Users, X, CircleCheck } from 'lucide-react'
import type { Camper } from '../types/app-types'
import CamperCard from './CamperCard'
import { useBunkRequestsFromContext } from '../hooks'
import { useLockGroupContext } from '../contexts/LockGroupContext'

interface FloatingUnassignedBadgeProps {
  campers: Camper[]
  onCamperClick: (camper: Camper) => void
  isExpanded: boolean
  onToggle: () => void
  onClose: () => void
  isPanelOpen?: boolean
}

export default function FloatingUnassignedBadge({
  campers,
  onCamperClick,
  isExpanded,
  onToggle,
  onClose,
  isPanelOpen = false,
}: FloatingUnassignedBadgeProps) {
  const popoverRef = useRef<HTMLDivElement>(null)

  // Set up droppable for the unassigned area
  const { setNodeRef, isOver } = useDroppable({
    id: 'unassigned',
  })

  // Sort campers by lastname (alpha), then firstname
  const sortedCampers = [...campers].sort((a, b) => {
    const lastNameA = a.last_name ?? a.name.split(' ').pop() ?? ''
    const lastNameB = b.last_name ?? b.name.split(' ').pop() ?? ''
    const lastNameCompare = lastNameA.localeCompare(lastNameB)
    if (lastNameCompare !== 0) return lastNameCompare

    const firstNameA = a.first_name ?? a.name.split(' ')[0] ?? ''
    const firstNameB = b.first_name ?? b.name.split(' ')[0] ?? ''
    return firstNameA.localeCompare(firstNameB)
  })

  // Get bunk request status for all unassigned campers
  const camperPersonIds = campers.map((c) => c.person_cm_id)
  const { data: requestStatus } = useBunkRequestsFromContext(camperPersonIds)

  // Get lock group context for draft mode
  const { getCamperLockState, getCamperLockGroupColor, isDraftMode } = useLockGroupContext()

  // Handle click outside to close (but not when panel is open - user is viewing details)
  const handleClickOutside = useCallback(
    (event: MouseEvent) => {
      const target = event.target as HTMLElement

      // Never close when clicking on a camper card (user is about to view details)
      if (target.closest('[data-camper-card]')) {
        return
      }

      if (
        isExpanded &&
        !isPanelOpen && // Don't close if camper details panel is open
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        onClose()
      }
    },
    [isExpanded, isPanelOpen, onClose]
  )

  // Handle ESC key to close
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isExpanded) {
        onClose()
      }
    },
    [isExpanded, onClose]
  )

  useEffect(() => {
    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isExpanded, handleClickOutside, handleKeyDown])

  // Handle camper click - show details but keep popover open (shifted left)
  const handleCamperClick = (camper: Camper) => {
    onCamperClick(camper)
    // Don't close - the popover shifts left to make room for the details panel
  }

  return (
    <div
      data-floating-badge
      className="fixed right-6 bottom-14 z-[70] transition-transform duration-300"
      style={{ transform: isPanelOpen ? 'translateX(-28.5rem)' : 'none' }}
      ref={popoverRef}
    >
      {/* Collapsed Badge */}
      {!isExpanded && (
        <button
          onClick={onToggle}
          className={clsx(
            'shadow-lodge-lg relative flex h-14 w-14 items-center justify-center rounded-full transition-all',
            'hover:shadow-lodge-xl hover:scale-105 active:scale-95',
            'bg-primary text-primary-foreground border-primary-foreground/20 border-2'
          )}
          title={`${campers.length} unassigned campers`}
        >
          {campers.length > 0 ? (
            <>
              <UserRoundSearch className="h-6 w-6" />
              <span className="bg-accent text-accent-foreground absolute -top-1 -right-1 flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1 text-xs font-bold shadow-md">
                {campers.length > 99 ? '99+' : campers.length}
              </span>
            </>
          ) : (
            <CircleCheck className="h-6 w-6" />
          )}
        </button>
      )}

      {/* Expanded Popover */}
      {isExpanded && (
        <div
          className={clsx(
            'card-lodge shadow-lodge-xl animate-scale-in flex max-h-[70vh] w-80 max-w-[calc(100vw-3rem)] flex-col',
            'border-2',
            isOver ? 'border-primary' : 'border-border'
          )}
        >
          {/* Header */}
          <div className="border-border bg-muted/30 flex flex-shrink-0 items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <Users className="text-muted-foreground h-5 w-5" />
              <span className="font-semibold">
                Unassigned
                <span className="text-muted-foreground ml-1.5 text-sm font-normal">
                  ({campers.length})
                </span>
              </span>
            </div>
            <button
              onClick={onClose}
              className="hover:bg-muted rounded-lg p-1.5 transition-colors"
              title="Close"
            >
              <X className="text-muted-foreground h-4 w-4" />
            </button>
          </div>

          {/* Camper List - Droppable area */}
          <div
            ref={setNodeRef}
            className={clsx('min-h-[200px] flex-1 overflow-y-auto p-3', isOver && 'bg-primary/5')}
          >
            {campers.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center py-8 text-center">
                <div className="bg-primary/10 mb-3 flex h-12 w-12 items-center justify-center rounded-full">
                  <CircleCheck className="text-primary h-6 w-6" />
                </div>
                <p className="text-foreground font-medium">All campers assigned!</p>
                <p className="text-muted-foreground mt-1 text-sm">Drag campers here to unassign</p>
              </div>
            ) : (
              <div className="space-y-2">
                <SortableContext
                  items={sortedCampers.map((c) => c.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {sortedCampers.map((camper) => (
                    <CamperCard
                      key={camper.id}
                      camper={camper}
                      onClick={handleCamperClick}
                      hasRequests={requestStatus[camper.person_cm_id] ?? true}
                      bunkCampers={[]}
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
          </div>

          {/* Footer Tip */}
          {campers.length > 0 && (
            <div className="border-border bg-accent/10 flex-shrink-0 border-t px-3 py-2">
              <p className="text-accent-foreground text-xs">
                <strong>Tip:</strong> Drag campers to bunks to assign
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
