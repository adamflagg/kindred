import { useState, useTransition, useEffect, useCallback, lazy, Suspense } from 'react'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
} from '@dnd-kit/core'
import { toast } from 'react-hot-toast'
import type { Bunk, Camper, BunkWithCampers, DragItem } from '../types/app-types'
import BunkCard from './BunkCard'
import BunkSwapModal from './BunkSwapModal'
import FloatingUnassignedBadge from './FloatingUnassignedBadge'
import CamperDetailsPanel from './CamperDetailsPanel'
import { swapBunks } from '../utils/bunkSwap'

// Lazy load heavy components - only loads when needed
const BunkSocialGraphModal = lazy(() => import('./BunkSocialGraphModal'))

// Lazy load lock group components - only needed in draft mode
const LockGroupActionBar = lazy(() => import('./LockGroupActionBar'))
const LockGroupPanel = lazy(() => import('./LockGroupPanel'))
const LockGroupsHub = lazy(() => import('./LockGroupsHub'))
import { useLockGroupContext } from '../contexts/LockGroupContext'
import { formatGradeOrdinal } from '../utils/gradeUtils'
import { useYear } from '../hooks/useCurrentYear'
import type { MoveCamperOptions } from '../hooks/session/useCamperMovement'
import { DEFAULT_BUNK_CAPACITY, MAX_BUNK_CAPACITY } from '../utils/capacityConstants'
import { usePermissions } from '../hooks/usePermissions'
import { Permission } from '../constants/permissions'
import { Home } from 'lucide-react'
import { isAgSession } from '../utils/sessionTypePredicates'
import { getEffectivelyUnassignedCampers } from './bunkingBoardHelpers'
import { shouldKeepPanelsOpen } from '../utils/clickoutsidePredicate'

interface BunkingBoardByAreaProps {
  sessionId: string
  sessionCmId: number
  bunks: Bunk[]
  campers: Camper[]
  selectedArea: 'all' | 'boys' | 'girls' | 'all-gender'
  onAreaChange: (area: 'all' | 'boys' | 'girls' | 'all-gender') => void
  onCamperMove: (
    camperId: string,
    toBunkId: string | null,
    options?: MoveCamperOptions
  ) => Promise<void>
  onCamperLockToggle?: (camperId: string, locked: boolean, reason?: string) => Promise<void>
  isProductionMode?: boolean
  defaultCapacity?: number
}

type BunkArea = 'boys' | 'girls' | 'all-gender'

export default function BunkingBoardByArea(props: BunkingBoardByAreaProps) {
  const {
    sessionCmId,
    bunks,
    campers,
    selectedArea,
    onCamperMove,
    isProductionMode = false,
    defaultCapacity = DEFAULT_BUNK_CAPACITY,
  } = props
  // props.sessionId and props.onAreaChange are available if needed later
  const [, setActiveId] = useState<string | null>(null)
  const [activeDragItem, setActiveDragItem] = useState<DragItem | null>(null)
  const [selectedCamperId, setSelectedCamperId] = useState<string | null>(null)
  const [requestCloseDetails, setRequestCloseDetails] = useState(false)
  const [requestCloseLockPanel, setRequestCloseLockPanel] = useState(false)
  const [selectedBunkForGraph, setSelectedBunkForGraph] = useState<{
    cmId: number
    name: string
  } | null>(null)
  const [selectedBunkForSwap, setSelectedBunkForSwap] = useState<BunkWithCampers | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isUnassignedExpanded, setIsUnassignedExpanded] = useState(false)
  const [draggedGroupMembers, setDraggedGroupMembers] = useState<Camper[]>([])
  const [, startTransition] = useTransition()
  const currentYear = useYear()
  const { hasPermission } = usePermissions()
  const canManage = hasPermission(Permission.BUNKING_MANAGE)

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
    membersByGroup,
  } = useLockGroupContext()

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 10 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 100, tolerance: 5 },
    })
  )

  // Custom collision detection: pointer must be within a droppable
  // Falls back to rect intersection if pointer isn't directly over anything
  // This prevents "snapping" to the nearest valid bunk when dropping on invalid areas
  const customCollisionDetection = (args: Parameters<typeof pointerWithin>[0]) => {
    // First, try pointer-within (most precise - pointer must be inside droppable)
    const pointerCollisions = pointerWithin(args)
    if (pointerCollisions.length > 0) {
      return pointerCollisions
    }

    // Fall back to rect intersection for edge cases
    return rectIntersection(args)
  }

  // Categorize bunks by area
  // React Compiler will optimize this computation
  const getBunksByArea = () => {
    const areas: Record<BunkArea, BunkWithCampers[]> = {
      boys: [],
      girls: [],
      'all-gender': [],
    }

    bunks.forEach((bunk) => {
      const assignedCampers = campers.filter((c) => c.assigned_bunk === bunk.id)
      const bunkWithCampers: BunkWithCampers = {
        ...bunk,
        campers: assignedCampers,
        occupancy: assignedCampers.length,
        utilization: (assignedCampers.length / defaultCapacity) * 100,
      }

      // Categorize by bunk name prefix
      const bunkName = bunk.name.toUpperCase()
      if (bunkName.startsWith('B-')) {
        areas.boys.push(bunkWithCampers)
      } else if (bunkName.startsWith('G-')) {
        areas.girls.push(bunkWithCampers)
      } else if (bunkName.startsWith('AG-')) {
        areas['all-gender'].push(bunkWithCampers)
      }
    })

    // Sort bunks within each area
    Object.keys(areas).forEach((area) => {
      areas[area as BunkArea].sort((a, b) => {
        // Extract the part after the dash
        const aPart = a.name.split('-')[1] ?? ''
        const bPart = b.name.split('-')[1] ?? ''

        // Check if parts are numeric
        const aIsNumeric = /^\d+/.test(aPart)
        const bIsNumeric = /^\d+/.test(bPart)

        // Non-numeric names (like Aleph, Bet) come first
        if (!aIsNumeric && bIsNumeric) return -1
        if (aIsNumeric && !bIsNumeric) return 1

        // If both are numeric, sort numerically
        if (aIsNumeric && bIsNumeric) {
          // For numeric parts, extract the full number (including suffixes like A, B)
          const aMatch = aPart.match(/^(\d+)(.*)$/)
          const bMatch = bPart.match(/^(\d+)(.*)$/)

          if (aMatch && bMatch) {
            const aNumStr = aMatch[1]
            const bNumStr = bMatch[1]
            if (!aNumStr || !bNumStr) {
              return 0
            }
            const aNum = parseInt(aNumStr)
            const bNum = parseInt(bNumStr)

            // Compare numbers first
            if (aNum !== bNum) {
              return aNum - bNum
            }

            // If numbers are equal, compare suffixes (e.g., 6A vs 6B)
            const aSuffix = aMatch[2]
            const bSuffix = bMatch[2]
            if (aSuffix === undefined || bSuffix === undefined) {
              return 0
            }
            return aSuffix.localeCompare(bSuffix)
          }
        }

        // If both are non-numeric, sort alphabetically
        return aPart.localeCompare(bPart)
      })
    })

    return areas
  }

  const bunksByArea = getBunksByArea()

  // Flat list of every BunkWithCampers in the session, regardless of the
  // active area filter. Powers the swap modal's candidate picker so staff
  // can swap across area views.
  const allBunksWithCampers: BunkWithCampers[] = [
    ...bunksByArea.boys,
    ...bunksByArea.girls,
    ...bunksByArea['all-gender'],
  ]

  // Get displayed bunks based on selected area
  // React Compiler will optimize this computation
  const getDisplayedBunks = () => {
    if (selectedArea === 'all') {
      return [...bunksByArea.boys, ...bunksByArea.girls, ...bunksByArea['all-gender']]
    }
    return bunksByArea[selectedArea]
  }

  const displayedBunks = getDisplayedBunks()

  // Get unassigned campers
  // React Compiler will optimize this computation
  const getUnassignedCampers = () => {
    const unassigned = getEffectivelyUnassignedCampers(campers, bunks)

    // If showing all areas, return all unassigned campers
    if (selectedArea === 'all') {
      return unassigned
    }

    // The campers are already filtered by session in the parent component
    // Now we need to filter by area type
    return unassigned.filter((camper) => {
      // For AG area, we want to show AG bunks, which means we're viewing a main session
      // and the AG campers are included from AG sessions
      if (selectedArea === 'all-gender') {
        // Only show campers from AG sessions (any gender allowed in AG)
        return camper.expand?.session ? isAgSession(camper.expand.session) : false
      }

      // For boys/girls areas in main or embedded sessions
      // AG session campers should NOT appear in boys/girls areas
      const isFromAGSession = camper.expand?.session ? isAgSession(camper.expand.session) : false

      if (isFromAGSession) {
        // AG campers should only appear in AG area, not in boys/girls areas
        return false
      }

      // For non-AG campers, filter by gender
      if (selectedArea === 'boys') {
        return camper.gender === 'M'
      }
      return camper.gender === 'F'
    })
  }

  const unassignedCampers = getUnassignedCampers()

  const handleCamperClick = (camper: Camper) => {
    // Use transition to defer non-critical update
    startTransition(() => {
      setSelectedCamperId(String(camper.person_cm_id))
    })
  }

  // Scenario-aware bunk lookup for the modal: returns the active view's bunk
  // for a given person, or null if unassigned. CamperDetailsPanel re-fetches
  // the requester's `assigned_bunk_cm_id` from PB (live state only), so this
  // callback is what lets the modal's per-request satisfaction pills reflect
  // the draft scenario rather than only prod assignments.
  const getBunkForPerson = useCallback(
    (cmId: number): number | null =>
      campers.find((c) => c.person_cm_id === cmId)?.assigned_bunk_cm_id ?? null,
    [campers]
  )

  const handleCamperUnassign = async (camper: Camper) => {
    // Only allow in draft mode
    if (!isDraftMode) return

    try {
      await onCamperMove(camper.id, null)
      toast.success(`Unassigned ${camper.name}`)
    } catch (error) {
      console.error('Failed to unassign camper:', error)
      toast.error('Failed to unassign camper')
    }
  }

  const handleCamperLockToggle = (camper: Camper) => {
    // Only allow in draft mode
    if (!isDraftMode) return

    const lockState = getCamperLockState(camper.person_cm_id)
    if (lockState === 'pending') {
      // Already pending - remove from selection
      removePendingCamper(camper.id)
    } else if (lockState === 'none') {
      // Not in a group - add to pending selection
      addPendingCamper(camper)
    } else {
      // Already in a group - open panel and select the group
      const group = getCamperLockGroup(camper.person_cm_id)
      if (group) {
        setSelectedGroupId(group.id)
        setIsLockPanelOpen(true)
      }
    }
  }

  const handleDragStart = (event: DragStartEvent) => {
    if (!canManage) return
    const { active } = event
    setActiveId(active.id as string)
    setIsDragging(true)

    const camper = campers.find((c) => c.id === active.id)
    if (camper) {
      // Check if camper is in a lock group - track all members for the overlay
      const lockState = getCamperLockState(camper.person_cm_id)
      if (lockState === 'locked') {
        const group = getCamperLockGroup(camper.person_cm_id)
        if (group) {
          const memberCmIds = getGroupMembers(group.id)
          // Get other group members (excluding the dragged camper)
          const otherMembers = campers.filter(
            (c) => memberCmIds.includes(c.person_cm_id) && c.id !== camper.id
          )
          setDraggedGroupMembers(otherMembers)
        }
      } else {
        setDraggedGroupMembers([])
      }

      setActiveDragItem({
        id: active.id as string,
        type: 'camper',
        camper,
        sourceBunkId: camper.assigned_bunk ?? '',
      })
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    setActiveDragItem(null)
    setIsDragging(false)
    setDraggedGroupMembers([])

    if (!canManage || isProductionMode) return

    if (!over || active.id === over.id) {
      return
    }

    const camperId = active.id as string
    const targetId = over.id as string

    let targetBunkId: string | null = null

    if (targetId === 'unassigned') {
      targetBunkId = null
    } else if (targetId.startsWith('bunk-')) {
      targetBunkId = targetId.replace('bunk-', '')
    } else {
      const targetCamper = campers.find((c) => c.id === targetId)
      if (targetCamper?.assigned_bunk) {
        targetBunkId = targetCamper.assigned_bunk
      }
    }

    // No-op detection: if camper is already in the target location, do nothing silently
    const sourceCamperForNoop = campers.find((c) => c.id === camperId)
    const currentBunkId = sourceCamperForNoop?.assigned_bunk ?? null
    if (currentBunkId === targetBunkId) {
      // Already in the same place - no action needed
      return
    }

    // Bunk locking has been removed - lock groups handle keeping campers together

    // Validate gender compatibility before attempting move
    if (targetBunkId) {
      const targetBunk = displayedBunks.find((b) => b.id === targetBunkId)
      const sourceCamper = campers.find((c) => c.id === camperId)

      if (targetBunk && sourceCamper) {
        const bunkGender = targetBunk.gender.toLowerCase()
        const isFromAGSession = sourceCamper.expand?.session
          ? isAgSession(sourceCamper.expand.session)
          : false

        let isValidGender = true

        if (isFromAGSession) {
          // AG campers can only go to Mixed (AG) bunks
          isValidGender = bunkGender === 'mixed'
        } else {
          // Non-AG campers must go to matching gendered bunks
          if (sourceCamper.gender === 'M') {
            isValidGender = bunkGender === 'm' || targetBunk.name.startsWith('B-')
          } else if (sourceCamper.gender === 'F') {
            isValidGender = bunkGender === 'f' || targetBunk.name.startsWith('G-')
          }
        }

        if (!isValidGender) {
          toast.error(
            `Cannot place ${sourceCamper.gender === 'M' ? 'male' : 'female'} camper in ${targetBunk.name}`
          )
          return
        }
      }
    }

    // Check capacity: solver hard-caps at DEFAULT_BUNK_CAPACITY; staff manual
    // drag is allowed up to MAX_BUNK_CAPACITY by judgment call (warn at the
    // standard, block at the max).
    if (targetBunkId) {
      const targetBunk = displayedBunks.find((b) => b.id === targetBunkId)
      if (targetBunk && targetBunk.occupancy >= MAX_BUNK_CAPACITY) {
        const sourceCamper = campers.find((c) => c.id === camperId)
        if (sourceCamper?.assigned_bunk !== targetBunkId) {
          toast.error(`Target bunk has reached maximum capacity (${MAX_BUNK_CAPACITY} campers)`)
          return
        }
      } else if (targetBunk && targetBunk.occupancy >= defaultCapacity) {
        // Still allow move but show warning
        const sourceCamper = campers.find((c) => c.id === camperId)
        if (sourceCamper?.assigned_bunk !== targetBunkId) {
          toast(`⚠️ Warning: Bunk will exceed standard capacity (${defaultCapacity} campers)`, {
            style: {
              background: '#FEF3C7',
              color: '#92400E',
            },
          })
        }
      }
    }

    // Check if camper is in a lock group - if so, move all group members together
    const sourceCamper = campers.find((c) => c.id === camperId)
    const lockState = sourceCamper ? getCamperLockState(sourceCamper.person_cm_id) : 'none'

    let campersToMove: Camper[] = sourceCamper ? [sourceCamper] : []

    if (lockState === 'locked' && sourceCamper) {
      const group = getCamperLockGroup(sourceCamper.person_cm_id)
      if (group) {
        const memberCmIds = getGroupMembers(group.id)
        campersToMove = campers.filter((c) => memberCmIds.includes(c.person_cm_id))

        if (campersToMove.length > 1) {
          toast(`Moving ${campersToMove.length} campers as a group`, {
            duration: 2000,
            icon: '👥',
          })
        }
      }
    }

    const isMultiMove = campersToMove.length > 1
    try {
      // For multi-camper moves (lock group), suppress per-move toasts (#1632)
      // and emit a single count toast after the whole group resolves.
      // Single-camper moves keep their normal individual toast.
      for (const camper of campersToMove) {
        await onCamperMove(camper.id, targetBunkId, isMultiMove ? { silent: true } : undefined)
      }
      if (isMultiMove) {
        toast.success(`${campersToMove.length} campers moved`)
      }
    } catch (error) {
      toast.error('Failed to move camper(s)')
      console.error('Error moving camper(s):', error)
    }
  }

  const handleDragCancel = () => {
    setActiveId(null)
    setActiveDragItem(null)
    setIsDragging(false)
    setDraggedGroupMembers([])
  }

  // Handle closing details panel (called after animation completes)
  const handleCloseDetails = () => {
    setSelectedCamperId(null)
    setRequestCloseDetails(false)
  }

  // Request animated close of details panel
  const requestAnimatedCloseDetails = useCallback(() => {
    if (selectedCamperId) {
      setRequestCloseDetails(true)
    }
  }, [selectedCamperId])

  // Request animated close of lock panel
  const requestAnimatedCloseLockPanel = useCallback(() => {
    if (isLockPanelOpen) {
      setRequestCloseLockPanel(true)
    }
  }, [isLockPanelOpen])

  // Handle close of lock panel (called after animation completes)
  const handleCloseLockPanel = () => {
    setIsLockPanelOpen(false)
    setSelectedGroupId(null)
    setRequestCloseLockPanel(false)
  }

  // Close all panels when clicking on empty board space
  const handleBoardClick = (e: React.MouseEvent) => {
    // Only close if clicking directly on the grid container, not on a child (bunk card)
    if (e.target === e.currentTarget) {
      requestAnimatedCloseDetails()
      requestAnimatedCloseLockPanel()
    }
  }

  // Check if any panel is open
  const isAnyPanelOpen = !!selectedCamperId || isLockPanelOpen

  // Close panels when clicking on dead space (nav, page sides, board gaps).
  // Predicate is shared with the unit test in clickoutsidePredicate.ts so the
  // two cannot drift.
  const handleGlobalClick = useCallback(
    (e: MouseEvent) => {
      if (shouldKeepPanelsOpen(e)) return
      requestAnimatedCloseDetails()
      requestAnimatedCloseLockPanel()
    },
    [requestAnimatedCloseDetails, requestAnimatedCloseLockPanel]
  )

  // Set up global click listener when panels are open
  // Small delay prevents catching the click that opened the panel
  useEffect(() => {
    if (!isAnyPanelOpen) return

    // Add listener after a microtask to avoid catching the opening click
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleGlobalClick)
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('click', handleGlobalClick)
    }
  }, [isAnyPanelOpen, handleGlobalClick])

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
            <div className="bg-card border-border rounded-xl border p-8 text-center">
              <Home className="text-muted-foreground/30 mx-auto mb-3 h-12 w-12" />
              <p className="text-muted-foreground font-medium">No bunks in this area</p>
            </div>
          ) : (
            <div
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              style={{ contain: 'layout style' }}
              onClick={handleBoardClick}
            >
              {displayedBunks.map((bunk) => (
                <BunkCard
                  key={bunk.id}
                  bunk={bunk}
                  onCamperClick={handleCamperClick}
                  onCamperLockToggle={handleCamperLockToggle}
                  onCamperUnassign={handleCamperUnassign}
                  onShowSocialGraph={() => {
                    startTransition(() => {
                      setSelectedBunkForGraph({
                        cmId: bunk.cm_id,
                        name: bunk.name,
                      })
                    })
                  }}
                  onSwapClick={
                    canManage && !isProductionMode ? () => setSelectedBunkForSwap(bunk) : undefined
                  }
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
          isProductionMode={isProductionMode}
        />

        {/* Drag Overlay - Shows group members when dragging locked groups */}
        <DragOverlay>
          {activeDragItem ? (
            <div className="relative">
              {/* Stacked cards for other group members (behind) */}
              {draggedGroupMembers.slice(0, 3).map((member, index) => (
                <div
                  key={member.id}
                  className="absolute rounded-md border bg-white p-2 shadow-md dark:bg-gray-800"
                  style={{
                    top: (index + 1) * 6,
                    left: (index + 1) * 6,
                    zIndex: -index - 1,
                    opacity: 0.7 - index * 0.15,
                    transform: `rotate(${3 + (index + 1) * 2}deg)`,
                  }}
                >
                  <div className="text-sm font-medium">{member.name}</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    {formatGradeOrdinal(member.grade)}
                  </div>
                </div>
              ))}

              {/* Main dragged camper card (on top) */}
              <div className="relative z-10 rotate-3 opacity-90">
                <div className="rounded-md border bg-white p-2 shadow-lg dark:bg-gray-800">
                  <div className="text-sm font-medium">{activeDragItem.camper.name}</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    {formatGradeOrdinal(activeDragItem.camper.grade)}
                  </div>
                </div>
                {/* Badge showing total group size */}
                {draggedGroupMembers.length > 0 && (
                  <div className="bg-primary text-primary-foreground absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold shadow-lg">
                    {draggedGroupMembers.length + 1}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Camper Details Panel - Slides in from right */}
      {selectedCamperId &&
        (() => {
          // Pre-compute the bunk roster for the selected camper so the sidebar's
          // unsatisfied-requests alert uses the same satisfaction calculation
          // as the bunking-board card (parity by construction).
          const selected = campers.find((c) => String(c.person_cm_id) === selectedCamperId)
          const bunkmates =
            selected?.assigned_bunk_cm_id != null
              ? campers
                  .filter((c) => c.assigned_bunk_cm_id === selected.assigned_bunk_cm_id)
                  .map((c) => ({ cmId: c.person_cm_id, grade: c.grade }))
              : []
          return (
            <CamperDetailsPanel
              camperId={selectedCamperId}
              onClose={handleCloseDetails}
              requestClose={requestCloseDetails}
              bunkCampers={bunkmates}
              assignedBunkCmId={selected?.assigned_bunk_cm_id ?? null}
              getBunkForPerson={getBunkForPerson}
            />
          )
        })()}

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

      {/* Bunk Swap Modal — same-gender picker + Confirm flow (#1546) */}
      {selectedBunkForSwap && canManage && !isProductionMode && (
        <BunkSwapModal
          source={selectedBunkForSwap}
          allBunks={allBunksWithCampers}
          onCancel={() => setSelectedBunkForSwap(null)}
          onConfirm={async (target) => {
            const source = selectedBunkForSwap
            // Close immediately so the user sees the board update as the
            // per-camper moves stream in.
            setSelectedBunkForSwap(null)
            const totalCampers = source.campers.length + target.campers.length
            try {
              // Suppress per-move toasts (#1632): the orchestrator emits one
              // count toast below after the whole batch resolves.
              await swapBunks(source, target, async (camperId, bunkId) => {
                await onCamperMove(camperId, bunkId, { silent: true })
              })
              // One summary toast for the whole swap action.
              toast.success(`${totalCampers} camper${totalCampers === 1 ? '' : 's'} moved`)
            } catch (error) {
              console.error('Bunk swap failed:', error)
              toast.error('Bunk swap failed — some campers may not have moved')
            }
          }}
        />
      )}

      {/* Lock Group Action Bar - only shown in draft mode with pending selections (lazy loaded) */}
      {canManage &&
        isDraftMode &&
        scenarioId &&
        lockGroupSessionPbId &&
        pendingCampers.length > 0 && (
          <Suspense fallback={null}>
            <LockGroupActionBar
              pendingCampers={pendingCampers}
              sessionPbId={lockGroupSessionPbId}
              scenarioId={scenarioId}
              year={currentYear}
              onClearPending={clearPendingCampers}
              onGroupCreated={() => {
                toast.success('Lock group created successfully')
              }}
            />
          </Suspense>
        )}

      {/* Friend Groups Hub - visible in draft mode with manage permission (lazy loaded) */}
      {canManage && isDraftMode && scenarioId && lockGroupSessionPbId && (
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
      {canManage && isDraftMode && scenarioId && lockGroupSessionPbId && (
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
            sessionCampers={campers}
          />
        </Suspense>
      )}
    </>
  )
}
