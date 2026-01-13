import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import clsx from 'clsx';
import { Network } from 'lucide-react';
import type { BunkWithCampers, Camper } from '../types/app-types';
import CamperCard from './CamperCard';
import { useBunkRequestsFromContext } from '../hooks';
import { formatGradeOrdinal } from '../utils/gradeUtils';
import { getDisplayAgeForYear } from '../utils/displayAge';
import { useYear } from '../hooks/useCurrentYear';
import { useLockGroupContext } from '../contexts/LockGroupContext';
import { BunkUtilizationBar } from './BunkUtilizationBar';
import { BunkWarnings } from './BunkWarnings';

interface BunkCardProps {
  bunk: BunkWithCampers;
  onCamperClick?: (camper: Camper) => void;
  onCamperLockToggle?: (camper: Camper) => void;
  onCamperUnassign?: (camper: Camper) => void;
  onShowSocialGraph?: () => void;
  isDragging?: boolean;
  isProductionMode?: boolean;
  defaultCapacity?: number;
  activeDragCamper?: Camper | null;
}

/**
 * Extracts grade range from a name string.
 * Mirrors the Go logic in pocketbase/sync/bunk_plans.go:extractGradeRange()
 *
 * @returns [minGrade, maxGrade] or [0, 0] if no grade found
 */
function extractGradeRange(name: string): [number, number] {
  if (!name) return [0, 0];

  // Pattern 1: "X/Y" format (e.g., "9/10", "7/8")
  const slashMatch = name.match(/(\d+)\/(\d+)/);
  if (slashMatch?.[1] && slashMatch[2]) {
    const g1 = parseInt(slashMatch[1], 10);
    const g2 = parseInt(slashMatch[2], 10);
    return [Math.min(g1, g2), Math.max(g1, g2)];
  }

  // Pattern 2: "Xth - Yth" format (e.g., "7th - 9th", "7th & 8th")
  const rangeMatch = name.match(/(\d+)(?:st|nd|rd|th)?\s*[-–&]\s*(\d+)(?:st|nd|rd|th)?/);
  if (rangeMatch?.[1] && rangeMatch[2]) {
    const g1 = parseInt(rangeMatch[1], 10);
    const g2 = parseInt(rangeMatch[2], 10);
    return [Math.min(g1, g2), Math.max(g1, g2)];
  }

  // Pattern 3: Single number after "AG-" (e.g., "AG-8" → 8, 8)
  const singleMatch = name.match(/AG[-\s](\d+)/i);
  if (singleMatch?.[1]) {
    const grade = parseInt(singleMatch[1], 10);
    return [grade, grade];
  }

  return [0, 0];
}

/**
 * Checks if a grade is within a range (inclusive)
 */
function gradeInRange(grade: number, min: number, max: number): boolean {
  return grade >= min && grade <= max;
}

/**
 * Checks if two grade ranges have any overlap
 */
function gradesOverlap(min1: number, max1: number, min2: number, max2: number): boolean {
  return !(max1 < min2 || min1 > max2);
}

function BunkCard({ bunk, onCamperClick, onCamperLockToggle, onCamperUnassign, onShowSocialGraph, isDragging = false, isProductionMode = false, defaultCapacity = 12, activeDragCamper = null }: BunkCardProps) {
  const viewingYear = useYear();
  // Use bunk.capacity if set, otherwise fall back to config default
  const effectiveCapacity = bunk.capacity || defaultCapacity;

  // Check if this bunk is a valid drop target for the dragged camper
  const isValidDropTarget = (): boolean => {
    if (!activeDragCamper) return true; // No drag = valid

    const bunkGender = bunk.gender?.toLowerCase();
    const isFromAGSession = activeDragCamper.expand?.session?.session_type === 'ag';

    if (isFromAGSession) {
      // AG campers can only go to Mixed (AG) bunks
      if (bunkGender !== 'mixed') {
        return false;
      }

      // Check if bunk grade is compatible with session grade range
      // Logic mirrors pocketbase/sync/bunk_plans.go lines 329-360
      const sessionName = activeDragCamper.expand?.session?.name || '';
      const [sessionGradeMin, sessionGradeMax] = extractGradeRange(sessionName);
      const [bunkGradeMin, bunkGradeMax] = extractGradeRange(bunk.name || '');

      // If we can extract grades from both, check compatibility
      if (bunkGradeMin > 0 && sessionGradeMin > 0) {
        if (bunkGradeMin === bunkGradeMax) {
          // Single grade bunk (e.g., "AG-8") - must be within session range
          if (!gradeInRange(bunkGradeMin, sessionGradeMin, sessionGradeMax)) {
            return false;
          }
        } else {
          // Range bunk - check for any overlap with session range
          if (!gradesOverlap(bunkGradeMin, bunkGradeMax, sessionGradeMin, sessionGradeMax)) {
            return false;
          }
        }
      }

      return true;
    }

    // Non-AG campers go to gendered bunks based on their gender
    if (activeDragCamper.gender === 'M') {
      return bunkGender === 'm' || bunk.name?.startsWith('B-');
    }
    if (activeDragCamper.gender === 'F') {
      return bunkGender === 'f' || bunk.name?.startsWith('G-');
    }

    return true; // Unknown gender = allow anywhere
  };

  const dropDisabled = !isValidDropTarget();

  const { setNodeRef, isOver } = useDroppable({
    id: `bunk-${bunk.id}`,
    disabled: dropDisabled,
  });

  // Get lock group context for draft mode lock states
  const { getCamperLockState, getCamperLockGroupColor, isDraftMode } = useLockGroupContext();

  // Get bunk request status for all campers in this bunk
  const camperPersonIds = bunk.campers.map(c => c.person_cm_id);
  const bunkCampersWithGrades = bunk.campers.map(c => ({ cmId: c.person_cm_id, grade: c.grade }));
  const { data: requestStatus = {} } = useBunkRequestsFromContext(camperPersonIds);

  const utilizationColor =
    bunk.occupancy > effectiveCapacity ? 'text-red-600 dark:text-red-400' :
    bunk.utilization >= 90 ? 'text-orange-600 dark:text-orange-400' :
    bunk.utilization >= 70 ? 'text-yellow-600 dark:text-yellow-400' :
    'text-green-600 dark:text-green-400';
    
    
  // Calculate grade distribution, age range, and capacity warnings
  // React Compiler will automatically optimize these calculations
  const calculateBunkStats = () => {
    // Quick path when dragging - just sort campers
    if (isDragging) {
      const sorted = [...bunk.campers].sort((a, b) => a.age - b.age);
      return {
        gradeDistribution: null,
        ageRange: null,
        sortedCampers: sorted,
        ageGapWarning: false,
        gradeRatioWarning: false,
        tooManyGradesWarning: false,
        isOverCapacity: false
      };
    }
    // Calculate over capacity inside useMemo
    const isOverCapacity = bunk.occupancy > effectiveCapacity;
    
    
    // Sort campers by age (youngest to oldest)
    const sorted = [...bunk.campers].sort((a, b) => a.age - b.age);
    
    // Calculate grade distribution
    const gradeCounts = new Map<number, number>();
    bunk.campers.forEach(camper => {
      const grade = camper.grade;
      gradeCounts.set(grade, (gradeCounts.get(grade) || 0) + 1);
    });
    
    // Get all grades sorted by count
    const sortedGrades = Array.from(gradeCounts.entries())
      .sort((a, b) => b[1] - a[1]);
    
    let gradeDistribution = null;
    let gradeRatioWarning = false;
    let tooManyGradesWarning = false;
    
    // Check if there are more than 2 different grades
    tooManyGradesWarning = sortedGrades.length > 2;
    
    if (sortedGrades.length === 1) {
      gradeDistribution = { single: sortedGrades[0] };
    } else if (sortedGrades.length === 2) {
      const firstGrade = sortedGrades[0];
      const secondGrade = sortedGrades[1];
      if (!firstGrade || !secondGrade) {
        gradeDistribution = null;
      } else {
        let [grade1, count1] = firstGrade;
        let [grade2, count2] = secondGrade;
      
      // Ensure younger grade (lower number) is first
      if (grade1 > grade2) {
        [grade1, grade2] = [grade2, grade1];
        [count1, count2] = [count2, count1];
      }
      
      const total = bunk.campers.length;
      const ratio1 = Math.round((count1 / total) * 100);
      const ratio2 = Math.round((count2 / total) * 100);
      gradeDistribution = { type: 'double', grade1, grade2, ratio1, ratio2, count1, count2 };
      
      // Check if any grade exceeds 67% ratio
      gradeRatioWarning = ratio1 > 67 || ratio2 > 67;
      }
    } else if (sortedGrades.length >= 3) {
      // For 3+ grades, show all of them
      const total = bunk.campers.length;
      const gradesWithPercentages = sortedGrades
        .map(([grade, count]) => ({
          grade,
          count,
          percentage: Math.round((count / total) * 100)
        }))
        .sort((a, b) => a.grade - b.grade); // Sort by grade number for display
      gradeDistribution = { type: 'multiple', grades: gradesWithPercentages };
      
      // Check if any grade exceeds 67% ratio
      gradeRatioWarning = gradesWithPercentages.some(g => g.percentage > 67);
    }
    
    // Calculate age range (24 months = 2 years)
    let ageRange = null;
    let ageGapWarning = false;
    if (sorted.length > 0) {
      const youngestCamper = sorted[0];
      const oldestCamper = sorted[sorted.length - 1];
      if (!youngestCamper || !oldestCamper) {
        ageRange = null;
        ageGapWarning = false;
      } else {
        const youngest = youngestCamper.age;
        const oldest = oldestCamper.age;
        ageRange = { youngest, oldest };
        ageGapWarning = (oldest - youngest) > 2.0; // 24 months
      }
    }
    
    
    return { 
      gradeDistribution, 
      ageRange, 
      sortedCampers: sorted, 
      ageGapWarning,
      gradeRatioWarning,
      tooManyGradesWarning,
      isOverCapacity
    };
  };
  
  const { gradeDistribution, ageRange, sortedCampers, ageGapWarning, gradeRatioWarning, tooManyGradesWarning, isOverCapacity } = calculateBunkStats();

  return (
    <div
      data-bunk-card
      ref={setNodeRef}
      className={clsx(
        'card-lodge p-4 transition-all relative',
        isOver && 'ring-2 ring-primary bg-primary/5',
        'hover:shadow-lodge-lg',
        (ageGapWarning || gradeRatioWarning || tooManyGradesWarning || isOverCapacity) && 'border-destructive/50 border-2',
        // Production mode warning during drag
        isDragging && isProductionMode && 'border-accent border-2 bg-accent/5',
        // Disabled drop target styling - grey out invalid gender matches
        dropDisabled && activeDragCamper && 'opacity-40 pointer-events-none'
      )}
      style={{
        contain: 'layout style paint',
        willChange: isDragging ? 'transform' : 'auto'
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex-1">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            {bunk.name}
            {(ageGapWarning || gradeRatioWarning || tooManyGradesWarning || isOverCapacity) && (
              <span className="text-red-600 text-sm">⚠️</span>
            )}
          </h3>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 text-sm">
              <span className={clsx('font-medium', utilizationColor)}>
                {bunk.occupancy}/{effectiveCapacity}
              </span>
              {gradeDistribution && (
                <div className="text-muted-foreground flex-1">
                  {gradeDistribution.single ? (
                    <>{formatGradeOrdinal(gradeDistribution.single[0])}</>
                  ) : gradeDistribution.type === 'double' ? (
                    <>
                      <span className={(gradeDistribution.ratio1 ?? 0) > 67 ? 'text-red-600 font-medium' : ''}>
                        {formatGradeOrdinal(gradeDistribution.grade1)}: {gradeDistribution.count1}
                      </span>
                      {' | '}
                      <span className={(gradeDistribution.ratio2 ?? 0) > 67 ? 'text-red-600 font-medium' : ''}>
                        {formatGradeOrdinal(gradeDistribution.grade2)}: {gradeDistribution.count2}
                      </span>
                    </>
                  ) : gradeDistribution.type === 'multiple' ? (
                    <div className="flex flex-wrap text-xs items-center">
                      {gradeDistribution.grades?.map((g, index) => (
                        <React.Fragment key={g.grade}>
                          {index > 0 && <span className="mx-1">|</span>}
                          <span 
                            className={clsx(
                              "whitespace-nowrap",
                              g.percentage > 67 && "text-red-600 font-medium"
                            )}
                          >
                            {formatGradeOrdinal(g.grade)}: {g.count}
                          </span>
                        </React.Fragment>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            {ageRange && (() => {
              const youngest = sortedCampers[0];
              const oldest = sortedCampers[sortedCampers.length - 1];
              if (!youngest || !oldest) return null;
              return (
                <div className={clsx(
                  "text-xs",
                  ageGapWarning ? "text-red-600 font-medium" : "text-muted-foreground"
                )}>
                  Ages: {(getDisplayAgeForYear(youngest, viewingYear) ?? 0).toFixed(2)} - {(getDisplayAgeForYear(oldest, viewingYear) ?? 0).toFixed(2)}
                  {ageGapWarning && " ⚠️"}
                </div>
              );
            })()}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {onShowSocialGraph && bunk.campers.length > 0 && (
            <button
              onClick={onShowSocialGraph}
              className="btn-ghost p-2"
              title="View social network"
            >
              <Network className="w-5 h-5" />
            </button>
          )}
          
        </div>
      </div>

      {/* Utilization Bar */}
      <BunkUtilizationBar 
        utilization={bunk.utilization}
        occupancy={bunk.occupancy}
        capacity={effectiveCapacity}
      />

      {/* Campers List */}
      <div className="space-y-2 min-h-[100px]">
        <SortableContext
          items={sortedCampers.map(c => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {sortedCampers.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              Drop campers here
            </p>
          ) : (
            sortedCampers.map(camper => (
              <CamperCard
                key={camper.id}
                camper={camper}
                isDraggable={!isProductionMode}
                {...(onCamperClick && { onClick: onCamperClick })}
                hasRequests={(requestStatus && typeof requestStatus === 'object' && camper.person_cm_id in requestStatus ? requestStatus[camper.person_cm_id] : true) || false}
                {...(onCamperLockToggle && { onLockToggle: onCamperLockToggle })}
                {...(onCamperUnassign && { onUnassign: onCamperUnassign })}
                bunkCampers={bunkCampersWithGrades}
                lockState={isDraftMode ? getCamperLockState(camper.person_cm_id) : 'none'}
                lockGroupColor={isDraftMode ? getCamperLockGroupColor(camper.person_cm_id) : undefined}
                isDraftMode={isDraftMode}
              />
            ))
          )}
        </SortableContext>
      </div>

      {/* Warnings */}
      <BunkWarnings
        isOverCapacity={isOverCapacity}
        ageGapWarning={ageGapWarning}
        gradeRatioWarning={gradeRatioWarning}
        tooManyGradesWarning={tooManyGradesWarning}
        capacity={effectiveCapacity}
        isLocked={false}
      />
    </div>
  );
}

export default BunkCard;