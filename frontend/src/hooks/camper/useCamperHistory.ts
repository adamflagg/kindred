/**
 * Hook for fetching camper's historical session and bunk data
 * Aggregates current year and past years' camp history
 */

import { useQuery } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';
import { VALID_SUMMER_SESSION_TYPES } from '../../constants/sessionTypes';
import type { Camper } from '../../types/app-types';
import type { BunkAssignmentsResponse } from '../../types/pocketbase-types';
import type { HistoricalRecord } from './types';

export interface UseCamperHistoryResult {
  camperHistory: HistoricalRecord[];
  isLoading: boolean;
  error: Error | null;
}

export function useCamperHistory(
  personCmId: number | null,
  currentYear: number,
  camper: Camper | null
): UseCamperHistoryResult {
  const { data: camperHistory = [], isLoading, error } = useQuery({
    queryKey: ['camper-history-details', personCmId, currentYear, camper?.expand?.session, camper?.expand?.assigned_bunk],
    queryFn: async () => {
      if (!personCmId) return [];

      try {
        const allHistory: HistoricalRecord[] = [];

        // Add current year data if camper is loaded
        if (camper && camper.expand?.session) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const session = camper.expand.session as any;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const assignedBunk = camper.expand?.assigned_bunk as any;
          const currentRecord: HistoricalRecord = {
            year: currentYear,
            sessionName: session.name || 'Unknown',
            sessionType: session.session_type,
            bunkName: assignedBunk?.name || 'Unassigned',
            startDate: session.start_date,
            endDate: session.end_date
          };
          allHistory.push(currentRecord);
        }

        // Fetch historical data from bunk_assignments for previous years
        // Query by person.cm_id to get assignments across all year-specific person records
        // (Person records are created per-year to preserve historical school info)
        const historicalFilter = `person.cm_id = ${personCmId} && year < ${currentYear}`;
        const historicalAssignments = await pb.collection<BunkAssignmentsResponse>('bunk_assignments').getFullList({
          filter: historicalFilter,
          expand: 'session,bunk',
          sort: '-year',
          $autoCancel: false
        });

        // Group by year and format
        const yearMap = new Map<number, HistoricalRecord>();

        for (const assignment of historicalAssignments) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const session = (assignment.expand as any)?.session;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const bunk = (assignment.expand as any)?.bunk;

          if (session && VALID_SUMMER_SESSION_TYPES.includes(session.session_type)) {
            const year = assignment.year;

            // Format session name based on type
            const sessionName = session.name;

            // If we haven't seen this year yet, or if this is a main session (preferred), add it
            const existing = yearMap.get(year);
            if (!existing || session.session_type === 'main') {
              yearMap.set(year, {
                year,
                sessionName,
                sessionType: session.session_type,
                bunkName: bunk?.name || 'Unassigned',
                startDate: session.start_date,
                endDate: session.end_date
              });
            }
          }
        }

        // Add historical records to array
        allHistory.push(...Array.from(yearMap.values()));

        // Sort by year descending
        allHistory.sort((a, b) => b.year - a.year);

        return allHistory;
      } catch (err) {
        console.error('Error fetching camp history:', err);
        // If error, at least return current year data
        if (camper && camper.expand?.session) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const session = camper.expand.session as any;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const assignedBunk = camper.expand?.assigned_bunk as any;
          return [{
            year: currentYear,
            sessionName: session.name || 'Unknown',
            sessionType: session.session_type,
            bunkName: assignedBunk?.name || 'Unassigned',
            startDate: session.start_date,
            endDate: session.end_date
          }];
        }
        return [];
      }
    },
    enabled: !!personCmId && !!camper,
  });

  return {
    camperHistory,
    isLoading,
    error: error as Error | null,
  };
}
