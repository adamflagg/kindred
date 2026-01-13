import { useQuery } from '@tanstack/react-query';
import { pb, type SavedScenario } from '../lib/pocketbase';
import { useAuth } from '../contexts/AuthContext';
import { queryKeys, userDataOptions } from '../utils/queryKeys';

export function useSavedScenarios(sessionCmId?: number, year?: number) {
  const { user } = useAuth();
  return useQuery<SavedScenario[]>({
    queryKey: queryKeys.savedScenarios(sessionCmId ?? 0, year),
    queryFn: async () => {
      // Build filter parts
      const filterParts: string[] = [];
      if (sessionCmId) {
        filterParts.push(`session.cm_id = ${sessionCmId}`);
      }
      if (year) {
        filterParts.push(`year = ${year}`);
      }

      const scenarios = await pb
        .collection<SavedScenario>('saved_scenarios')
        .getFullList({
          sort: 'name',
          expand: 'session',
          ...(filterParts.length > 0 && {
            filter: filterParts.join(' && '),
          }),
        });

      return scenarios;
    },
    ...userDataOptions,
    enabled: !!user, // Only run query if user is authenticated
  });
}