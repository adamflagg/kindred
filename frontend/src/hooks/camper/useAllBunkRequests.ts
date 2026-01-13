/**
 * Hook for fetching all bunk requests for a camper
 * Enriches requests with person names for display
 */

import { useQuery } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';
import type { BunkRequest } from '../../types/app-types';
import type { PersonsResponse } from '../../types/pocketbase-types';

// Extended bunk request with optional person name
export type EnhancedBunkRequest = BunkRequest & {
  requestedPersonName?: string | null;
};

export interface UseAllBunkRequestsResult {
  allBunkRequests: EnhancedBunkRequest[];
  isLoading: boolean;
  error: Error | null;
}

export function useAllBunkRequests(
  personCmId: number | undefined,
  currentYear: number
): UseAllBunkRequestsResult {
  const { data: allBunkRequests = [], isLoading, error } = useQuery<EnhancedBunkRequest[]>({
    queryKey: ['person-all-bunk-requests', personCmId, currentYear],
    queryFn: async () => {
      if (!personCmId) {
        throw new Error('No camper person ID');
      }

      try {
        const filter = `requester_id = ${personCmId} && year = ${currentYear}`;
        const requests = await pb.collection<BunkRequest>('bunk_requests').getFullList({
          filter,
          sort: '-priority,request_type'
        });

        // Collect unique requested person CM IDs (excluding negative IDs for unresolved names)
        const requestedPersonCmIds = new Set<number>();
        requests.forEach(req => {
          if (req.requestee_id && req.requestee_id > 0) {
            requestedPersonCmIds.add(req.requestee_id);
          }
        });

        // Batch fetch all requested persons
        const personMap = new Map<number, PersonsResponse>();
        if (requestedPersonCmIds.size > 0) {
          const personsFilter = `(${Array.from(requestedPersonCmIds).map(id => `cm_id = ${id}`).join(' || ')}) && year = ${currentYear}`;
          const persons = await pb.collection<PersonsResponse>('persons').getFullList({
            filter: personsFilter
          });

          // Create lookup map
          persons.forEach(person => {
            personMap.set(person.cm_id, person);
          });
        }

        // Enhance requests with person names
        return requests.map(req => {
          const person = req.requestee_id && req.requestee_id > 0 ? personMap.get(req.requestee_id) : null;
          return {
            ...req,
            requestedPersonName: person ? `${person.first_name} ${person.last_name}` : null
          };
        });
      } catch (err) {
        console.error('Error fetching person bunk requests:', err);
        return [];
      }
    },
    enabled: !!personCmId,
  });

  return {
    allBunkRequests,
    isLoading,
    error: error as Error | null,
  };
}
