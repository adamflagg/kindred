import { useMutation, useQueryClient } from '@tanstack/react-query'
import { pb, getCurrentUser } from '../lib/pocketbase'
import type { SavedScenario } from '../types/app-types'
import type {
  BunkAssignmentsDraftRecord,
  LockedGroupMembersRecord,
  LockedGroupsRecord,
} from '../types/pocketbase-types'

interface CreateScenarioParams {
  name: string
  session_cm_id: number
  year: number
  description?: string
  copyOptions?: { fromProduction: boolean } | { fromScenario: string }
}

interface AssignmentError {
  assignment: unknown
  error: unknown
}

interface PbLooseError {
  response?: { data?: unknown }
  message?: string
}

export function useCreateScenario() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: CreateScenarioParams) => {
      const user = getCurrentUser()
      if (!user) {
        throw new Error('User must be authenticated to create scenarios')
      }

      // First, find the session PocketBase ID from the CampMinder ID and year
      const sessions = await pb.collection('camp_sessions').getFullList({
        filter: `cm_id = ${params.session_cm_id} && year = ${params.year}`,
      })

      if (sessions.length === 0) {
        throw new Error(
          `Session with CM ID ${params.session_cm_id} not found for year ${params.year}`
        )
      }

      const scenarioData: Record<string, unknown> = {
        name: params.name,
        session: sessions[0]?.id ?? '', // Use the PocketBase relation ID
        year: params.year, // Store year for filtering
        is_active: true,
        ...(params.description && { description: params.description }),
      }

      // Create the scenario — request expand on `session` so downstream
      // consumers (e.g. savedScenarioToScenario) can read `expand.session.cm_id`
      // without tripping on a missing `expand` property.
      const scenario = await pb
        .collection<SavedScenario>('saved_scenarios')
        .create(scenarioData, { expand: 'session' })

      // Handle copying data if requested
      if (params.copyOptions) {
        if ('fromProduction' in params.copyOptions && params.copyOptions.fromProduction) {
          // Copy from production data
          await copyProductionToScenario(params.session_cm_id, scenario.id, params.year)
        } else if ('fromScenario' in params.copyOptions) {
          // Copy from another scenario
          await copyScenarioToScenario(params.copyOptions.fromScenario, scenario.id, params.year)
        }
      }

      return scenario
    },
    onSuccess: (_data, params) => {
      // Invalidate scenarios query to refetch
      void queryClient.invalidateQueries({ queryKey: ['saved-scenarios'] })
      // Also invalidate the specific session query using the param
      void queryClient.invalidateQueries({
        queryKey: ['saved-scenarios', params.session_cm_id],
      })
    },
  })
}

// Helper function to copy production assignments to a scenario
async function copyProductionToScenario(sessionCmId: number, scenarioId: string, year: number) {
  // Get production assignments with expanded relations to get CM IDs
  const productionAssignments = await pb.collection('bunk_assignments').getFullList({
    filter: `year = ${year}`,
    expand: 'person,bunk,session',
  })

  // Type for expanded assignment with session
  interface ExpandedAssignment {
    session?: { cm_id?: number }
  }

  // Filter for the specific session
  const filteredAssignments = productionAssignments.filter((assignment) => {
    const expanded = assignment.expand as ExpandedAssignment | undefined
    return expanded?.session?.cm_id === sessionCmId
  })

  console.log(`Copying ${filteredAssignments.length} assignments to scenario ${scenarioId}`)

  // Create draft assignments one at a time with error handling
  const errors: AssignmentError[] = []

  for (const assignment of filteredAssignments) {
    const draftData: Record<string, unknown> = {
      scenario: scenarioId,
      person: assignment.person,
      bunk: assignment.bunk,
      session: assignment.session,
      year: year,
    }

    // Only include bunk_plan if it exists
    const assignmentWithBunkPlan = assignment as { bunk_plan?: string }
    if (assignmentWithBunkPlan.bunk_plan) {
      draftData['bunk_plan'] = assignmentWithBunkPlan.bunk_plan
    }

    try {
      await pb.collection('bunk_assignments_draft').create(draftData)
    } catch (error) {
      const pbError = error as PbLooseError
      console.error('Failed to create draft assignment:', {
        draftData,
        originalAssignment: assignment,
        error: pbError.response?.data ?? pbError.message ?? error,
      })
      errors.push({ assignment, error })
    }
  }

  if (errors.length > 0) {
    console.error(`Failed to copy ${errors.length}/${filteredAssignments.length} assignments`)
    throw new Error(`Failed to copy ${errors.length} assignments. Check console for details.`)
  }
}

// Helper function to copy assignments from one scenario to another.
//
// Historically this fired all creates concurrently via `Promise.all`, which
// meant ~147 simultaneous POSTs fought for the same SQLite writer lock.
// Some creates succeeded before a failed one rejected Promise.all, leaving
// the destination scenario with only ~2/3 of the source assignments and
// no clear error surface. Mirrors `copyProductionToScenario` below:
// sequential `for..of await`, per-item try/catch, accumulated errors,
// aggregate throw at the end.
//
// Also copies locked friend groups — see #1046.
async function copyScenarioToScenario(fromScenarioId: string, toScenarioId: string, year: number) {
  // Get source scenario assignments for the specific year.
  // The stored fields on bunk_assignments_draft are already relation IDs
  // (person, bunk, session, bunk_plan), so no expand is needed here.
  const sourceAssignments = await pb
    .collection<BunkAssignmentsDraftRecord>('bunk_assignments_draft')
    .getFullList({
      filter: `scenario = "${fromScenarioId}" && year = ${year}`,
    })

  console.log(`Copying ${sourceAssignments.length} assignments to scenario ${toScenarioId}`)

  const errors: AssignmentError[] = []

  for (const source of sourceAssignments) {
    const draftData: Record<string, unknown> = {
      scenario: toScenarioId,
      person: source.person,
      bunk: source.bunk,
      session: source.session,
      year: year,
      assignment_locked: source.assignment_locked,
    }

    // Only include bunk_plan if it exists (mirrors copyProductionToScenario)
    if (source.bunk_plan) {
      draftData['bunk_plan'] = source.bunk_plan
    }

    try {
      await pb.collection('bunk_assignments_draft').create(draftData)
    } catch (error) {
      const pbError = error as PbLooseError
      console.error('Failed to create draft assignment:', {
        draftData,
        originalAssignment: source,
        error: pbError.response?.data ?? pbError.message ?? error,
      })
      errors.push({ assignment: source, error })
    }
  }

  if (errors.length > 0) {
    console.error(`Failed to copy ${errors.length}/${sourceAssignments.length} assignments`)
    throw new Error(`Failed to copy ${errors.length} assignments. Check console for details.`)
  }

  // ── Copy locked friend groups (#1046) ───────────────────────────────────
  await copyLockedGroupsToScenario(fromScenarioId, toScenarioId, year)
}

// copyLockedGroupsToScenario copies all locked_groups (and their members) from
// one scenario to another. Errors are accumulated and thrown at the end so
// partial-success state is reported rather than silently dropped.
//
// Production-source copies are skipped via the callsite (copyProductionToScenario
// does not call this function).
async function copyLockedGroupsToScenario(
  fromScenarioId: string,
  toScenarioId: string,
  year: number
) {
  // ── 1. Fetch source groups ───────────────────────────────────────────────
  const sourceGroups = await pb.collection<LockedGroupsRecord>('locked_groups').getFullList({
    filter: `scenario = "${fromScenarioId}" && year = ${year}`,
  })

  if (sourceGroups.length === 0) {
    return
  }

  console.log(`Copying ${sourceGroups.length} locked groups to scenario ${toScenarioId}`)

  // ── 2. Create new groups and build oldId → newId map ─────────────────────
  const groupIdMap = new Map<string, string>() // old group id → new group id
  const groupErrors: AssignmentError[] = []

  for (const sourceGroup of sourceGroups) {
    const groupData: Record<string, unknown> = {
      scenario: toScenarioId,
      name: sourceGroup.name,
      color: sourceGroup.color,
      session: sourceGroup.session,
      year: sourceGroup.year,
    }

    try {
      const newGroup = await pb.collection<LockedGroupsRecord>('locked_groups').create(groupData)
      groupIdMap.set(sourceGroup.id, newGroup.id)
    } catch (error) {
      const pbError = error as PbLooseError
      console.error('Failed to create locked group:', {
        groupData,
        originalGroup: sourceGroup,
        error: pbError.response?.data ?? pbError.message ?? error,
      })
      groupErrors.push({ assignment: sourceGroup, error })
    }
  }

  // ── 3. Fetch source members for all source groups ────────────────────────
  const sourceGroupIds = sourceGroups.map((g) => g.id)
  // PocketBase filter: group IN (id1, id2, ...) using multiple OR clauses
  const memberFilter = sourceGroupIds.map((id) => `group = "${id}"`).join(' || ')

  const sourceMembers = await pb
    .collection<LockedGroupMembersRecord>('locked_group_members')
    .getFullList({
      filter: memberFilter,
    })

  console.log(`Copying ${sourceMembers.length} locked group members`)

  // ── 4. Create new members using the id map ───────────────────────────────
  const memberErrors: AssignmentError[] = []

  for (const sourceMember of sourceMembers) {
    const newGroupId = groupIdMap.get(sourceMember.group)
    if (!newGroupId) {
      // The source group failed to create — record each orphaned member as a
      // failure too, so the aggregate count reflects the actual damage rather
      // than just the single failed group create.
      memberErrors.push({
        assignment: sourceMember,
        error: new Error(`Skipped: parent locked group ${sourceMember.group} failed to copy`),
      })
      continue
    }

    const memberData: Record<string, unknown> = {
      group: newGroupId,
      attendee: sourceMember.attendee,
    }

    try {
      await pb.collection('locked_group_members').create(memberData)
    } catch (error) {
      const pbError = error as PbLooseError
      console.error('Failed to create locked group member:', {
        memberData,
        originalMember: sourceMember,
        error: pbError.response?.data ?? pbError.message ?? error,
      })
      memberErrors.push({ assignment: sourceMember, error })
    }
  }

  const totalErrors = groupErrors.length + memberErrors.length
  const totalItems = sourceGroups.length + sourceMembers.length
  if (totalErrors > 0) {
    console.error(`Failed to copy ${totalErrors}/${totalItems} locked group items`)
    throw new Error(`Failed to copy ${totalErrors} locked group items. Check console for details.`)
  }
}

export function useDeleteScenario() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (scenarioId: string) => {
      // PocketBase cascades bunk_assignments_draft rows via
      // cascadeDelete: true on the scenario relation (migration
      // 1500000098). One server-side call replaces the previous N+1
      // client-side pre-delete loop that made scenario deletion take
      // several seconds on real sessions.
      return await pb.collection<SavedScenario>('saved_scenarios').delete(scenarioId)
    },
    onSuccess: () => {
      // Invalidate all scenarios queries to refetch
      void queryClient.invalidateQueries({ queryKey: ['saved-scenarios'] })
    },
  })
}
