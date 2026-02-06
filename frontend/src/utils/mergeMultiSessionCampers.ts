/**
 * Merge campers enrolled in multiple sessions into single entries.
 *
 * When a person is enrolled in multiple sessions (e.g., embedded 2a + 3a),
 * buildCampersFromData returns one Camper per attendee record. This utility
 * groups by person_cm_id and produces one entry per person with additional
 * session/bunk info attached.
 */
import type { Camper, Session } from '../types/app-types'

export interface AdditionalSession {
  session_cm_id: number
  session_name: string
  bunk_cm_id?: number | undefined
  bunk_name?: string | undefined
  bunk_pb_id?: string | undefined
}

export interface MergedCamper extends Camper {
  additionalSessions?: AdditionalSession[] | undefined
}

/** Session type priority for picking the "primary" enrollment. */
const SESSION_TYPE_PRIORITY: Record<string, number> = {
  main: 0,
  embedded: 1,
  ag: 2,
  taste: 3,
}

export function mergeMultiSessionCampers(
  campers: Camper[],
  sessions: Session[]
): MergedCamper[] {
  const sessionMap = new Map<number, Session>()
  for (const s of sessions) {
    sessionMap.set(s.cm_id, s)
  }

  // Group by person_cm_id
  const groups = new Map<number, Camper[]>()
  for (const c of campers) {
    const existing = groups.get(c.person_cm_id)
    if (existing) {
      existing.push(c)
    } else {
      groups.set(c.person_cm_id, [c])
    }
  }

  const result: MergedCamper[] = []

  for (const group of groups.values()) {
    if (group.length === 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      result.push(group[0]!)
      continue
    }

    // Sort by session type priority (main > embedded > ag > taste)
    group.sort((a, b) => {
      const sessionA = sessionMap.get(a.session_cm_id)
      const sessionB = sessionMap.get(b.session_cm_id)
      const prioA = SESSION_TYPE_PRIORITY[sessionA?.session_type ?? ''] ?? 99
      const prioB = SESSION_TYPE_PRIORITY[sessionB?.session_type ?? ''] ?? 99
      return prioA - prioB
    })

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const primary = group[0]!
    const additionalSessions: AdditionalSession[] = group.slice(1).map((c) => {
      const session = sessionMap.get(c.session_cm_id)
      const bunk = c.expand?.assigned_bunk
      return {
        session_cm_id: c.session_cm_id,
        session_name: session?.name ?? `Session ${c.session_cm_id}`,
        bunk_cm_id: c.assigned_bunk_cm_id ?? undefined,
        bunk_name: bunk && 'name' in bunk ? (bunk.name as string) : undefined,
        bunk_pb_id: c.assigned_bunk ?? undefined,
      }
    })

    result.push({
      ...primary,
      additionalSessions,
    })
  }

  return result
}
