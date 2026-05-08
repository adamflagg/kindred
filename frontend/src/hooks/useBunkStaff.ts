/**
 * useBunkStaff - Fetches staff and their bunk_assignments to build a
 * session×bunk staff lookup Map.
 *
 * Used by SessionBunkHeatmap to show staff tooltips on individual cells.
 * Three-step query:
 * 1. Fetch staff with bunk_staff=true (expanded person for display names)
 * 2. Fetch camp_sessions for AG→parent session name normalization
 * 3. Fetch bunk_assignments for those staff (expanded session + bunk for names)
 *
 * AG session names are normalized to their parent session names so map keys
 * match the retention backend (which merges AG into parent sessions).
 *
 * Returns Map<"sessionName|bunkName", BunkStaffInfo[]>
 */
import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'
import { useAuth } from '../contexts/AuthContext'
import type {
  StaffResponse,
  PersonsResponse,
  BunkAssignmentsResponse,
  CampSessionsResponse,
  BunksResponse,
} from '../types/pocketbase-types'
import { isAgSession } from '../utils/sessionTypePredicates'

export interface BunkStaffInfo {
  name: string
  personId: string
  status?: string
}

export function useBunkStaff(year: number) {
  const { isLoading } = useAuth()

  return useQuery({
    queryKey: queryKeys.bunkStaff(year),
    queryFn: async () => {
      // Step 1: Fetch bunk staff with expanded person for display names
      const staffRecords = await pb
        .collection('staff')
        .getFullList<StaffResponse<{ person?: PersonsResponse }>>({
          filter: `bunk_staff = true && year = ${year}`,
          expand: 'person',
        })

      // Build person PB ID → display name + CM ID + status
      const personPBIDToInfo = new Map<string, { name: string; cmId: string; status?: string }>()
      const staffPersonPBIDs: string[] = []

      for (const record of staffRecords) {
        const expanded = record.expand
        if (!expanded.person) continue

        const person = expanded.person
        const displayName =
          `${person.preferred_name || person.first_name || ''} ${person.last_name || ''}`.trim()
        if (!displayName) continue

        const personPBID = record.person
        staffPersonPBIDs.push(personPBID)
        personPBIDToInfo.set(personPBID, {
          name: displayName,
          cmId: String(person.cm_id),
          status: record.status,
        })
      }

      if (staffPersonPBIDs.length === 0) {
        return new Map<string, BunkStaffInfo[]>()
      }

      // Step 1b: Fetch camp_sessions to resolve AG session names to parent names
      // AG sessions are merged into parent session names in retention data,
      // so the bunkStaff map keys must use parent names for lookups to match.
      const sessions = await pb.collection('camp_sessions').getFullList<CampSessionsResponse>({
        filter: `year = ${year}`,
        fields: 'cm_id,name,session_type,parent_id',
      })
      const sessionNameByCmId = new Map<number, string>()
      for (const s of sessions) {
        if (s.cm_id) sessionNameByCmId.set(s.cm_id, s.name)
      }

      // Step 2: Fetch bunk_assignments for those staff persons
      // Build filter: year = X && (person = "id1" || person = "id2" || ...)
      const personFilter = staffPersonPBIDs.map((id) => `person = "${id}"`).join(' || ')
      const assignmentRecords = await pb
        .collection('bunk_assignments')
        .getFullList<
          BunkAssignmentsResponse<{ session?: CampSessionsResponse; bunk?: BunksResponse }>
        >({
          filter: `year = ${year} && (${personFilter})`,
          expand: 'session,bunk',
        })

      // Step 3: Build Map<"sessionName|bunkName", BunkStaffInfo[]>
      const bunkStaffMap = new Map<string, BunkStaffInfo[]>()

      for (const assignment of assignmentRecords) {
        const expanded = assignment.expand
        const session = expanded.session
        let sessionName = session?.name
        const bunkName = expanded.bunk?.name
        const personPBID = assignment.person

        if (!sessionName || !bunkName) continue

        // Normalize AG session names to parent session names
        // so map keys match retention data (which merges AG into parent)
        if (session && isAgSession(session) && session.parent_id) {
          const parentName = sessionNameByCmId.get(session.parent_id)
          if (parentName) {
            sessionName = parentName
          }
        }

        const info = personPBIDToInfo.get(personPBID)
        if (!info) continue

        const key = `${sessionName}|${bunkName}`
        const staffInfo: BunkStaffInfo = {
          name: info.name,
          personId: info.cmId,
          ...(info.status ? { status: info.status } : {}),
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
    enabled: year > 0 && !isLoading,
    ...syncDataOptions,
  })
}
