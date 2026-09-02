/**
 * Transform functions to convert between PocketBase database types and application types
 */

import type {
  PersonsResponse,
  AttendeesResponse,
  BunkAssignmentsResponse,
  BunksResponse,
  CampSessionsResponse,
} from '../types/pocketbase-types'
import type { Camper } from '../types/app-types'
import { normalizeGender } from './genderUtils'

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
  const displayName = `${person.first_name} ${person.last_name}`.trim() || ''

  // Extract session CM ID - prefer from session object, fallback to hardcoded logic
  const sessionCmId = session?.cm_id ?? 0 // We need the session to be passed in properly

  const camper: Camper = {
    id: `${person.cm_id}:${sessionCmId}`,
    attendee_id: attendee.id,
    attendee_status: attendee.status,
    name: displayName,
    first_name: person.first_name || '',
    last_name: person.last_name || '',
    preferred_name: person.preferred_name || '',
    age: typeof person.age === 'number' ? person.age : 0,
    birthdate: person.birthdate,
    grade: person.grade || 0,
    gender: normalizeGender(person.gender),
    session_cm_id: sessionCmId,
    ...(bunk?.id && { assigned_bunk: bunk.id }),
    ...(bunk?.cm_id !== undefined && { assigned_bunk_cm_id: bunk.cm_id }),
    person_cm_id: person.cm_id,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    years_at_camp: person.years_at_camp || 0,
    ...((person.normalized_school || person.school) && {
      school: person.normalized_school || person.school,
    }),
    pronouns: person.gender_pronoun_name || '',
    email: '',
    tags: [],
    ...(person.gender_identity_id && {
      gender_identity_id: person.gender_identity_id,
    }),
    ...(person.gender_identity_name && {
      gender_identity_name: person.gender_identity_name,
    }),
    ...(person.gender_identity_write_in && {
      gender_identity_write_in: person.gender_identity_write_in,
    }),
    ...(person.gender_pronoun_id && {
      gender_pronoun_id: person.gender_pronoun_id,
    }),
    ...(person.gender_pronoun_name && {
      gender_pronoun_name: person.gender_pronoun_name,
    }),
    ...(person.gender_pronoun_write_in && {
      gender_pronoun_write_in: person.gender_pronoun_write_in,
    }),
    ...(person.household_id && { household_id: person.household_id }),
    expand: {
      session: session as CampSessionsResponse | null,
      assigned_bunk: bunk as BunksResponse | null,
    },
  }

  return camper
}

/**
 * Batch builder function to efficiently create Camper objects from fetched data
 * Uses Maps for O(1) lookups instead of nested loops
 */
export function buildCampersFromData(
  attendees: Array<
    AttendeesResponse<{
      person?: PersonsResponse
      session?: CampSessionsResponse
    }>
  >,
  assignments: Map<
    number,
    BunkAssignmentsResponse<{ bunk?: BunksResponse; person?: PersonsResponse }>
  >,
  bunks: Map<number, BunksResponse>
): Camper[] {
  const campers: Camper[] = []

  for (const attendee of attendees) {
    // Get person from expanded relation
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ExpandType<T> makes expand required but PB may omit it at runtime; fixing cascades to ~35 files (#573 audit)
    const person = attendee.expand?.person
    if (!person?.is_camper) continue

    // Get session from expanded relation
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ExpandType<T> makes expand required but PB may omit it at runtime; fixing cascades to ~35 files (#573 audit)
    const session = attendee.expand?.session ?? null

    // Get assignment and bunk using person CM ID
    const assignment = assignments.get(person.cm_id) ?? null
    let bunk: BunksResponse | null = null

    if (assignment) {
      // Try to get bunk from assignment expand first
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ExpandType<T> makes expand required but PB may omit it at runtime; fixing cascades to ~35 files (#573 audit)
      if (assignment.expand?.bunk && typeof assignment.expand.bunk === 'object') {
        bunk = assignment.expand.bunk
      }
      // Fallback to bunk map lookup using CM ID
      else {
        const assignmentWithBunkCmId = assignment as BunkAssignmentsResponse & {
          bunk_cm_id?: number
        }
        if (assignmentWithBunkCmId.bunk_cm_id) {
          bunk = bunks.get(assignmentWithBunkCmId.bunk_cm_id) ?? null
        }
      }
    }

    // Use existing toAppCamper function for consistent transformation
    const camper = toAppCamper(person, attendee, assignment, bunk, session)
    campers.push(camper)
  }

  return campers
}

/**
 * Helper to build Maps from arrays for efficient lookups
 */
export function createLookupMaps(data: {
  assignments?: Array<BunkAssignmentsResponse<{ person?: PersonsResponse; bunk?: BunksResponse }>>
  bunks?: BunksResponse[]
}) {
  const maps = {
    assignments: new Map<
      number,
      BunkAssignmentsResponse<{
        bunk?: BunksResponse
        person?: PersonsResponse
      }>
    >(),
    bunks: new Map<number, BunksResponse>(),
  }

  // Build assignment map by person CM ID
  if (data.assignments) {
    data.assignments.forEach((assignment) => {
      // Get person CM ID from the expanded relation
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ExpandType<T> makes expand required but PB may omit it at runtime; fixing cascades to ~35 files (#573 audit)
      const person = assignment.expand?.person
      if (person && 'cm_id' in person) {
        const personCmId = person.cm_id
        if (personCmId) {
          maps.assignments.set(personCmId, assignment)
        }
      }
    })
  }

  // Build bunk map by CM ID
  if (data.bunks) {
    data.bunks.forEach((bunk) => {
      if (bunk.cm_id) {
        maps.bunks.set(bunk.cm_id, bunk)
      }
    })
  }

  return maps
}
