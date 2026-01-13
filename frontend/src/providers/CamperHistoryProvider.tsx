import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import { useAuth } from '../contexts/AuthContext';
import { useYear } from '../hooks/useCurrentYear';
import type { CamperHistory } from '../contexts/CamperHistoryContext';
import { CamperHistoryContext } from '../contexts/CamperHistoryContext';

interface CamperHistoryProviderProps {
  sessionCmId: number;
  camperPersonIds: number[];
  children: React.ReactNode;
}

interface BunkAssignmentExpanded {
  id: string;
  year: number;
  expand?: {
    person?: { cm_id: number };
    session?: {
      name: string;
      session_type: string;
      start_date: string;
      end_date: string;
    };
    bunk?: { name: string };
  };
}

export function CamperHistoryProvider({ sessionCmId, camperPersonIds, children }: CamperHistoryProviderProps) {
  const currentYear = useYear();
  const lastYear = currentYear - 1;
  const { user } = useAuth();

  // Batch fetch historical data for all campers in the session
  const { data: historyMap = {}, isLoading, error } = useQuery<Record<number, CamperHistory | null>>({
    queryKey: ['batch-camper-history', sessionCmId, camperPersonIds.sort().join(','), lastYear],
    queryFn: async () => {
      const historyRecord: Record<number, CamperHistory | null> = {};

      if (camperPersonIds.length === 0) {
        return historyRecord;
      }

      // Initialize all campers with null
      camperPersonIds.forEach(id => {
        historyRecord[id] = null;
      });

      try {
        // Batch fetch in chunks to build OR filter
        const chunkSize = 25; // Smaller chunks for filter complexity
        const chunks: number[][] = [];

        for (let i = 0; i < camperPersonIds.length; i += chunkSize) {
          chunks.push(camperPersonIds.slice(i, i + chunkSize));
        }

        // Standard camp session types to include
        const allowedTypes = ['main', 'ag', 'embedded', 'taste'];

        // Process chunks in parallel
        const chunkPromises = chunks.map(async (chunk) => {
          // Build OR filter for this chunk of person cm_ids
          const personFilters = chunk.map(id => `person.cm_id = ${id}`).join(' || ');
          const filter = `(${personFilters}) && year < ${currentYear}`;

          const assignments = await pb.collection('bunk_assignments').getFullList<BunkAssignmentExpanded>({
            filter,
            expand: 'person,session,bunk',
            sort: '-year'
          });

          return assignments;
        });

        const allAssignments = (await Promise.all(chunkPromises)).flat();

        // Group by person cm_id and find last year's bunk
        const byPerson = new Map<number, BunkAssignmentExpanded[]>();

        for (const assignment of allAssignments) {
          const personCmId = assignment.expand?.person?.cm_id;
          const sessionType = assignment.expand?.session?.session_type;

          if (!personCmId || !sessionType || !allowedTypes.includes(sessionType)) {
            continue;
          }

          if (!byPerson.has(personCmId)) {
            byPerson.set(personCmId, []);
          }
          const personAssignments = byPerson.get(personCmId);
          if (personAssignments) {
            personAssignments.push(assignment);
          }
        }

        // For each person, find last year's assigned bunk
        byPerson.forEach((assignments, personCmId) => {
          // Find last year's assignment with a bunk
          const lastYearAssignment = assignments.find(a =>
            a.year === lastYear && a.expand?.bunk?.name
          );

          if (lastYearAssignment?.expand) {
            historyRecord[personCmId] = {
              year: lastYearAssignment.year,
              sessionName: lastYearAssignment.expand.session?.name || '',
              sessionType: lastYearAssignment.expand.session?.session_type || '',
              bunkName: lastYearAssignment.expand.bunk?.name || 'Unassigned',
              startDate: lastYearAssignment.expand.session?.start_date || '',
              endDate: lastYearAssignment.expand.session?.end_date || ''
            };
          }
        });

        return historyRecord;
      } catch (error) {
        console.error('Error batch fetching camper histories:', error);
        return historyRecord;
      }
    },
    enabled: !!user && camperPersonIds.length > 0,
    gcTime: 15 * 60 * 1000, // 15 minutes
  });

  const getLastYearHistory = (personCmId: number): CamperHistory | null => {
    if (!historyMap || typeof historyMap !== 'object') {
      console.warn('historyMap is not a valid object:', historyMap);
      return null;
    }
    return historyMap[personCmId] || null;
  };

  const value = {
    getLastYearHistory,
    isLoading,
    error: error as Error | null,
  };

  return (
    <CamperHistoryContext.Provider value={value}>
      {children}
    </CamperHistoryContext.Provider>
  );
}