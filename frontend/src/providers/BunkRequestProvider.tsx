import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import { useAuth } from '../contexts/AuthContext';
import { useYear } from '../hooks/useCurrentYear';
import type { BunkRequest } from '../types/app-types';
import { BunkRequestContext, type BunkmateInfo } from '../contexts/BunkRequestContext';
import { isAgePreferenceSatisfied } from '../utils/agePreferenceSatisfaction';

interface BunkRequestProviderProps {
  sessionCmId: number;
  children: React.ReactNode;
}

export function BunkRequestProvider({ sessionCmId, children }: BunkRequestProviderProps) {
  const currentYear = useYear();
  const { user } = useAuth();

  // Fetch ALL bunk requests for the session once
  const { data: allRequests = [], isLoading, error } = useQuery<BunkRequest[]>({
    queryKey: ['all-bunk-requests', sessionCmId, currentYear],
    queryFn: async () => {
      // Inline getBunkRequests
      try {
        const filter = `session_id = ${sessionCmId} && year = ${currentYear}`;

        // Include all requests (includeAll = true)
        // No status filter when includeAll is true

        const requests = await pb.collection<BunkRequest>('bunk_requests').getFullList({
          filter: filter,
          sort: '-priority,requester_id',
          // Unique request key prevents PocketBase auto-cancellation
          requestKey: `bunk-requests-${sessionCmId}-${currentYear}`
        });

        return requests;
      } catch (error) {
        console.error('Error fetching bunk requests:', error);
        return [];
      }
    },
    staleTime: 1 * 60 * 1000, // 1 minute - user-editable data
    gcTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!user, // Only run query if user is authenticated
  });

  // Pre-compute request lookups
  // React Compiler will optimize this computation
  const getRequestsByPerson = () => {
    const map = new Map<number, BunkRequest[]>();
    allRequests.forEach(request => {
      const existing = map.get(request.requester_id) || [];
      map.set(request.requester_id, [...existing, request]);
    });
    return map;
  };
  
  const requestsByPerson = getRequestsByPerson();

  const hasRequests = (personCmId: number): boolean => {
    return requestsByPerson.has(personCmId);
  };

  const getRequestsForCamper = (personCmId: number): BunkRequest[] => {
    return requestsByPerson.get(personCmId) || [];
  };

  // Cache bunk person sets to avoid recreating for each camper in the bunk
  // Key: bunkCmId, Value: Set of person CM IDs
  const bunkPersonSetCache = React.useRef<Map<number, { set: Set<number>; size: number }>>(new Map());

  const getBunkPersonSet = (bunkCmId: number, campersInBunk: BunkmateInfo[]): Set<number> => {
    const cached = bunkPersonSetCache.current.get(bunkCmId);
    // Invalidate if camper count changed
    if (cached && cached.size === campersInBunk.length) {
      return cached.set;
    }
    const set = new Set(campersInBunk.map(c => c.cmId));
    bunkPersonSetCache.current.set(bunkCmId, { set, size: campersInBunk.length });
    return set;
  };

  const getSatisfiedRequestInfo = (
    personCmId: number,
    bunkCmId: number,
    campersInBunk: BunkmateInfo[],
    requesterGrade: number | null
  ) => {
    const personRequests = requestsByPerson.get(personCmId) || [];

    if (personRequests.length === 0 || !bunkCmId) {
      return {
        totalRequests: 0,
        satisfiedCount: 0,
        topPrioritySatisfied: false,
        priorityLevels: [],
        hasLockedPriority: false
      };
    }

    // Get cached bunk person set - O(1) after first call for this bunk
    const personSet = getBunkPersonSet(bunkCmId, campersInBunk);

    // Get bunkmate grades (excluding requester) using the grade map
    const bunkmateGrades: number[] = [];
    if (requesterGrade !== null) {
      for (const c of campersInBunk) {
        if (c.cmId !== personCmId && c.grade !== null) {
          bunkmateGrades.push(c.grade);
        }
      }
    }

    // Check which requests are satisfied
    const satisfiedRequests = personRequests.filter(req => {
      if (req.request_type === 'bunk_with' && req.requestee_id) {
        return personSet.has(req.requestee_id);
      } else if (req.request_type === 'not_bunk_with' && req.requestee_id) {
        return !personSet.has(req.requestee_id);
      } else if (req.request_type === 'age_preference' && req.age_preference_target) {
        if (requesterGrade === null || bunkmateGrades.length === 0) {
          return false;
        }
        const preference = req.age_preference_target as 'older' | 'younger';
        return isAgePreferenceSatisfied(requesterGrade, bunkmateGrades, preference).satisfied;
      }
      return false;
    });

    // Sort by priority to find top priority
    const sortedSatisfied = satisfiedRequests.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    const topPriority = personRequests.reduce((max, req) => Math.max(max, req.priority || 0), 0);
    const topPrioritySatisfied = sortedSatisfied.some(req => (req.priority || 0) === topPriority);
    const priorityLevels = [...new Set(sortedSatisfied.map(r => r.priority || 0))].sort((a, b) => b - a);
    const hasLockedPriority = satisfiedRequests.some(req => req.priority_locked);

    return {
      totalRequests: personRequests.length,
      satisfiedCount: satisfiedRequests.length,
      topPrioritySatisfied,
      priorityLevels,
      hasLockedPriority
    };
  };

  const value = {
    allRequests,
    hasRequests,
    getRequestsForCamper,
    getSatisfiedRequestInfo,
    isLoading,
    error: error as Error | null,
  };

  return (
    <BunkRequestContext.Provider value={value}>
      {children}
    </BunkRequestContext.Provider>
  );
}