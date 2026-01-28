/**
 * Hook to fetch sessions for the metrics session dropdown.
 *
 * Returns main and embedded sessions for a given year, sorted by start_date.
 */

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { queryKeys, syncDataOptions } from '../utils/queryKeys';
import { pb } from '../lib/pocketbase';

export interface MetricsSession {
  cm_id: number;
  name: string;
  session_type: 'main' | 'embedded';
  start_date: string;
}

/**
 * Fetch sessions available for the retention metrics dropdown.
 *
 * Only returns main and embedded session types (not ag, family, etc.)
 * since those are the primary summer camp sessions for retention analysis.
 */
export function useMetricsSessions(year: number) {
  return useQuery({
    queryKey: queryKeys.metricsSessions(year),
    queryFn: async (): Promise<MetricsSession[]> => {
      const sessions = await pb.collection('camp_sessions').getFullList({
        filter: `year = ${year} && (session_type = "main" || session_type = "embedded")`,
        sort: 'start_date',
      });

      return sessions.map((s) => ({
        cm_id: s.cm_id as number,
        name: s.name as string,
        session_type: s.session_type as 'main' | 'embedded',
        start_date: s.start_date as string,
      }));
    },
    enabled: year > 0,
    placeholderData: keepPreviousData,
    // Sessions rarely change - use sync data options for long cache
    ...syncDataOptions,
  });
}
