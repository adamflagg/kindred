import { Fragment } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import clsx from 'clsx'
import { Network, Download, ArrowLeftRight, Lock, LockOpen } from 'lucide-react'
import type { BunkWithCampers, Camper } from '../types/app-types'
import CamperCard from './CamperCard'
import { useBunkRequestsFromContext } from '../hooks'
import { formatGradeOrdinal } from '../utils/gradeUtils'
import { getDisplayAgeForYear } from '../utils/displayAge'
import { useYear } from '../hooks/useCurrentYear'
import { useLockGroupContext } from '../contexts/LockGroupContext'
import { BunkUtilizationBar } from './BunkUtilizationBar'
import { BunkWarnings } from './BunkWarnings'
import { isAgSession } from '../utils/sessionTypePredicates'
import { buildCsvContent, downloadCsv, slugify, todayIso } from '../utils/csvExport'
import { buildCamperRows, CAMPER_CSV_HEADERS } from '../utils/csvExportHelpers'

interface BunkCardProps {
  bunk: BunkWithCampers
  onCamperClick?: (camper: Camper) => void
  onCamperLockToggle?: (camper: Camper) => void
  onCamperUnassign?: (camper: Camper) => void
  onShowSocialGraph?: () => void
  onSwapClick?: (() => void) | undefined
  isDragging?: boolean
  isProductionMode?: boolean
  defaultCapacity?: number
  activeDragCamper?: Camper | null
  /** Whether this cabin is locked from re-solving */
  isLocked?: boolean
  /** Called when the lock/unlock button is clicked (only renders when provided) */
  onToggleLock?: () => void
}

/**
 * Extracts grade range from a name string.
 * Mirrors the Go logic in pocketbase/sync/bunk_plans.go:extractGradeRange()
 *
 * @returns [minGrade, maxGrade] or [0, 0] if no grade found
 */
function extractGradeRange(name: string): [number, number] {
  if (!name) return [0, 0]

  // Pattern 1: "X/Y" format (e.g., "9/10", "7/8")
  const slashMatch = name.match(/(\d+)\/(\d+)/)
  if (slashMatch?.[1] && slashMatch[2]) {
    const g1 = parseInt(slashMatch[1], 10)
    const g2 = parseInt(slashMatch[2], 10)
    return [Math.min(g1, g2), Math.max(g1, g2)]
  }

  // Pattern 2: "Xth - Yth" format (e.g., "7th - 9th", "7th & 8th")
  const rangeMatch = name.match(/(\d+)(?:st|nd|rd|th)?\s*[-–&]\s*(\d+)(?:st|nd|rd|th)?/)
  if (rangeMatch?.[1] && rangeMatch[2]) {
    const g1 = parseInt(rangeMatch[1], 10)
    const g2 = parseInt(rangeMatch[2], 10)
    return [Math.min(g1, g2), Math.max(g1, g2)]
  }

  // Pattern 3: Single number after "AG-" (e.g., "AG-8" → 8, 8)
  const singleMatch = name.match(/AG[-\s](\d+)/i)
  if (singleMatch?.[1]) {
    const grade = parseInt(singleMatch[1], 10)
    return [grade, grade]
  }

  return [0, 0]
}

/**
 * Checks if a grade is within a range (inclusive)
 */
function gradeInRange(grade: number, min: number, max: number): boolean {
  return grade >= min && grade <= max
}

/**
 * Checks if two grade ranges have any overlap
 */
function gradesOverlap(min1: number, max1: number, min2: number, max2: number): boolean {
  return !(max1 < min2 || min1 > max2)
}

function BunkCard({
  bunk,
  onCamperClick,
  onCamperLockToggle,
  onCamperUnassign,
  onShowSocialGraph,
  onSwapClick,
  isDragging = false,
  isProductionMode = false,
  defaultCapacity = 12,
  activeDragCamper = null,
  isLocked = false,
  onToggleLock,
}: BunkCardProps) {
  const viewingYear = useYear()

  // Check if this bunk is a valid drop target for the dragged camper
  const isValidDropTarget = (): boolean => {
    if (!activeDragCamper) return true // No drag = valid

    const bunkGender = bunk.gender.toLowerCase()
    const isFromAGSession = activeDragCamper.expand?.session
      ? isAgSession(activeDragCamper.expand.session)
      : false

    if (isFromAGSession) {
      // AG campers can only go to Mixed (AG) bunks
      if (bunkGender !== 'mixed') {
        return false
      }

      // Check if bunk grade is compatible with session grade range
      // Logic mirrors pocketbase/sync/bunk_plans.go lines 329-360
      const sessionName = activeDragCamper.expand?.session?.name ?? ''
      const [sessionGradeMin, sessionGradeMax] = extractGradeRange(sessionName)
      const [bunkGradeMin, bunkGradeMax] = extractGradeRange(bunk.name || '')

      // If we can extract grades from both, check compatibility
      if (bunkGradeMin > 0 && sessionGradeMin > 0) {
        if (bunkGradeMin === bunkGradeMax) {
          // Single grade bunk (e.g., "AG-8") - must be within session range
          if (!gradeInRange(bunkGradeMin, sessionGradeMin, sessionGradeMax)) {
            return false
          }
        } else {
          // Range bunk - check for any overlap with session range
          if (!gradesOverlap(bunkGradeMin, bunkGradeMax, sessionGradeMin, sessionGradeMax)) {
            return false
          }
        }
      }

      return true
    }

    // Non-AG campers go to gendered bunks based on their gender
    if (activeDragCamper.gender === 'M') {
      return bunkGender === 'm' || bunk.name.startsWith('B-')
    }
    if (activeDragCamper.gender === 'F') {
      return bunkGender === 'f' || bunk.name.startsWith('G-')
    }

    return true // Unknown gender = allow anywhere
  }

  const dropDisabled = isProductionMode || !isValidDropTarget()

  const { setNodeRef, isOver } = useDroppable({
    id: `bunk-${bunk.id}`,
    disabled: dropDisabled,
  })

  // Get lock group context for draft mode lock states
  const { getCamperLockState, getCamperLockGroupColor, isDraftMode } = useLockGroupContext()

  // Get bunk request status for all campers in this bunk
  const camperPersonIds = bunk.campers.map((c) => c.person_cm_id)
  const { data: requestStatus = {} } = useBunkRequestsFromContext(camperPersonIds)

  const utilizationColor =
    bunk.occupancy > defaultCapacity
      ? 'text-red-600 dark:text-red-400'
      : bunk.utilization >= 90
        ? 'text-orange-600 dark:text-orange-400'
        : bunk.utilization >= 70
          ? 'text-yellow-600 dark:text-yellow-400'
          : 'text-green-600 dark:text-green-400'

  // Calculate grade distribution, age range, and capacity warnings
  // React Compiler will automatically optimize these calculations
  const calculateBunkStats = () => {
    // Quick path when dragging - just sort campers
    if (isDragging) {
      const sorted = bunk.campers.toSorted((a, b) => a.age - b.age)
      return {
        gradeDistribution: null,
        ageRange: null,
        sortedCampers: sorted,
        ageGapWarning: false,
        gradeRatioWarning: false,
        tooManyGradesWarning: false,
        isOverCapacity: false,
      }
    }
    // Calculate over capacity inside useMemo
    const isOverCapacity = bunk.occupancy > defaultCapacity

    // Sort campers by age (youngest to oldest)
    const sorted = bunk.campers.toSorted((a, b) => a.age - b.age)

    // Calculate grade distribution
    const gradeCounts = new Map<number, number>()
    bunk.campers.forEach((camper) => {
      const grade = camper.grade
      gradeCounts.set(grade, (gradeCounts.get(grade) ?? 0) + 1)
    })

    // Get all grades sorted by count
    const sortedGrades = Array.from(gradeCounts.entries()).sort((a, b) => b[1] - a[1])

    let gradeDistribution = null
    let gradeRatioWarning = false
    const tooManyGradesWarning = sortedGrades.length > 2

    if (sortedGrades.length === 1) {
      gradeDistribution = { single: sortedGrades[0] }
    } else if (sortedGrades.length === 2) {
      const firstGrade = sortedGrades[0]
      const secondGrade = sortedGrades[1]
      if (!firstGrade || !secondGrade) {
        gradeDistribution = null
      } else {
        let [grade1, count1] = firstGrade
        let [grade2, count2] = secondGrade

        // Ensure younger grade (lower number) is first
        if (grade1 > grade2) {
          ;[grade1, grade2] = [grade2, grade1]
          ;[count1, count2] = [count2, count1]
        }

        const total = bunk.campers.length
        const ratio1 = Math.round((count1 / total) * 100)
        const ratio2 = Math.round((count2 / total) * 100)
        gradeDistribution = {
          type: 'double',
          grade1,
          grade2,
          ratio1,
          ratio2,
          count1,
          count2,
        }

        // Check if any grade exceeds 67% ratio
        gradeRatioWarning = ratio1 > 67 || ratio2 > 67
      }
    } else if (sortedGrades.length >= 3) {
      // For 3+ grades, show all of them
      const total = bunk.campers.length
      const gradesWithPercentages = sortedGrades
        .map(([grade, count]) => ({
          grade,
          count,
          percentage: Math.round((count / total) * 100),
        }))
        .sort((a, b) => a.grade - b.grade) // Sort by grade number for display
      gradeDistribution = { type: 'multiple', grades: gradesWithPercentages }

      // Check if any grade exceeds 67% ratio
      gradeRatioWarning = gradesWithPercentages.some((g) => g.percentage > 67)
    }

    // Calculate age range (24 months = 2 years)
    let ageRange = null
    let ageGapWarning = false
    if (sorted.length > 0) {
      const youngestCamper = sorted[0]
      const oldestCamper = sorted.at(-1)
      if (!youngestCamper || !oldestCamper) {
        ageRange = null
        ageGapWarning = false
      } else {
        const youngest = youngestCamper.age
        const oldest = oldestCamper.age
        ageRange = { youngest, oldest }
        ageGapWarning = oldest - youngest > 2.0 // 24 months
      }
    }

    return {
      gradeDistribution,
      ageRange,
      sortedCampers: sorted,
      ageGapWarning,
      gradeRatioWarning,
      tooManyGradesWarning,
      isOverCapacity,
    }
  }

  const {
    gradeDistribution,
    ageRange,
    sortedCampers,
    ageGapWarning,
    gradeRatioWarning,
    tooManyGradesWarning,
    isOverCapacity,
  } = calculateBunkStats()

  return (
    <div
      data-bunk-card
      data-bunk-cm-id={bunk.cm_id}
      ref={setNodeRef}
      className={clsx(
        'card-lodge relative p-4 transition-all',
        isOver && 'ring-primary bg-primary/5 ring-2',
        'hover:shadow-lodge-lg',
        (ageGapWarning || gradeRatioWarning || tooManyGradesWarning || isOverCapacity) &&
          'border-destructive/50 border-2',
        // Locked cabin — amber ring + subtle tint
        isLocked &&
          'bg-amber-50/30 ring-2 ring-amber-400/70 dark:bg-amber-900/10 dark:ring-amber-500/60',
        // Disabled drop target styling - grey out invalid gender matches
        dropDisabled && activeDragCamper && 'pointer-events-none opacity-40'
      )}
      style={{
        contain: 'layout style paint',
        willChange: isDragging ? 'transform' : 'auto',
      }}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex-1">
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            {bunk.name}
            {isLocked && (
              <span className="badge badge-warning badge-sm gap-1">
                <Lock className="h-3 w-3" />
                locked
              </span>
            )}
            {(ageGapWarning || gradeRatioWarning || tooManyGradesWarning || isOverCapacity) &&
              !isLocked && <span className="text-sm text-red-600">⚠️</span>}
          </h3>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 text-sm">
              <span className={clsx('font-medium', utilizationColor)}>
                {bunk.occupancy}/{defaultCapacity}
              </span>
              {gradeDistribution && (
                <div className="text-muted-foreground flex-1">
                  {gradeDistribution.single ? (
                    <>{formatGradeOrdinal(gradeDistribution.single[0])}</>
                  ) : gradeDistribution.type === 'double' ? (
                    <>
                      <span
                        className={
                          (gradeDistribution.ratio1 ?? 0) > 67 ? 'font-medium text-red-600' : ''
                        }
                      >
                        {formatGradeOrdinal(gradeDistribution.grade1)}: {gradeDistribution.count1}
                      </span>
                      {' | '}
                      <span
                        className={
                          (gradeDistribution.ratio2 ?? 0) > 67 ? 'font-medium text-red-600' : ''
                        }
                      >
                        {formatGradeOrdinal(gradeDistribution.grade2)}: {gradeDistribution.count2}
                      </span>
                    </>
                  ) : gradeDistribution.type === 'multiple' ? (
                    <div className="flex flex-wrap items-center text-xs">
                      {gradeDistribution.grades?.map((g, index) => (
                        <Fragment key={g.grade}>
                          {index > 0 && <span className="mx-1">|</span>}
                          <span
                            className={clsx(
                              'whitespace-nowrap',
                              g.percentage > 67 && 'font-medium text-red-600'
                            )}
                          >
                            {formatGradeOrdinal(g.grade)}: {g.count}
                          </span>
                        </Fragment>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            {ageRange &&
              (() => {
                const youngest = sortedCampers[0]
                const oldest = sortedCampers.at(-1)
                if (!youngest || !oldest) return null
                return (
                  <div
                    className={clsx(
                      'text-xs',
                      ageGapWarning ? 'font-medium text-red-600' : 'text-muted-foreground'
                    )}
                  >
                    Ages: {(getDisplayAgeForYear(youngest, viewingYear) ?? 0).toFixed(2)} -{' '}
                    {(getDisplayAgeForYear(oldest, viewingYear) ?? 0).toFixed(2)}
                    {ageGapWarning && ' ⚠️'}
                  </div>
                )
              })()}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1">
          {bunk.campers.length > 0 && (
            <button
              onClick={() => {
                // Derive a session map from the campers' expand data
                // (campers already carry their session names via expand)
                const sessions = bunk.campers
                  .filter((c) => c.expand?.session)
                  .map((c) => c.expand!.session!)
                  .filter((s, idx, arr) => arr.findIndex((x) => x.cm_id === s.cm_id) === idx)
                const rows = buildCamperRows(bunk.campers, sessions)
                const csv = buildCsvContent([...CAMPER_CSV_HEADERS], rows)
                const sessionName = sessions[0]?.name ?? ''
                const sessionPart = sessionName ? `-${slugify(sessionName)}` : ''
                downloadCsv(csv, `bunk-${slugify(bunk.name)}${sessionPart}-${todayIso()}.csv`)
              }}
              className="btn-ghost p-2"
              title="Export bunk to CSV"
            >
              <Download className="h-4 w-4" />
            </button>
          )}
          {onSwapClick && (
            <button
              onClick={onSwapClick}
              className="btn-ghost p-2"
              title="Swap this bunk's roster with another bunk"
              aria-label="Swap bunk"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </button>
          )}
          {onShowSocialGraph && bunk.campers.length > 0 && (
            <button
              onClick={onShowSocialGraph}
              className="btn-ghost p-2"
              title="View social network"
            >
              <Network className="h-5 w-5" />
            </button>
          )}
          {onToggleLock && (
            <button
              onClick={onToggleLock}
              className="btn-ghost p-2"
              title={isLocked ? 'Unlock cabin' : 'Lock cabin'}
              aria-label={isLocked ? 'Unlock cabin' : 'Lock cabin'}
              aria-pressed={!!isLocked}
            >
              {isLocked ? (
                <Lock className="h-4 w-4 text-amber-500" />
              ) : (
                <LockOpen className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Utilization Bar */}
      <BunkUtilizationBar
        utilization={bunk.utilization}
        occupancy={bunk.occupancy}
        capacity={defaultCapacity}
      />

      {/* Campers List */}
      <div className="min-h-[100px] space-y-2">
        <SortableContext
          items={sortedCampers.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {sortedCampers.length === 0
            ? !isProductionMode && (
                <p className="text-muted-foreground py-8 text-center">Drop campers here</p>
              )
            : sortedCampers.map((camper) => (
                <CamperCard
                  key={camper.id}
                  camper={camper}
                  isDraggable={!isProductionMode}
                  isProductionMode={isProductionMode}
                  {...(onCamperClick && { onClick: onCamperClick })}
                  hasRequests={
                    camper.person_cm_id in requestStatus
                      ? (requestStatus[camper.person_cm_id] ?? true)
                      : true
                  }
                  {...(onCamperLockToggle && {
                    onLockToggle: onCamperLockToggle,
                  })}
                  {...(onCamperUnassign && { onUnassign: onCamperUnassign })}
                  lockState={isDraftMode ? getCamperLockState(camper.person_cm_id) : 'none'}
                  lockGroupColor={
                    isDraftMode ? getCamperLockGroupColor(camper.person_cm_id) : undefined
                  }
                  isDraftMode={isDraftMode}
                />
              ))}
        </SortableContext>
      </div>

      {/* Warnings */}
      <BunkWarnings
        isOverCapacity={isOverCapacity}
        ageGapWarning={ageGapWarning}
        gradeRatioWarning={gradeRatioWarning}
        tooManyGradesWarning={tooManyGradesWarning}
        capacity={defaultCapacity}
        isLocked={isLocked}
      />
    </div>
  )
}

export default BunkCard
