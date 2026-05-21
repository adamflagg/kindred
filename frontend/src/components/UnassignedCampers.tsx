import { useMemo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import clsx from 'clsx'
import type { Camper } from '../types/app-types'
import CamperCard from './CamperCard'
import { useBunkRequestsFromContext } from '../hooks'
import { getDisplayAgeForYear } from '../utils/displayAge'
import { useYear } from '../hooks/useCurrentYear'

interface UnassignedCampersProps {
  campers: Camper[]
  onCamperClick?: (camper: Camper) => void
  embedded?: boolean // When true, hide header and adjust for sidebar
  isProductionMode?: boolean
}

export default function UnassignedCampers({
  campers,
  onCamperClick,
  embedded = false,
  isProductionMode = false,
}: UnassignedCampersProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'unassigned',
    disabled: isProductionMode,
  })
  const viewingYear = useYear()

  // Sort campers by age (youngest to oldest)
  const sortedCampers = useMemo(() => {
    return campers.toSorted(
      (a, b) =>
        (getDisplayAgeForYear(a, viewingYear) ?? 0) - (getDisplayAgeForYear(b, viewingYear) ?? 0)
    )
  }, [campers, viewingYear])

  // Get bunk request status for all unassigned campers
  const camperPersonIds = campers.map((c) => c.person_cm_id)
  const { data: requestStatus } = useBunkRequestsFromContext(camperPersonIds)

  return (
    <div className={embedded ? 'flex h-full flex-col' : 'lg:sticky lg:top-4'}>
      {!embedded && (
        <h2 className="mb-4 text-lg font-semibold sm:text-xl">
          Unassigned Campers ({campers.length})
        </h2>
      )}
      <div
        ref={setNodeRef}
        className={clsx(
          'overflow-y-auto rounded-xl border-2 border-dashed p-3',
          embedded
            ? 'min-h-0 flex-1'
            : 'max-h-[400px] min-h-[300px] lg:max-h-[calc(100vh-200px)] lg:min-h-[400px]',
          isOver ? 'border-primary bg-primary/5' : 'border-border/50 bg-muted/30'
        )}
      >
        {campers.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center">All campers are assigned! 🎉</p>
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
                  isDraggable={!isProductionMode}
                  isProductionMode={isProductionMode}
                  {...(onCamperClick && { onClick: onCamperClick })}
                  hasRequests={requestStatus[camper.person_cm_id] ?? true}
                />
              ))}
            </SortableContext>
          </div>
        )}
      </div>

      {!embedded && campers.length > 0 && (
        <div className="bg-accent/10 border-accent/30 mt-4 rounded-xl border p-3">
          <p className="dark:text-accent text-sm text-amber-700">
            <strong>Tip:</strong> Drag campers to bunks to assign them. Use constraints to ensure
            friends bunk together!
          </p>
        </div>
      )}
    </div>
  )
}
