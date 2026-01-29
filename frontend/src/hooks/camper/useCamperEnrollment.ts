/**
 * Hook for fetching camper enrollment data
 * Queries attendees with enrollment status and builds Camper objects
 */

import { useQuery } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';
import { VALID_SUMMER_SESSION_TYPES } from '../../constants/sessionTypes';
import { calculateAge } from '../../utils/ageCalculator';
import type { Camper } from '../../types/app-types';
import type { AttendeesResponse, BunkAssignmentsResponse, PersonsResponse } from '../../types/pocketbase-types';

export interface UseCamperEnrollmentResult {
  enrolledCampers: Camper[];
  isLoading: boolean;
  error: Error | null;
}

export function useCamperEnrollment(personCmId: number | null, currentYear: number): UseCamperEnrollmentResult {
  const isValidPersonId = !!personCmId && !isNaN(personCmId);

  const { data: enrolledCampers = [], isLoading, error } = useQuery({
    queryKey: ['enrolled-campers', personCmId, currentYear],
    queryFn: async () => {
      if (!personCmId) throw new Error('Invalid person ID');

      // Query attendees with enrollment status check - source of truth for enrollment
      // Filter to only valid summer session types (main, embedded, ag)
      const sessionTypeFilter = VALID_SUMMER_SESSION_TYPES.map(t => `session.session_type = "${t}"`).join(' || ');
      const filter = `person_id = ${personCmId} && year = ${currentYear} && status = "enrolled" && (${sessionTypeFilter})`;

      const attendees = await pb.collection<AttendeesResponse>('attendees').getFullList({
        filter,
        expand: 'person,session'
      });

      if (attendees.length === 0) {
        return [];
      }

      // Person data is now expanded in attendees, get from first attendee
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const person = (attendees[0]?.expand as any)?.person as PersonsResponse | undefined;
      if (!person) {
        throw new Error(`Person with CampMinder ID ${personCmId} not found`);
      }

      // Load all assignments for this person with expand to get bunk and session info
      const assignmentFilter = `year = ${currentYear}`;
      const allAssignments = await pb.collection<BunkAssignmentsResponse>('bunk_assignments').getFullList({
        filter: assignmentFilter,
        expand: 'person,session,bunk'
      });

      // Filter assignments for this person (using person CM ID from expanded person)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const personAssignments = allAssignments.filter(a => (a.expand as any)?.person?.cm_id === personCmId);

      // Transform attendees to campers
      const campers = attendees.map(attendee => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const expandedSession = (attendee.expand as any)?.session;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const expandedPerson = (attendee.expand as any)?.person || person;

        // Find assignment for this attendee's session
        // First try exact session match (for regular campers)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let assignment = personAssignments.find(a => (a.expand as any)?.session?.cm_id === expandedSession?.cm_id);

        // If no match found (e.g., AG campers with parent session assignments),
        // fall back to any assignment for this person in the current year
        if (!assignment && personAssignments.length > 0) {
          assignment = personAssignments[0]; // Person only has one bunk per year
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const assignedBunk = (assignment?.expand as any)?.bunk;

        const displayName = `${expandedPerson.first_name} ${expandedPerson.last_name}`.trim() || '';

        return {
          id: `${attendee.person_id}:${expandedSession?.cm_id || 0}`,
          attendee_id: attendee.id,
          name: displayName,
          first_name: expandedPerson.first_name,
          last_name: expandedPerson.last_name,
          preferred_name: expandedPerson.preferred_name,
          age: expandedPerson.age ?? (expandedPerson.birthdate ? calculateAge(expandedPerson.birthdate) : 0),
          birthdate: expandedPerson.birthdate,
          grade: expandedPerson.grade || 0,
          gender: (expandedPerson.gender as 'M' | 'F' | 'NB') || 'NB',
          session_cm_id: expandedSession?.cm_id || 0,
          assigned_bunk_cm_id: assignedBunk?.cm_id,
          assigned_bunk: assignedBunk?.id || '',
          person_cm_id: expandedPerson.cm_id,
          created: attendee.created || new Date().toISOString(),
          updated: attendee.updated || new Date().toISOString(),
          years_at_camp: expandedPerson.years_at_camp || 0,
          school: expandedPerson.school,
          pronouns: expandedPerson.gender_pronoun_name || '',
          email: '',
          tags: [],
          gender_identity_id: expandedPerson.gender_identity_id,
          gender_identity_name: expandedPerson.gender_identity_name,
          gender_identity_write_in: expandedPerson.gender_identity_write_in,
          gender_pronoun_id: expandedPerson.gender_pronoun_id,
          gender_pronoun_name: expandedPerson.gender_pronoun_name,
          gender_pronoun_write_in: expandedPerson.gender_pronoun_write_in,
          household_id: expandedPerson.household_id,
          address: expandedPerson.address,
          expand: {
            session: expandedSession,
            assigned_bunk: assignedBunk,
          },
        } as Camper;
      });

      return campers;
    },
    enabled: isValidPersonId,
    retry: false,
  });

  return {
    enrolledCampers,
    isLoading,
    error: error as Error | null,
  };
}
