/**
 * Hook for managing camper movement (drag-drop) with scenario awareness
 * Extracted from SessionView.tsx
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { pb } from '../../lib/pocketbase';
import { solverService } from '../../services/solver';
import { graphCacheService } from '../../services/GraphCacheService';
import type { Session } from '../../types/app-types';
import type {
  AttendeesResponse,
  PersonsResponse,
  BunkAssignmentsResponse,
} from '../../types/pocketbase-types';

/**
 * Parsed camper ID result
 */
export interface ParsedCamperId {
  personCmId: number | null;
  sessionCmId: number | null;
  isComposite: boolean;
  legacyId?: string;
}

/**
 * Parse a composite camper ID (format: person_cm_id:session_cm_id)
 * or detect legacy format (just an ID string)
 */
export function parseCompositeCamperId(camperId: string): ParsedCamperId {
  if (camperId.includes(':')) {
    const parts = camperId.split(':');
    if (parts.length !== 2) {
      throw new Error(`Invalid camper ID format: ${camperId}`);
    }

    const personCmId = parseInt(parts[0] as string, 10);
    const sessionCmId = parseInt(parts[1] as string, 10);

    if (isNaN(personCmId) || isNaN(sessionCmId)) {
      throw new Error(`Invalid composite camper ID: ${camperId}`);
    }

    return {
      personCmId,
      sessionCmId,
      isComposite: true,
    };
  }

  // Legacy format - just an ID string
  return {
    personCmId: null,
    sessionCmId: null,
    isComposite: false,
    legacyId: camperId,
  };
}

/** Type for fetchWithAuth function */
export type FetchWithAuthFn = (
  url: string,
  options?: RequestInit & { skipAuth?: boolean }
) => Promise<Response>;

export interface UseCamperMovementOptions {
  selectedSession: string;
  currentYear: number;
  currentScenario: { id: string } | null;
  fetchWithAuth: FetchWithAuthFn;
  onPendingMoveCleared?: () => void;
}

export interface UseCamperMovementReturn {
  /** Move a camper to a bunk (or unassigned if bunkId is null) */
  moveCamper: (camperId: string, bunkId: string | null) => Promise<void>;
  /** Whether a move is in progress */
  isMoving: boolean;
}

/**
 * Resolve a camper ID to person and session CampMinder IDs
 */
async function resolveCamperIds(
  camperId: string
): Promise<{ personCmId: number; sessionCmId: number }> {
  const parsed = parseCompositeCamperId(camperId);

  if (parsed.isComposite && parsed.personCmId && parsed.sessionCmId) {
    return {
      personCmId: parsed.personCmId,
      sessionCmId: parsed.sessionCmId,
    };
  }

  // Legacy format - need to look up the attendee
  if (!parsed.legacyId) {
    throw new Error('Invalid camper ID format');
  }

  const attendee = await pb
    .collection<AttendeesResponse>('attendees')
    .getOne(parsed.legacyId);
  if (!attendee) {
    throw new Error('Attendee not found');
  }

  // Need to fetch the person to get cm_id
  const person = await pb
    .collection<PersonsResponse>('persons')
    .getOne(attendee.person);
  const personCmId = person['cm_id'];

  // Need to fetch the session to get cm_id
  const attendeeSession = await pb.collection('sessions').getOne(attendee.session);
  const sessionCmId = attendeeSession['cm_id'];

  return { personCmId, sessionCmId };
}

/**
 * Get bunk CampMinder ID from PocketBase bunk ID
 */
async function getBunkCmId(bunkId: string): Promise<number> {
  const bunk = await pb.collection('bunks').getOne(bunkId);
  if (!bunk) {
    throw new Error('Bunk not found');
  }
  return bunk.cm_id;
}

/**
 * Update draft assignment in scenario mode
 * Delegates to solverService.updateScenarioAssignment
 */
async function updateScenarioAssignment(
  scenarioId: string,
  personCmId: number,
  bunkCmId: number | null,
  sessionCmId: number,
  year: number,
  fetchWithAuth: FetchWithAuthFn
): Promise<unknown> {
  return solverService.updateScenarioAssignment(
    scenarioId,
    personCmId,
    bunkCmId,
    sessionCmId,
    year,
    fetchWithAuth
  );
}

/**
 * Try incremental position update (faster API endpoint)
 * Delegates to solverService.updateCamperPosition
 */
async function tryIncrementalUpdate(
  sessionCmId: number,
  personCmId: number,
  bunkCmId: number,
  currentYear: number,
  fetchWithAuth: FetchWithAuthFn
): Promise<{ success: boolean; result?: unknown }> {
  return solverService.updateCamperPosition(sessionCmId, personCmId, bunkCmId, currentYear, fetchWithAuth);
}

/**
 * Traditional assignment via PocketBase (fallback method)
 */
async function traditionalAssignment(
  personCmId: number,
  sessionCmId: number,
  bunkId: string | null,
  currentYear: number,
  selectedSession: string
): Promise<unknown> {
  // Look up attendee by CampMinder IDs
  const filter = `person_id = ${personCmId} && session_id = ${sessionCmId} && year = ${currentYear}`;
  const attendeeResp = await pb
    .collection<AttendeesResponse>('attendees')
    .getList(1, 1, { filter });

  if (attendeeResp.items.length === 0) {
    throw new Error(
      `Attendee not found for person ${personCmId} in session ${sessionCmId}`
    );
  }

  const attendee = attendeeResp.items[0];
  if (!attendee) {
    throw new Error(
      `Attendee not found for person ${personCmId} in session ${sessionCmId}`
    );
  }
  const attendeeId = attendee.id;

  // Get the attendee (camper)
  const attendeeData = await pb
    .collection<AttendeesResponse>('attendees')
    .getOne(attendeeId);
  if (!attendeeData) {
    throw new Error('Attendee not found');
  }

  // Get the session by CampMinder ID
  const sessionCmIdParsed =
    typeof selectedSession === 'string'
      ? parseInt(selectedSession, 10)
      : selectedSession;
  if (isNaN(sessionCmIdParsed)) {
    throw new Error(`Invalid session CampMinder ID: ${selectedSession}`);
  }

  const sessionResp = await pb.collection<Session>('camp_sessions').getList(1, 1, {
    filter: `cm_id = ${sessionCmIdParsed} && year = ${currentYear}`,
  });

  if (sessionResp.items.length === 0) {
    throw new Error(
      `Session with CampMinder ID ${sessionCmIdParsed} not found for year ${currentYear}`
    );
  }

  const assignmentSession = sessionResp.items[0];
  if (!assignmentSession) {
    throw new Error(
      `Session with CampMinder ID ${sessionCmIdParsed} not found for year ${currentYear}`
    );
  }
  const assignmentYear = currentYear;

  // Check if assignment already exists
  const existingAssignments = await pb
    .collection<BunkAssignmentsResponse>('bunk_assignments')
    .getList(1, 1, {
      filter: `person = "${attendeeData.person}" && session = "${attendeeData.session}" && year = ${assignmentYear}`,
    });

  if (bunkId === null) {
    // Remove assignment
    if (existingAssignments.items.length > 0) {
      const existingAssignment = existingAssignments.items[0];
      if (existingAssignment) {
        await pb.collection('bunk_assignments').delete(existingAssignment.id);
      }
    }
    return null;
  }

  // Get the bunk
  const bunk = await pb.collection('bunks').getOne(bunkId);
  if (!bunk) {
    throw new Error('Bunk not found');
  }

  // Prepare the assignment data using CampMinder IDs
  const assignmentData = {
    person: attendeeData.person,
    session: attendeeData.session,
    bunk: bunk.id,
    year: currentYear,
    is_active: true,
    is_locked: false,
  };

  if (existingAssignments.items.length > 0) {
    // Update existing assignment
    const existingAssignment = existingAssignments.items[0];
    if (existingAssignment) {
      const updated = await pb
        .collection('bunk_assignments')
        .update(existingAssignment.id, assignmentData);
      return {
        camperId: attendeeId,
        bunkId: bunkId,
        assignment: updated,
      };
    }
  }

  // Create new assignment
  const newAssignment = await pb.collection('bunk_assignments').create(assignmentData);
  return {
    camperId: attendeeId,
    bunkId: bunkId,
    assignment: newAssignment,
  };
}

export function useCamperMovement({
  selectedSession,
  currentYear,
  currentScenario,
  fetchWithAuth,
  onPendingMoveCleared,
}: UseCamperMovementOptions): UseCamperMovementReturn {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      camperId,
      bunkId,
    }: {
      camperId: string;
      bunkId: string | null;
    }) => {
      // Resolve camper IDs
      const { personCmId, sessionCmId } = await resolveCamperIds(camperId);

      // Scenario mode - update draft assignments via API
      if (currentScenario?.id) {
        let bunkCmId = null;
        if (bunkId) {
          try {
            bunkCmId = await getBunkCmId(bunkId);
          } catch (error) {
            console.error('Failed to get bunk:', error);
            throw new Error(`Failed to get bunk with ID ${bunkId}`);
          }
        }

        return await updateScenarioAssignment(
          currentScenario.id,
          personCmId,
          bunkCmId,
          sessionCmId,
          currentYear,
          fetchWithAuth
        );
      }

      // Production mode - try incremental update first
      if (bunkId) {
        try {
          const bunkCmId = await getBunkCmId(bunkId);
          const incrementalResult = await tryIncrementalUpdate(
            sessionCmId,
            personCmId,
            bunkCmId,
            currentYear,
            fetchWithAuth
          );

          if (incrementalResult.success) {
            return incrementalResult.result;
          }
        } catch (error) {
          console.error('Error getting bunk:', error);
        }
      }

      // Fall back to traditional assignment method
      return await traditionalAssignment(
        personCmId,
        sessionCmId,
        bunkId,
        currentYear,
        selectedSession
      );
    },
    onSuccess: (response) => {
      // Handle null response (e.g., production move to unassigned)
      if (!response) {
        queryClient.invalidateQueries({ queryKey: ['campers', selectedSession] });
        queryClient.invalidateQueries({ queryKey: ['bunk-request-status'] });
        onPendingMoveCleared?.();
        toast.success('Camper moved successfully');
        return;
      }

      // Check if an actual change occurred (backend returns changed: true/false)
      const wasChanged =
        (response as { changed?: boolean }).changed !== false;

      // Always invalidate queries to keep UI in sync
      queryClient.invalidateQueries({ queryKey: ['campers', selectedSession] });
      queryClient.invalidateQueries({ queryKey: ['bunk-request-status'] });
      onPendingMoveCleared?.();

      // Invalidate graph cache for the session
      const sessionCmId = parseInt(selectedSession, 10);
      if (!isNaN(sessionCmId)) {
        graphCacheService.invalidate(sessionCmId);
      }

      // Only show success message if something actually changed
      if (wasChanged) {
        toast.success('Camper moved successfully');
      }
    },
    onError: (error) => {
      console.error('Failed to move camper:', error);
      toast.error('Failed to move camper');
    },
  });

  const moveCamper = async (camperId: string, bunkId: string | null) => {
    await mutation.mutateAsync({ camperId, bunkId });
  };

  return {
    moveCamper,
    isMoving: mutation.isPending,
  };
}
