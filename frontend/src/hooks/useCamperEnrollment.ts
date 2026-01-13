/**
 * Shared hook for fetching camper enrollment data
 * Used by both CamperDetailsPanel (modal) and CamperDetail (full page)
 */

import { useQuery } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import { useYear } from './useCurrentYear';
import { toAppCamper } from '../utils/transforms';
import { VALID_SUMMER_SESSION_TYPES } from '../constants/sessionTypes';
import type { PersonsResponse, AttendeesResponse, BunkAssignmentsResponse } from '../types/pocketbase-types';
import { Collections } from '../types/pocketbase-types';
import type { Camper } from '../types/app-types';

interface UseCamperEnrollmentResult {
  camper: Camper | null;
  person: PersonsResponse | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Fetch camper enrollment data by CampMinder person ID
 * Filters to valid summer session types (main, embedded, ag)
 * Returns the primary camper with session and bunk info expanded
 */
export function useCamperEnrollment(personCmId: string | number | null | undefined): UseCamperEnrollmentResult {
  const currentYear = useYear();
  const numericId = personCmId ? (typeof personCmId === 'string' ? parseInt(personCmId, 10) : personCmId) : null;
  const isValid = !!numericId && !isNaN(numericId);

  const { data, isLoading, error } = useQuery({
    queryKey: ['camper-enrollment', numericId, currentYear],
    queryFn: async () => {
      if (!numericId) throw new Error('Invalid person ID');

      // 1. Fetch person record
      const persons = await pb.collection('persons').getFullList<PersonsResponse>({
        filter: `cm_id = ${numericId} && year = ${currentYear}`
      });

      if (persons.length === 0) {
        throw new Error('Person not found');
      }
      const person = persons[0] as PersonsResponse;

      // 2. Fetch attendees filtered by summer session types
      const sessionTypeFilter = VALID_SUMMER_SESSION_TYPES.map(t => `session.session_type = "${t}"`).join(' || ');
      const attendees = await pb.collection('attendees').getFullList<AttendeesResponse>({
        filter: `person_id = ${numericId} && year = ${currentYear} && status = "enrolled" && (${sessionTypeFilter})`,
        expand: 'session'
      });

      // If no enrollments, return person with dummy attendee
      if (attendees.length === 0) {
        const dummyAttendee = {
          id: '',
          person: person.id,
          person_id: numericId,
          session: '',
          enrollment_date: new Date().toISOString(),
          is_active: true,
          status: 'enrolled' as const,
          status_id: 1,
          year: currentYear,
          collectionId: '',
          collectionName: Collections.Attendees,
          created: new Date().toISOString(),
          updated: new Date().toISOString()
        } as unknown as AttendeesResponse;

        return {
          camper: toAppCamper(person, dummyAttendee),
          person
        };
      }

      // 3. Get primary attendee (prefer main session)
      const sortedAttendees = [...attendees].sort((a, b) => {
        const aType = (a.expand as { session?: { session_type?: string } })?.session?.session_type || 'unknown';
        const bType = (b.expand as { session?: { session_type?: string } })?.session?.session_type || 'unknown';
        const typeOrder: Record<string, number> = { 'main': 1, 'embedded': 2, 'ag': 3 };
        return (typeOrder[aType] || 999) - (typeOrder[bType] || 999);
      });

      // Get first attendee - we know this exists since we returned early if attendees.length === 0
      const attendee = sortedAttendees[0];
      if (!attendee) throw new Error('No attendee found');
      const session = (attendee.expand as { session?: unknown })?.session ?? null;

      // 4. Fetch bunk assignment for this session
      let bunk = null;
      if (attendee?.session) {
        const assignments = await pb.collection('bunk_assignments').getFullList<BunkAssignmentsResponse>({
          filter: `person = "${person.id}" && session = "${attendee.session}" && year = ${currentYear}`,
          expand: 'bunk'
        });
        if (assignments.length > 0) {
          bunk = (assignments[0]?.expand as { bunk?: unknown })?.bunk || null;
        }
      }

      // 5. Build and return camper
      const camper = toAppCamper(
        person,
        attendee,
        null, // assignment not needed for toAppCamper
        bunk as Parameters<typeof toAppCamper>[3],
        session as Parameters<typeof toAppCamper>[4]
      );

      // Add birthdate and address to camper for display purposes
      return {
        camper: {
          ...camper,
          birthdate: person.birthdate,
          address: person.address
        } as Camper & { birthdate?: string; address?: string },
        person
      };
    },
    enabled: isValid,
    retry: false,
    staleTime: 30000, // Cache for 30 seconds
  });

  return {
    camper: data?.camper ?? null,
    person: data?.person ?? null,
    isLoading,
    error: error as Error | null
  };
}
