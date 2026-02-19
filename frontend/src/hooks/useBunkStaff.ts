/**
 * useBunkStaff - Fetches staff and their bunk_assignments to build a
 * session×bunk staff lookup Map.
 *
 * Used by SessionBunkHeatmap to show staff tooltips on individual cells.
 * Two-step query:
 * 1. Fetch staff with bunk_staff=true (expanded person for display names)
 * 2. Fetch bunk_assignments for those staff (expanded session + bunk for names)
 * Returns Map<"sessionName|bunkName", BunkStaffInfo[]>
 */
import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'

export interface BunkStaffInfo {
  name: string
  personId: string
}

interface ExpandedPerson {
  preferred_name?: string
  first_name?: string
  last_name?: string
  cm_id?: number
}

interface StaffExpand {
  person?: ExpandedPerson
}

interface AssignmentExpandedSession {
  name?: string
}

interface AssignmentExpandedBunk {
  name?: string
}

interface AssignmentExpand {
  session?: AssignmentExpandedSession
  bunk?: AssignmentExpandedBunk
}

export function useBunkStaff(year: number) {
  return useQuery({
    queryKey: queryKeys.bunkStaff(year),
    queryFn: async () => {
      // Step 1: Fetch bunk staff with expanded person for display names
      const staffRecords = await pb.collection('staff').getFullList({
        filter: `bunk_staff = true && year = ${year}`,
        expand: 'person',
      })

      // Build person PB ID → display name + CM ID
      const personPBIDToInfo = new Map<string, { name: string; cmId: string }>()
      const staffPersonPBIDs: string[] = []

      for (const record of staffRecords) {
        const expanded = record.expand as StaffExpand | undefined
        if (!expanded?.person) continue

        const person = expanded.person
        const displayName =
          `${person.preferred_name || person.first_name || ''} ${person.last_name || ''}`.trim()
        if (!displayName) continue

        const personPBID = record['person'] as string
        staffPersonPBIDs.push(personPBID)
        personPBIDToInfo.set(personPBID, {
          name: displayName,
          cmId: String(person.cm_id ?? record.id),
        })
      }

      if (staffPersonPBIDs.length === 0) {
        return new Map<string, BunkStaffInfo[]>()
      }

      // Step 2: Fetch bunk_assignments for those staff persons
      // Build filter: year = X && (person = "id1" || person = "id2" || ...)
      const personFilter = staffPersonPBIDs.map((id) => `person = "${id}"`).join(' || ')
      const assignmentRecords = await pb.collection('bunk_assignments').getFullList({
        filter: `year = ${year} && (${personFilter})`,
        expand: 'session,bunk',
      })

      // Step 3: Build Map<"sessionName|bunkName", BunkStaffInfo[]>
      const bunkStaffMap = new Map<string, BunkStaffInfo[]>()

      for (const assignment of assignmentRecords) {
        const expanded = assignment.expand as AssignmentExpand | undefined
        const sessionName = expanded?.session?.name
        const bunkName = expanded?.bunk?.name
        const personPBID = assignment['person'] as string

        if (!sessionName || !bunkName) continue

        const info = personPBIDToInfo.get(personPBID)
        if (!info) continue

        const key = `${sessionName}|${bunkName}`
        const staffInfo: BunkStaffInfo = {
          name: info.name,
          personId: info.cmId,
        }

        const existing = bunkStaffMap.get(key)
        if (existing) {
          // Avoid duplicates (same person in same session+bunk)
          if (!existing.some((s) => s.personId === staffInfo.personId)) {
            existing.push(staffInfo)
          }
        } else {
          bunkStaffMap.set(key, [staffInfo])
        }
      }

      return bunkStaffMap
    },
    enabled: year > 0,
    ...syncDataOptions,
  })
}
