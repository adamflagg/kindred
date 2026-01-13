/**
 * Hook for fetching sibling data based on household_id
 * Finds other enrolled campers in the same household
 */

import { useQuery } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';
import { VALID_SUMMER_SESSION_TYPES } from '../../constants/sessionTypes';
import type { PersonsResponse, AttendeesResponse, BunkAssignmentsResponse } from '../../types/pocketbase-types';
import type { SiblingWithEnrollment } from './types';

export interface UseSiblingsResult {
  siblings: SiblingWithEnrollment[];
  isLoading: boolean;
  error: Error | null;
}

export function useSiblings(
  householdId: number | undefined,
  personCmId: number | null,
  currentYear: number
): UseSiblingsResult {
  const { data: siblings = [], isLoading, error } = useQuery({
    queryKey: ['camper-siblings', householdId, personCmId, currentYear],
    queryFn: async () => {
      if (!householdId || householdId === 0 || !personCmId) {
        return [];
      }

      // Find other persons with same household_id who have a grade (excludes parents)
      const siblingFilter = `household_id = ${householdId} && cm_id != ${personCmId} && grade > 0 && year = ${currentYear}`;

      let siblingPersons: PersonsResponse[] = [];
      try {
        siblingPersons = await pb.collection<PersonsResponse>('persons').getFullList({
          filter: siblingFilter,
          sort: '-birthdate' // Oldest first
        });
      } catch (err) {
        console.error('Error fetching siblings:', err);
        return [];
      }

      if (siblingPersons.length === 0) return [];

      // For each sibling, check if they're enrolled in any valid summer session
      const siblingsWithEnrollment = await Promise.all(
        siblingPersons.map(async (siblingPerson) => {
          // Check if this sibling has any enrollment in valid summer sessions
          const sessionTypeFilter = VALID_SUMMER_SESSION_TYPES.map(t => `session.session_type = "${t}"`).join(' || ');
          const enrollmentFilter = `person_id = ${siblingPerson.cm_id} && year = ${currentYear} && status = "enrolled" && (${sessionTypeFilter})`;

          try {
            const attendees = await pb.collection<AttendeesResponse>('attendees').getFullList({
              filter: enrollmentFilter,
              expand: 'session',
              $autoCancel: false
            });

            if (attendees.length === 0) {
              return null; // Not enrolled
            }

            // Get the first valid enrollment (prefer main session)
            const sortedAttendees = attendees.sort((a, b) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const aType = (a.expand as any)?.session?.session_type || 'unknown';
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const bType = (b.expand as any)?.session?.session_type || 'unknown';
              const typeOrder: Record<string, number> = { 'main': 1, 'embedded': 2, 'ag': 3 };
              return (typeOrder[aType] || 999) - (typeOrder[bType] || 999);
            });

            const primaryAttendee = sortedAttendees[0];
            if (!primaryAttendee) {
              return null;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const session = (primaryAttendee.expand as any)?.session;

            // Try to get bunk assignment
            let bunkName: string | null = null;
            if (session) {
              try {
                const assignments = await pb.collection<BunkAssignmentsResponse>('bunk_assignments').getFullList({
                  filter: `person = "${siblingPerson?.id || ''}" && session = "${session?.id || ''}" && year = ${currentYear}`,
                  expand: 'bunk',
                  $autoCancel: false
                });

                if (assignments.length > 0 && assignments[0]) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  bunkName = (assignments[0].expand as any)?.bunk?.name || null;
                }
              } catch {
                // Assignment fetch failed, continue without bunk
              }
            }

            return {
              ...siblingPerson,
              session: session ? {
                id: session.id,
                cm_id: session.cm_id,
                name: session.name,
                session_type: session.session_type,
                start_date: session.start_date,
                end_date: session.end_date,
              } : undefined,
              bunkName
            } as SiblingWithEnrollment;
          } catch (err) {
            console.error(`Error checking enrollment for sibling ${siblingPerson.cm_id}:`, err);
            return null;
          }
        })
      );

      // Filter out nulls (siblings not enrolled)
      return siblingsWithEnrollment.filter((s): s is SiblingWithEnrollment => s !== null);
    },
    enabled: !!(householdId && householdId > 0),
    staleTime: 0, // Always fetch fresh data
  });

  return {
    siblings,
    isLoading,
    error: error as Error | null,
  };
}
