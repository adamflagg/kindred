/**
 * Transform functions to convert between PocketBase database types and application types
 */

import type { 
  PersonsResponse, 
  AttendeesResponse, 
  BunkAssignmentsResponse,
  BunksResponse,
  CampSessionsResponse,
  BunkRequestsResponse
} from '../types/pocketbase-types';
import { BunkRequestsStatusOptions } from '../types/pocketbase-types';
import type { Camper, Session, Bunk, BunkRequest } from '../types/app-types';
import { calculateAge } from './ageCalculator';

/**
 * Transform database responses to app-level Camper type
 */
export function toAppCamper(
  person: PersonsResponse,
  attendee: AttendeesResponse,
  _assignment?: BunkAssignmentsResponse | null,
  bunk?: BunksResponse | null,
  session?: CampSessionsResponse | null
): Camper {
  const displayName = `${person.first_name} ${person.last_name}`.trim() || '';
  
  // Extract session CM ID - prefer from session object, fallback to hardcoded logic
  const sessionCmId = session?.cm_id || 0; // We need the session to be passed in properly
  
  const camper: Camper = {
    id: `${person.cm_id}:${sessionCmId}`,
    attendee_id: attendee.id,
    name: displayName,
    first_name: person.first_name || '',
    last_name: person.last_name || '',
    preferred_name: person.preferred_name || '',
    age: person.birthdate ? calculateAge(person.birthdate) : 0,
    grade: person.grade || 0,
    gender: (person.gender as 'M' | 'F' | 'NB') || 'NB',
    session_cm_id: sessionCmId,
    ...(bunk?.id && { assigned_bunk: bunk.id }),
    ...(bunk?.cm_id !== undefined && { assigned_bunk_cm_id: bunk.cm_id }),
    person_cm_id: person.cm_id,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    years_at_camp: person.years_at_camp || 0,
    ...(person.school && { school: person.school }),
    pronouns: person.gender_pronoun_name || '',
    email: '',
    tags: [],
    ...(person.gender_identity_id && { gender_identity_id: person.gender_identity_id }),
    ...(person.gender_identity_name && { gender_identity_name: person.gender_identity_name }),
    ...(person.gender_identity_write_in && { gender_identity_write_in: person.gender_identity_write_in }),
    ...(person.gender_pronoun_id && { gender_pronoun_id: person.gender_pronoun_id }),
    ...(person.gender_pronoun_name && { gender_pronoun_name: person.gender_pronoun_name }),
    ...(person.gender_pronoun_write_in && { gender_pronoun_write_in: person.gender_pronoun_write_in }),
    ...(person.household_id && { household_id: person.household_id }),
    expand: {
      session: session as CampSessionsResponse | null,
      assigned_bunk: bunk as BunksResponse | null,
    },
  };

  return camper;
}

/**
 * Transform database response to app-level Session type
 */
export function toAppSession(session: CampSessionsResponse): Session {
  return {
    id: session.id,
    name: session.name,
    start_date: session.start_date || '',
    end_date: session.end_date || '',
    session_type: (session.session_type as Session['session_type']) || 'main',
    cm_id: session.cm_id,
    year: session.year,
    code: '', // persistent_id field doesn't exist in database
    persistent_id: '', // persistent_id field doesn't exist in database
    parent_id: session.parent_id,
    created: session.created || new Date().toISOString(),
    updated: session.updated || new Date().toISOString(),
  };
}

/**
 * Transform database response to app-level Bunk type
 */
export function toAppBunk(bunk: BunksResponse): Bunk {
  return {
    id: bunk.id,
    name: bunk.name,
    capacity: 0, // BunksResponse doesn't have capacity field
    session: '', // This should be provided by the caller if needed
    cm_id: bunk.cm_id,
    gender: bunk.gender,
    year: bunk.year,
    created: bunk.created || new Date().toISOString(),
    updated: bunk.updated || new Date().toISOString(),
  };
}

/**
 * Batch builder function to efficiently create Camper objects from fetched data
 * Uses Maps for O(1) lookups instead of nested loops
 */
export function buildCampersFromData(
  attendees: Array<AttendeesResponse<{ person?: PersonsResponse; session?: CampSessionsResponse }>>,
  assignments: Map<number, BunkAssignmentsResponse<{ bunk?: BunksResponse; person?: PersonsResponse }>>,
  bunks: Map<number, BunksResponse>
): Camper[] {
  const campers: Camper[] = [];
  
  for (const attendee of attendees) {
    // Get person from expanded relation
    const person = attendee.expand?.person;
    if (!person || !person.is_camper) continue;
    
    // Get session from expanded relation
    const session = attendee.expand?.session || null;
    
    // Get assignment and bunk using person CM ID
    const assignment = assignments.get(person.cm_id) || null;
    let bunk: BunksResponse | null = null;
    
    if (assignment) {
      // Try to get bunk from assignment expand first
      if (assignment.expand?.bunk && typeof assignment.expand.bunk === 'object') {
        bunk = assignment.expand.bunk as BunksResponse;
      }
      // Fallback to bunk map lookup using CM ID
      else {
        const assignmentWithBunkCmId = assignment as BunkAssignmentsResponse & { bunk_cm_id?: number };
        if (assignmentWithBunkCmId.bunk_cm_id) {
          bunk = bunks.get(assignmentWithBunkCmId.bunk_cm_id) ?? null;
        }
      }
    }
    
    // Use existing toAppCamper function for consistent transformation
    const camper = toAppCamper(person, attendee, assignment, bunk, session);
    campers.push(camper);
  }
  
  return campers;
}

/**
 * Helper to build Maps from arrays for efficient lookups
 */
export function createLookupMaps(data: {
  assignments?: Array<BunkAssignmentsResponse<{ person?: PersonsResponse; bunk?: BunksResponse }>>;
  bunks?: BunksResponse[];
}) {
  const maps = {
    assignments: new Map<number, BunkAssignmentsResponse<{ bunk?: BunksResponse; person?: PersonsResponse }>>(),
    bunks: new Map<number, BunksResponse>()
  };
  
  // Build assignment map by person CM ID
  if (data.assignments) {
    data.assignments.forEach(assignment => {
      // Get person CM ID from the expanded relation
      const person = assignment.expand?.person;
      if (person && 'cm_id' in person) {
        const personCmId = person.cm_id;
        if (personCmId) {
          maps.assignments.set(personCmId, assignment);
        }
      }
    });
  }
  
  // Build bunk map by CM ID
  if (data.bunks) {
    data.bunks.forEach(bunk => {
      if (bunk.cm_id) {
        maps.bunks.set(bunk.cm_id, bunk);
      }
    });
  }
  
  return maps;
}

/**
 * Transform database response to app-level BunkRequest type
 */
export function toAppBunkRequest(request: BunkRequestsResponse): BunkRequest {
  // Map DB request_type to app type
  let requestType: 'bunk_with' | 'not_bunk_with' | 'age_preference' = 'bunk_with';
  if (request.request_type === 'not_bunk_with') {
    requestType = 'not_bunk_with';
  } else if (request.request_type === 'age_preference') {
    requestType = 'age_preference';
  }
  
  // Map DB status to app status - DB only has resolved, pending, declined
  let status: 'resolved' | 'pending' | 'declined' = 'pending';
  if (request.status === BunkRequestsStatusOptions.resolved) {
    status = 'resolved';
  } else if (request.status === BunkRequestsStatusOptions.declined) {
    status = 'declined';
  } else if (request.status === BunkRequestsStatusOptions.pending) {
    status = 'pending';
  }
  
  return {
    id: request.id,
    request_type: requestType,
    requester_id: request.requester_id,
    requestee_id: request.requestee_id,
    priority: request.priority || 5,
    status: status,
    session_id: request.session_id,
    year: request.year,
    original_text: request.original_text || '',
    confidence_score: request.confidence_score || 0,
    parse_notes: request.parse_notes,
    is_reciprocal: false, // Not in DB type
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
}