/**
 * Hook for fetching drilldown attendees (chart click-through).
 *
 * When a user clicks a chart segment, this hook fetches the matching
 * campers to display in a modal.
 */

import { useQuery } from '@tanstack/react-query';
import type { DrilldownAttendee, DrilldownFilter } from '../types/metrics';
import { queryKeys, syncDataOptions } from '../utils/queryKeys';

interface UseDrilldownAttendeesOptions {
  year: number;
  filter: DrilldownFilter | null;
  sessionCmId?: number | undefined;
  sessionTypes?: string[] | undefined;
  statusFilter?: string[] | undefined;
}

export function useDrilldownAttendees({
  year,
  filter,
  sessionCmId,
  sessionTypes,
  statusFilter,
}: UseDrilldownAttendeesOptions) {
  const sessionTypesParam = sessionTypes?.join(',');
  const statusFilterParam = statusFilter?.join(',');

  return useQuery({
    queryKey: queryKeys.drilldown(
      year,
      filter?.type,
      filter?.value,
      sessionCmId,
      sessionTypesParam,
      statusFilterParam,
    ),
    queryFn: async (): Promise<DrilldownAttendee[]> => {
      if (!filter) {
        return [];
      }

      const params = new URLSearchParams({
        year: String(year),
        breakdown_type: filter.type,
        breakdown_value: filter.value,
      });

      if (sessionCmId) {
        params.set('session_cm_id', String(sessionCmId));
      }
      if (sessionTypesParam) {
        params.set('session_types', sessionTypesParam);
      }
      if (statusFilterParam) {
        params.set('status_filter', statusFilterParam);
      }

      const res = await fetch(`/api/metrics/drilldown?${params}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch drilldown data: ${res.statusText}`);
      }
      return res.json();
    },
    enabled: !!filter,
    ...syncDataOptions,
  });
}
