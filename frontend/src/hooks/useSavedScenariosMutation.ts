import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pb, type SavedScenario } from '../lib/pocketbase';
import { getCurrentUser } from '../lib/pocketbase';

interface CreateScenarioParams {
  name: string;
  session_cm_id: number;
  year: number;
  description?: string;
  copyOptions?: { fromProduction: boolean } | { fromScenario: string };
}

export function useCreateScenario() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreateScenarioParams) => {
      const user = getCurrentUser();
      if (!user) {
        throw new Error('User must be authenticated to create scenarios');
      }

      // First, find the session PocketBase ID from the CampMinder ID and year
      const sessions = await pb.collection('camp_sessions').getFullList({
        filter: `cm_id = ${params.session_cm_id} && year = ${params.year}`
      });

      if (sessions.length === 0) {
        throw new Error(`Session with CM ID ${params.session_cm_id} not found for year ${params.year}`);
      }

      const scenarioData: Record<string, unknown> = {
        name: params.name,
        session: sessions[0]?.id || '',  // Use the PocketBase relation ID
        year: params.year,  // Store year for filtering
        created_by: user.id,
        is_active: true,
        ...(params.description && { description: params.description })
      };

      // Create the scenario
      const scenario = await pb.collection<SavedScenario>('saved_scenarios').create(scenarioData);

      // Handle copying data if requested
      if (params.copyOptions) {
        if ('fromProduction' in params.copyOptions && params.copyOptions.fromProduction) {
          // Copy from production data
          await copyProductionToScenario(params.session_cm_id, scenario.id, params.year);
        } else if ('fromScenario' in params.copyOptions) {
          // Copy from another scenario
          await copyScenarioToScenario(params.copyOptions.fromScenario, scenario.id, params.year);
        }
      }

      return scenario;
    },
    onSuccess: (_data, params) => {
      // Invalidate scenarios query to refetch
      queryClient.invalidateQueries({ queryKey: ['saved-scenarios'] });
      // Also invalidate the specific session query using the param
      queryClient.invalidateQueries({ queryKey: ['saved-scenarios', params.session_cm_id] });
    }
  });
}

// Helper function to copy production assignments to a scenario
async function copyProductionToScenario(sessionCmId: number, scenarioId: string, year: number) {
  // Get production assignments with expanded relations to get CM IDs
  const productionAssignments = await pb.collection('bunk_assignments').getFullList({
    filter: `year = ${year}`,
    expand: 'person,bunk,session'
  });

  // Type for expanded assignment with session
  interface ExpandedAssignment {
    session?: { cm_id?: number };
  }

  // Filter for the specific session
  const filteredAssignments = productionAssignments.filter(assignment => {
    const expanded = assignment.expand as ExpandedAssignment | undefined;
    return expanded?.session?.cm_id === sessionCmId;
  });

  console.log(`Copying ${filteredAssignments.length} assignments to scenario ${scenarioId}`);

  // Create draft assignments one at a time with error handling
  interface AssignmentError {
    assignment: unknown;
    error: unknown;
  }
  const errors: AssignmentError[] = [];

  for (const assignment of filteredAssignments) {
    const draftData: Record<string, unknown> = {
      scenario: scenarioId,
      person: assignment.person,
      bunk: assignment.bunk,
      session: assignment.session,
      year: year
    };

    // Only include bunk_plan if it exists
    const assignmentWithBunkPlan = assignment as { bunk_plan?: string };
    if (assignmentWithBunkPlan.bunk_plan) {
      draftData['bunk_plan'] = assignmentWithBunkPlan.bunk_plan;
    }

    try {
      await pb.collection('bunk_assignments_draft').create(draftData);
    } catch (error) {
      const pbError = error as { response?: { data?: unknown }; message?: string };
      console.error('Failed to create draft assignment:', {
        draftData,
        originalAssignment: assignment,
        error: pbError?.response?.data ?? pbError?.message ?? error
      });
      errors.push({ assignment, error });
    }
  }

  if (errors.length > 0) {
    console.error(`Failed to copy ${errors.length}/${filteredAssignments.length} assignments`);
    throw new Error(`Failed to copy ${errors.length} assignments. Check console for details.`);
  }
}

// Helper function to copy assignments from one scenario to another
async function copyScenarioToScenario(fromScenarioId: string, toScenarioId: string, year: number) {
  // Get source scenario assignments for the specific year
  const sourceAssignments = await pb.collection('bunk_assignments_draft').getFullList({
    filter: `scenario = "${fromScenarioId}" && year = ${year}`
  });

  // Create draft assignments for the new scenario
  interface DraftAssignment {
    person?: string;
    bunk?: string;
    session?: string;
    bunk_plan?: string;
    assignment_locked?: boolean;
  }

  const createPromises = sourceAssignments.map(assignment => {
    const source = assignment as DraftAssignment;
    const draftData: Record<string, unknown> = {
      scenario: toScenarioId,  // PocketBase relation to saved_scenarios
      person: source.person,  // Keep the PocketBase relation ID
      bunk: source.bunk,  // Keep the PocketBase relation ID
      session: source.session,  // Keep the PocketBase relation ID
      bunk_plan: source.bunk_plan,  // Keep the PocketBase relation ID if exists
      year: year,
      assignment_locked: source.assignment_locked
    };

    return pb.collection('bunk_assignments_draft').create(draftData);
  });

  await Promise.all(createPromises);
}

export function useDeleteScenario() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (scenarioId: string) => {
      // Must delete all draft assignments first (PocketBase enforces referential integrity)
      const draftAssignments = await pb.collection('bunk_assignments_draft').getFullList({
        filter: `scenario = "${scenarioId}"`
      });

      // Delete in batches to avoid overwhelming the server
      for (const assignment of draftAssignments) {
        await pb.collection('bunk_assignments_draft').delete(assignment.id);
      }

      // Now delete the scenario
      return await pb.collection<SavedScenario>('saved_scenarios').delete(scenarioId);
    },
    onSuccess: () => {
      // Invalidate all scenarios queries to refetch
      queryClient.invalidateQueries({ queryKey: ['saved-scenarios'] });
    }
  });
}