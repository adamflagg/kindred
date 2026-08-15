import { type MouseEvent, type CSSProperties, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import clsx from 'clsx'
import { Lock, Eye, UserPlus, UserMinus, Users, ChevronRight, Home } from 'lucide-react'
import {
  getGenderIdentityDisplay,
  getGenderCategory,
  getGenderColorClasses,
} from '../utils/genderUtils'
import { getSessionShorthand } from '../utils/sessionDisplay'
import { formatGradeOrdinal } from '../utils/gradeUtils'
import { getDisplayAgeForYear } from '../utils/displayAge'
import { useYear } from '../hooks/useCurrentYear'
import type { Camper } from '../types/app-types'
import { useBunkRequestContext, useCamperHistoryContext } from '../hooks'
import { useLockGroupContext } from '../contexts/LockGroupContext'
import { useOverlayEscape } from '../hooks/useOverlayEscape'
import { emptyCamperSatisfaction } from '../types/satisfaction'

interface CamperCardProps {
  camper: Camper
  isDraggable?: boolean
  isDragging?: boolean
  onClick?: (camper: Camper) => void
  hasRequests?: boolean // Indicates if camper has bunk requests
  onLockToggle?: (camper: Camper) => void
  onUnassign?: (camper: Camper) => void // Unassign from current bunk
  lockState?: 'none' | 'pending' | 'locked' // Lock state
  lockGroupColor?: string | undefined // Color of the lock group
  isDraftMode?: boolean // True when viewing a draft scenario (enables lock features)
  isProductionMode?: boolean // True when no scenario is selected (read-only)
}

function CamperCard({
  camper,
  isDraggable = true,
  isDragging = false,
  onClick,
  hasRequests: _hasRequests = true, // Default to true to avoid visual noise until we have data
  onLockToggle,
  onUnassign,
  lockState = 'none',
  lockGroupColor,
  isDraftMode = false,
  isProductionMode = false,
}: CamperCardProps) {
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [contextMenuPosition, setContextMenuPosition] = useState({
    x: 0,
    y: 0,
  })
  const [showGroupSubmenu, setShowGroupSubmenu] = useState(false)
  const [submenuPosition, setSubmenuPosition] = useState<'below' | 'above'>('below')
  const viewingYear = useYear()

  // Get lock group context for adding/removing pending campers and animation delay
  const {
    addPendingCamper,
    removePendingCamper,
    getPendingAnimationDelay,
    groups,
    addCamperToGroup,
    getCamperLockGroup,
    getGroupMembers,
    setSelectedGroupId,
    setIsLockPanelOpen,
  } = useLockGroupContext()

  // Get bunk request context
  const { getSatisfiedRequestInfo } = useBunkRequestContext()
  const { getLastYearHistory } = useCamperHistoryContext()

  // Get satisfied requests information from context (fetched from /api/satisfaction)
  // Suppress satisfaction lookups for unassigned campers and mid-drag cards
  const satisfiedInfo =
    isDragging || !camper.assigned_bunk_cm_id
      ? emptyCamperSatisfaction(camper.person_cm_id)
      : getSatisfiedRequestInfo(camper.person_cm_id)

  // Get last year's history from context
  const lastYearHistory = getLastYearHistory(camper.person_cm_id)

  // Check if camper is in a locked group and get group size
  const isInLockedGroup = lockState === 'locked'
  const lockGroup = isInLockedGroup ? getCamperLockGroup(camper.person_cm_id) : null
  const groupSize = lockGroup ? getGroupMembers(lockGroup.id).length : 0

  // Listen for global close event from other context menus
  useEffect(() => {
    const handleCloseAll = () => setShowContextMenu(false)
    window.addEventListener('closeAllContextMenus', handleCloseAll)
    return () => window.removeEventListener('closeAllContextMenus', handleCloseAll)
  }, [])

  // Escape dismisses the context menu — the keyboard equivalent for the
  // full-viewport backdrop's click-to-close (see the backdrop's own
  // eslint-disable below).
  //
  // NEEDS AN OVERLAY TOKEN (kindred#2237): these cards are rendered INSIDE the
  // expanded `ui/FloatingQueueBadge` queue (`FloatingUnassignedBadge`), which
  // closes itself on Escape from its own ungated `document` listener. Two
  // bubble-phase handlers, neither stopping propagation, meant one press
  // dismissed the menu AND collapsed the queue it was opened from. The menu is
  // the overlay on TOP, so it is the one that takes the token; once it
  // swallows the key while topmost the badge beneath never sees the press,
  // which is why the badge needs no token of its own.
  useOverlayEscape(showContextMenu, () => setShowContextMenu(false))

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
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    willChange: isDragging ? 'transform' : 'auto',
  }

  const handleClick = (e: MouseEvent) => {
    // Only trigger click if not dragging
    if (isDragging || isSortableDragging) return

    // Ctrl/Cmd+click for multi-select lock group mode (only in draft mode)
    if ((e.ctrlKey || e.metaKey) && isDraftMode) {
      e.preventDefault()
      e.stopPropagation()

      if (lockState === 'pending') {
        // Already pending - remove from selection
        removePendingCamper(camper.id)
      } else if (lockState === 'none') {
        // Not in a group - add to pending selection
        addPendingCamper(camper)
      } else if (lockState === 'locked') {
        // Jump to the camper's existing group in the panel
        const group = getCamperLockGroup(camper.person_cm_id)
        if (group) {
          setSelectedGroupId(group.id)
          setIsLockPanelOpen(true)
        }
      }
      return
    }

    // Normal click - view camper details
    if (onClick) {
      e.stopPropagation()
      onClick(camper)
    }
  }

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Close any other open context menus first, then open ours after a microtask
    // This ensures the close event is fully processed before opening
    window.dispatchEvent(new CustomEvent('closeAllContextMenus'))
    requestAnimationFrame(() => {
      setContextMenuPosition({ x: e.clientX, y: e.clientY })
      setShowContextMenu(true)
    })
  }

  const handleViewDetails = () => {
    setShowContextMenu(false)
    if (onClick) {
      onClick(camper)
    }
  }

  const handleAddToLockGroup = () => {
    setShowContextMenu(false)
    addPendingCamper(camper)
  }

  const handleRemoveFromLockGroup = () => {
    setShowContextMenu(false)
    // If pending, just remove from pending
    if (lockState === 'pending') {
      removePendingCamper(camper.id)
    }
    // If locked, removal is handled via LockGroupPanel
  }

  const handleLockToggle = () => {
    if (onLockToggle) {
      onLockToggle(camper)
    }
    setShowContextMenu(false)
  }

  const genderIdentity = getGenderIdentityDisplay(camper)
  const genderCategory = getGenderCategory(genderIdentity)
  const genderColorClass = getGenderColorClasses(genderCategory, genderIdentity)

  // Format historical data for display
  const historyDisplay = lastYearHistory
    ? `${getSessionShorthand(lastYearHistory.sessionName, lastYearHistory.sessionType)} ${lastYearHistory.bunkName}`
    : ''

  return (
    <>
      <button
        type="button"
        data-camper-card
        ref={setNodeRef}
        title={isProductionMode ? 'Switch to a scenario to edit' : undefined}
        style={
          {
            ...style,
            ...(lockState === 'pending'
              ? { animationDelay: `${getPendingAnimationDelay(camper.id)}ms` }
              : {}),
          } satisfies CSSProperties
        }
        className={clsx(
          'relative block w-full overflow-hidden rounded-xl border-2 p-2.5 text-left transition-all select-none',
          genderColorClass,
          isDraggable && 'hover:shadow-lodge cursor-move',
          !isDraggable && 'cursor-default',
          (isSortableDragging || isDragging) && 'opacity-50',
          // Pending lock group selection - synchronized glow animation
          lockState === 'pending' && 'pending-lock-glow border-amber-400 dark:border-amber-500'
        )}
        {...(isDraggable ? attributes : {})}
        {...(isDraggable ? listeners : {})}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <span className="flex flex-col gap-0.5">
          {/* Line 1: Name (left) and Status icons (right) */}
          <span className="flex items-center justify-between gap-1.5">
            <span
              className="block min-w-0 flex-1 truncate text-sm font-medium dark:text-gray-100"
              style={
                isInLockedGroup && lockGroupColor
                  ? {
                      textShadow: `0 0 8px ${lockGroupColor}, 0 0 12px ${lockGroupColor}80`,
                    }
                  : undefined
              }
            >
              {camper.name}
            </span>
            <span className="flex flex-shrink-0 items-center gap-1">
              {/* Parent-paramount: material parent request unsatisfied (>=1 request, 0 satisfied). */}
              {satisfiedInfo.flags.parent_min_one_violation && (
                <span
                  className="text-orange-500 dark:text-orange-400"
                  title={`${satisfiedInfo.counted_totals.material_parent.total} parent request${satisfiedInfo.counted_totals.material_parent.total > 1 ? 's' : ''}, none satisfied`}
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                </span>
              )}
              {/* Staff requests unsatisfied. Always shown when staff_unsatisfied_alert is true,
                  independent of parent state — user wants the complete "what didn't land" picture
                  for staff input even when parent is met. */}
              {satisfiedInfo.flags.staff_unsatisfied_alert && (
                <span
                  className="text-amber-500 dark:text-amber-400"
                  title={`${satisfiedInfo.counted_totals.staff.total} staff request${satisfiedInfo.counted_totals.staff.total > 1 ? 's' : ''}, ${satisfiedInfo.counted_totals.staff.total - satisfiedInfo.counted_totals.staff.satisfied} unsatisfied`}
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                    <circle cx="10" cy="10" r="7" />
                  </svg>
                </span>
              )}
              {/* Lock: in friend group with member count */}
              {isInLockedGroup && (
                <span
                  className="inline-flex items-center gap-0.5"
                  style={{ color: lockGroupColor ?? '#eab308' }}
                  title={`Friend group (${groupSize} members)`}
                >
                  {groupSize > 1 && (
                    <span className="text-xs leading-none font-semibold">{groupSize}</span>
                  )}
                  <Lock className="h-4 w-4" />
                </span>
              )}
            </span>
          </span>

          {/* Line 2: Age/Grade (left) and History (right) */}
          <span className="flex items-center justify-between gap-2">
            <span className="block text-xs text-gray-600 dark:text-gray-400">
              Age {(getDisplayAgeForYear(camper, viewingYear) ?? 0).toFixed(2)} •{' '}
              {formatGradeOrdinal(camper.grade)}
            </span>
            {historyDisplay && (
              <span className="text-muted-foreground block text-xs whitespace-nowrap">
                {historyDisplay}
              </span>
            )}
          </span>
        </span>

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
      </button>

      {/* Context Menu - rendered via Portal to escape stacking context issues */}
      {showContextMenu &&
        createPortal(
          <>
            {/* Full-viewport dismiss layer for the context menu, not content —
                a real button covering the whole screen would be a worse
                interactive-content trap for both mouse and keyboard users.
                `aria-hidden` marks it non-perceivable rather than bolting on a
                fake interactive role. The keyboard equivalent is the document
                Escape listener above, not an onKeyDown on this element. */}
            <div
              className="fixed inset-0 z-[9998]"
              data-backdrop="true"
              aria-hidden="true"
              onClick={() => setShowContextMenu(false)}
              onContextMenu={(e) => {
                e.preventDefault()
                setShowContextMenu(false)
                // Find element under all backdrops and re-dispatch contextmenu to it
                const elements = document.elementsFromPoint(e.clientX, e.clientY)
                for (const el of elements) {
                  if (el instanceof HTMLElement && el.dataset['backdrop']) continue
                  el.dispatchEvent(
                    new MouseEvent('contextmenu', {
                      bubbles: true,
                      cancelable: true,
                      clientX: e.clientX,
                      clientY: e.clientY,
                      view: window,
                    })
                  )
                  break
                }
              }}
            />
            <div
              className="card-lodge shadow-lodge-lg animate-scale-in fixed z-[9999] p-1"
              style={{
                left: `${Math.min(contextMenuPosition.x, window.innerWidth - 200)}px`,
                top: `${Math.min(contextMenuPosition.y, window.innerHeight - 120)}px`,
                minWidth: '180px',
              }}
            >
              {/* View Details - always available */}
              <button
                className="hover:bg-muted/50 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors"
                onClick={handleViewDetails}
              >
                <Eye className="h-4 w-4" />
                View Details
              </button>

              {/* Unassign - only for assigned campers in draft mode */}
              {isDraftMode && camper.assigned_bunk_cm_id && onUnassign && (
                <>
                  <div className="border-border my-1 border-t" />
                  <button
                    className="hover:bg-muted/50 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-amber-600 transition-colors"
                    onClick={() => {
                      onUnassign(camper)
                      setShowContextMenu(false)
                    }}
                  >
                    <Home className="h-4 w-4" />
                    Unassign
                  </button>
                </>
              )}

              {/* Friend Group Options - available in draft mode for any camper */}
              {isDraftMode && (
                <>
                  <div className="border-border my-1 border-t" />

                  {/* Add to New Friend Group - always available for unlocked campers */}
                  {lockState === 'none' && (
                    <button
                      className="hover:bg-muted/50 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors"
                      onClick={handleAddToLockGroup}
                    >
                      <UserPlus className="h-4 w-4" />
                      Add to New Group
                    </button>
                  )}

                  {/* Add to Existing Group - shown when groups exist and camper is unlocked */}
                  {lockState === 'none' && groups.length > 0 && (
                    <div
                      className="relative"
                      onMouseEnter={(e) => {
                        // Calculate if submenu would overflow bottom of viewport
                        const rect = e.currentTarget.getBoundingClientRect()
                        const submenuHeight = groups.length * 40 + 16 // ~40px per item + padding
                        const spaceBelow = window.innerHeight - rect.bottom
                        const spaceAbove = rect.top

                        // Position above if not enough space below and more space above
                        if (spaceBelow < submenuHeight && spaceAbove > spaceBelow) {
                          setSubmenuPosition('above')
                        } else {
                          setSubmenuPosition('below')
                        }
                        setShowGroupSubmenu(true)
                      }}
                      onMouseLeave={() => setShowGroupSubmenu(false)}
                    >
                      <button className="hover:bg-muted/50 flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors">
                        <span className="flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          Add to Group
                        </span>
                        <ChevronRight className="h-3 w-3 opacity-60" />
                      </button>

                      {/* Group Submenu - positions above or below based on viewport space */}
                      {showGroupSubmenu && (
                        <div
                          className="card-lodge shadow-lodge-lg animate-scale-in absolute left-full ml-1 min-w-[160px] p-1"
                          style={{
                            transformOrigin:
                              submenuPosition === 'above' ? 'left bottom' : 'left top',
                            ...(submenuPosition === 'above' ? { bottom: 0 } : { top: 0 }),
                          }}
                        >
                          {groups.map((group) => (
                            <button
                              key={group.id}
                              className="hover:bg-muted/50 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors"
                              onClick={() => {
                                void addCamperToGroup(camper, group.id)
                                setShowContextMenu(false)
                              }}
                            >
                              <span
                                className="h-3 w-3 flex-shrink-0 rounded-full"
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
                      className="hover:bg-muted/50 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-amber-600 transition-colors"
                      onClick={handleRemoveFromLockGroup}
                    >
                      <UserMinus className="h-4 w-4" />
                      Cancel Selection
                    </button>
                  )}

                  {/* View/Manage Friend Group - for locked campers */}
                  {lockState === 'locked' && (
                    <button
                      className="hover:bg-muted/50 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors"
                      onClick={handleLockToggle}
                    >
                      <Lock className="h-4 w-4" style={{ color: lockGroupColor }} />
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
  )
}

export default CamperCard
