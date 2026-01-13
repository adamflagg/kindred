import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pb, type SavedScenario } from '../lib/pocketbase';

interface UpdateScenarioParams {
  scenarioId: string;
  updates: {
    name?: string;
    description?: string;
    is_active?: boolean;
  };
}

interface ClearScenarioParams {
  scenarioId: string;
  year: number;
}

export function useUpdateScenario() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ scenarioId, updates }: UpdateScenarioParams) => {
      const updateData: Record<string, unknown> = {};

      if (updates.name !== undefined) updateData['name'] = updates.name;
      if (updates.description !== undefined) updateData['description'] = updates.description;
      if (updates.is_active !== undefined) updateData['is_active'] = updates.is_active;

      if (Object.keys(updateData).length === 0) {
        throw new Error('No fields to update');
      }

      return await pb.collection<SavedScenario>('saved_scenarios').update(scenarioId, updateData);
    },
    onSuccess: () => {
      // Invalidate scenarios query to refetch
      queryClient.invalidateQueries({ queryKey: ['saved-scenarios'] });
      // Note: We can't easily get the session CM ID from the update response
      // So we invalidate all scenario queries to be safe
    }
  });
}

export function useClearScenario() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ scenarioId, year }: ClearScenarioParams) => {
      // Build filter for assignments to delete (include year for safety)
      const filter = `scenario = "${scenarioId}" && year = ${year}`;

      // Get assignments to delete
      const assignments = await pb.collection('bunk_assignments_draft').getFullList({
        filter
      });

      // Delete each assignment
      const deletePromises = assignments.map(assignment =>
        pb.collection('bunk_assignments_draft').delete(assignment.id)
      );

      await Promise.all(deletePromises);

      return { deletedCount: assignments.length };
    },
    onSuccess: () => {
      // Invalidate any queries that might be affected
      queryClient.invalidateQueries({ queryKey: ['bunk-assignments'] });
    }
  });
}