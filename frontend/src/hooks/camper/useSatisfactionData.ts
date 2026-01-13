/**
 * Hook for checking request satisfaction status
 * Lazy-loads after main data to avoid blocking the page
 */

import { useQuery } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';
import { isAgePreferenceSatisfied } from '../../utils/agePreferenceSatisfaction';
import { formatGradeOrdinal } from '../../utils/gradeUtils';
import type { BunkAssignmentsResponse } from '../../types/pocketbase-types';
import type { SatisfactionMap } from './types';
import type { EnhancedBunkRequest } from './useAllBunkRequests';

export interface UseSatisfactionDataResult {
  satisfactionData: SatisfactionMap;
  isLoading: boolean;
  error: Error | null;
}

export function useSatisfactionData(
  personCmId: number | undefined,
  assignedBunkCmId: number | undefined,
  sessionCmId: number | undefined,
  camperGrade: number | undefined,
  currentYear: number,
  allBunkRequests: EnhancedBunkRequest[]
): UseSatisfactionDataResult {
  const { data: satisfactionData = {}, isLoading, error } = useQuery<SatisfactionMap>({
    queryKey: ['request-satisfaction', personCmId, assignedBunkCmId, sessionCmId, camperGrade, currentYear, allBunkRequests.map(r => r.id).join(',')],
    queryFn: async () => {
      const results: SatisfactionMap = {};

      if (!assignedBunkCmId || !sessionCmId) {
        // Requester not assigned - can't check satisfaction
        return results;
      }

      // Get resolved person-based requests with valid targets
      const resolvedPersonRequests = allBunkRequests.filter(r =>
        r.status === 'resolved' &&
        r.requestee_id &&
        r.requestee_id > 0 &&
        (r.request_type === 'bunk_with' || r.request_type === 'not_bunk_with')
      );

      // Get age preference requests (check all, not just resolved)
      const agePreferenceRequests = allBunkRequests.filter(r =>
        r.request_type === 'age_preference' &&
        r.age_preference_target // Has a preference set (older/younger)
      );

      if (resolvedPersonRequests.length === 0 && agePreferenceRequests.length === 0) {
        return results;
      }

      // Batch fetch bunk assignments for this year, then filter by session on client
      // We expand session to get the session CM ID for filtering
      const assignmentFilter = `year = ${currentYear}`;

      try {
        const allAssignments = await pb.collection<BunkAssignmentsResponse>('bunk_assignments').getFullList({
          filter: assignmentFilter,
          expand: 'person,bunk,session'
        });

        // Type for expanded assignment records
        interface ExpandedAssignmentData {
          session?: { cm_id?: number };
          person?: { cm_id?: number; grade?: number };
          bunk?: { cm_id?: number };
        }

        // Filter assignments to only include those for the same session as the requester
        const sessionAssignments = allAssignments.filter(assignment => {
          const expanded = assignment.expand as ExpandedAssignmentData | undefined;
          return expanded?.session?.cm_id === sessionCmId;
        });

        // Create maps for person -> bunk and bunk -> persons with grades
        const personToBunkMap = new Map<number, number>();
        const bunkToPersonsMap = new Map<number, Array<{ cmId: number; grade: number }>>();

        sessionAssignments.forEach(assignment => {
          const expanded = assignment.expand as ExpandedAssignmentData | undefined;
          const person = expanded?.person;
          const bunk = expanded?.bunk;
          const personCmIdValue = person?.cm_id;
          const bunkCmId = bunk?.cm_id;
          const grade = person?.grade;

          if (personCmIdValue && bunkCmId) {
            personToBunkMap.set(personCmIdValue, bunkCmId);

            // Track persons in each bunk with their grades
            if (!bunkToPersonsMap.has(bunkCmId)) {
              bunkToPersonsMap.set(bunkCmId, []);
            }
            if (grade !== undefined && grade !== null) {
              const bunkPersons = bunkToPersonsMap.get(bunkCmId);
              if (bunkPersons) {
                bunkPersons.push({ cmId: personCmIdValue, grade });
              }
            }
          }
        });

        // Check each resolved person-based request
        for (const request of resolvedPersonRequests) {
          if (!request.requestee_id) continue;
          const targetBunkCmId = personToBunkMap.get(request.requestee_id);

          if (!targetBunkCmId) {
            // Target has no bunk assignment - definitively not in same bunk
            if (request.request_type === 'bunk_with') {
              // Wanted to bunk together, but target isn't assigned → not satisfied
              results[request.id] = {
                status: 'not_satisfied',
                detail: 'Target not assigned'
              };
            } else if (request.request_type === 'not_bunk_with') {
              // Wanted to NOT bunk together, and target isn't assigned → satisfied
              results[request.id] = {
                status: 'satisfied',
                detail: 'Target not assigned'
              };
            }
            continue;
          }

          const sameBunk = assignedBunkCmId === targetBunkCmId;

          if (request.request_type === 'bunk_with') {
            results[request.id] = {
              status: sameBunk ? 'satisfied' : 'not_satisfied',
              detail: sameBunk ? 'Same bunk' : 'Different bunks'
            };
          } else if (request.request_type === 'not_bunk_with') {
            results[request.id] = {
              status: !sameBunk ? 'satisfied' : 'not_satisfied',
              detail: !sameBunk ? 'Different bunks' : 'Same bunk (conflict!)'
            };
          }
        }

        // Check age preference requests
        for (const request of agePreferenceRequests) {
          const allInBunk = bunkToPersonsMap.get(assignedBunkCmId) || [];
          // Filter out the camper to get only bunkmates
          const bunkmates = allInBunk.filter(b => b.cmId !== personCmId);
          const grade = camperGrade || 0;

          if (bunkmates.length === 0) {
            results[request.id] = {
              status: 'not_satisfied',
              detail: 'No bunkmates assigned yet'
            };
            continue;
          }

          // Get bunkmate grades (filter out nulls)
          const bunkmateGrades = bunkmates.map(b => b.grade).filter((g): g is number => g !== null && g !== undefined);

          if (bunkmateGrades.length === 0) {
            results[request.id] = {
              status: 'not_satisfied',
              detail: 'No bunkmate grades available'
            };
            continue;
          }

          // Use shared utility for consistent satisfaction logic
          const preference = request.age_preference_target as 'older' | 'younger';
          const { satisfied, detail } = isAgePreferenceSatisfied(grade, bunkmateGrades, preference);

          // Calculate grade distribution for rich UI display
          const gradeCounts = new Map<number, number>();
          bunkmates.forEach(b => {
            if (b.grade !== null && b.grade !== undefined) {
              gradeCounts.set(b.grade, (gradeCounts.get(b.grade) || 0) + 1);
            }
          });

          const sortedGrades = Array.from(gradeCounts.entries())
            .sort((a, b) => a[0] - b[0]);

          const gradeBreakdown = sortedGrades
            .map(([g, count]) => `${formatGradeOrdinal(g)}: ${count}`)
            .join(' | ');

          results[request.id] = {
            status: satisfied ? 'satisfied' : 'not_satisfied',
            detail: `Bunk: ${gradeBreakdown} — ${detail}`
          };
        }

        return results;
      } catch (err) {
        console.error('Error checking request satisfaction:', err);
        return results;
      }
    },
    enabled: !!personCmId && allBunkRequests.length > 0,
    staleTime: 60000, // Cache for 1 minute
  });

  return {
    satisfactionData,
    isLoading,
    error: error as Error | null,
  };
}
