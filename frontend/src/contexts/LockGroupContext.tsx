import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { pb } from '../lib/pocketbase';
import { useYear } from '../hooks/useCurrentYear';
import { useScenario } from '../hooks/useScenario';
import type { LockedGroupsResponse, LockedGroupMembersResponse, AttendeesResponse } from '../types/pocketbase-types';
import type { Camper } from '../types/app-types';

// Animation duration must match CSS keyframes
const ANIMATION_DURATION_MS = 2000;

// Type for members with expanded attendee and person
type ExpandedMember = LockedGroupMembersResponse & {
  expand?: {
    attendee?: AttendeesResponse & {
      expand?: {
        person?: {
          id: string;
          cm_id: number;
          gender?: string;
        };
        session?: {
          id: string;
          session_type?: string;
        };
      };
    };
  };
};

interface LockGroupContextValue {
  // Pending campers (marked for locking)
  pendingCampers: Camper[];
  addPendingCamper: (camper: Camper) => void;
  removePendingCamper: (camperId: string) => void;
  clearPendingCampers: () => void;
  isPending: (camperId: string) => boolean;
  getPendingAnimationDelay: (camperId: string) => number; // Per-camper delay for synced glow

  // Lock groups data
  groups: LockedGroupsResponse[];
  groupsLoading: boolean;
  membersByGroup: Record<string, ExpandedMember[]>;
  membersLoading: boolean;

  // Helper functions
  getCamperLockGroup: (camperCmId: number) => LockedGroupsResponse | null;
  getCamperLockState: (camperCmId: number) => 'none' | 'pending' | 'locked';
  getCamperLockGroupColor: (camperCmId: number) => string | undefined;
  getGroupMembers: (groupId: string) => number[]; // Returns person CM IDs
  addCamperToGroup: (camper: Camper, groupId: string) => Promise<void>; // Add camper directly to existing group

  // UI state
  selectedGroupId: string | null;
  setSelectedGroupId: (groupId: string | null) => void;
  isLockPanelOpen: boolean;
  setIsLockPanelOpen: (isOpen: boolean) => void;

  // Session and Scenario
  sessionPbId: string | null;
  setSessionPbId: (sessionPbId: string) => void;
  scenarioId: string | null; // From ScenarioContext
  isDraftMode: boolean; // True when viewing a draft scenario
}

const LockGroupContext = createContext<LockGroupContextValue | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export function useLockGroupContext() {
  const context = useContext(LockGroupContext);
  if (!context) {
    throw new Error('useLockGroupContext must be used within LockGroupProvider');
  }
  return context;
}

interface LockGroupProviderProps {
  children: React.ReactNode;
}

export function LockGroupProvider({ children }: LockGroupProviderProps) {
  // State
  const queryClient = useQueryClient();
  const currentYear = useYear();
  const { currentScenario, isProductionMode } = useScenario();
  const scenarioId = currentScenario?.id ?? null;
  const isDraftMode = !isProductionMode && !!scenarioId;

  const [sessionPbId, setSessionPbId] = useState<string | null>(null);
  const [pendingCampers, setPendingCampers] = useState<Camper[]>([]);
  const [pendingDelays, setPendingDelays] = useState<Map<string, number>>(new Map());
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [isLockPanelOpen, setIsLockPanelOpen] = useState(false);
  const [prevScenarioId, setPrevScenarioId] = useState(scenarioId);

  // Clear pending campers when scenario changes (render-time check)
  if (scenarioId !== prevScenarioId) {
    setPrevScenarioId(scenarioId);
    setPendingCampers([]);
    setPendingDelays(new Map());
    setSelectedGroupId(null);
  }

  // Fetch lock groups for the scenario, session, and year
  // Only enabled in draft mode (when scenarioId is set)
  const { data: groups = [], isLoading: groupsLoading } = useQuery({
    queryKey: ['locked-groups', scenarioId, sessionPbId, currentYear],
    queryFn: async () => {
      if (!sessionPbId || !scenarioId) return [];
      const result = await pb.collection('locked_groups').getList<LockedGroupsResponse>(1, 500, {
        filter: pb.filter('scenario = {:scenario} && session = {:session} && year = {:year}', {
          scenario: scenarioId,
          session: sessionPbId,
          year: currentYear
        }),
        sort: 'created'
      });
      return result.items;
    },
    enabled: isDraftMode && !!sessionPbId && !!scenarioId
  });

  // Fetch all group members for the groups (with expanded attendee for person_id)
  const { data: allMembers = [], isLoading: membersLoading } = useQuery({
    queryKey: ['locked-group-members', scenarioId, sessionPbId, groups.length],
    queryFn: async () => {
      if (!sessionPbId || groups.length === 0) return [];

      const groupIds = groups.map((g: LockedGroupsResponse) => g.id);
      // Build OR filter for each group ID using pb.filter for safe escaping
      const filterParts = groupIds.map((_, i) => `group = {:g${i}}`);
      const filterParams = groupIds.reduce((acc, id, i) => ({ ...acc, [`g${i}`]: id }), {});
      const filter = pb.filter(filterParts.join(' || '), filterParams);

      const result = await pb.collection('locked_group_members').getList<ExpandedMember>(1, 500, {
        filter,
        expand: 'attendee,attendee.person,attendee.session'
      });
      return result.items;
    },
    enabled: isDraftMode && !!sessionPbId && groups.length > 0
  });

  // Group members by group ID (using relation field 'group')
  const membersByGroup = useMemo(() => {
    return allMembers.reduce((acc: Record<string, ExpandedMember[]>, member: ExpandedMember) => {
      const groupId = member.group;
      if (!acc[groupId]) {
        acc[groupId] = [];
      }
      acc[groupId]?.push(member);
      return acc;
    }, {} as Record<string, ExpandedMember[]>);
  }, [allMembers]);

  // Create a map of camper person_id (CM ID) to group for quick lookups
  const camperToGroup = useMemo(() => {
    const map = new Map<number, LockedGroupsResponse>();

    for (const group of groups) {
      const members = membersByGroup[group.id] || [];
      for (const member of members) {
        // Get person_id from expanded attendee
        const personCmId = member.expand?.attendee?.person_id;
        if (personCmId) {
          map.set(personCmId, group);
        }
      }
    }

    return map;
  }, [groups, membersByGroup]);

  // Pending camper functions
  const addPendingCamper = useCallback((camper: Camper) => {
    if (!isDraftMode) return; // Only allow in draft mode

    // Check state directly using functional updates to avoid stale closures
    setPendingCampers(prev => {
      // Already pending?
      if (prev.some(c => c.id === camper.id)) return prev;
      // Already in a lock group?
      if (camperToGroup.has(camper.person_cm_id)) return prev;

      // Calculate animation delay and add to delays map
      const delay = -(Date.now() % ANIMATION_DURATION_MS);
      setPendingDelays(prevDelays => new Map(prevDelays).set(camper.id, delay));

      return [...prev, camper];
    });
  }, [isDraftMode, camperToGroup]);

  const removePendingCamper = useCallback((camperId: string) => {
    setPendingCampers(prev => prev.filter(c => c.id !== camperId));
    setPendingDelays(prev => {
      const next = new Map(prev);
      next.delete(camperId);
      return next;
    });
  }, []);

  const clearPendingCampers = useCallback(() => {
    setPendingCampers([]);
    setPendingDelays(new Map());
  }, []);

  // Check functions that read current state
  const isPending = useCallback((camperId: string) => {
    return pendingCampers.some(c => c.id === camperId);
  }, [pendingCampers]);

  const getPendingAnimationDelay = useCallback((camperId: string) => {
    return pendingDelays.get(camperId) ?? 0;
  }, [pendingDelays]);

  // Helper functions
  const getCamperLockGroup = useCallback((camperCmId: number) => {
    if (!isDraftMode) return null;
    return camperToGroup.get(camperCmId) || null;
  }, [camperToGroup, isDraftMode]);

  const getCamperLockState = useCallback((camperCmId: number): 'none' | 'pending' | 'locked' => {
    if (!isDraftMode) return 'none';

    // Check if in a lock group
    if (camperToGroup.has(camperCmId)) {
      return 'locked';
    }

    // Check if pending
    if (pendingCampers.some(c => c.person_cm_id === camperCmId)) {
      return 'pending';
    }

    return 'none';
  }, [isDraftMode, camperToGroup, pendingCampers]);

  const getCamperLockGroupColor = useCallback((camperCmId: number) => {
    if (!isDraftMode) return undefined;
    const group = camperToGroup.get(camperCmId);
    return group?.color;
  }, [camperToGroup, isDraftMode]);

  const getGroupMembers = useCallback((groupId: string) => {
    const members = membersByGroup[groupId] || [];
    // Return person_id (CM ID) from expanded attendee
    return members
      .map((m: ExpandedMember) => m.expand?.attendee?.person_id)
      .filter((id): id is number => id !== undefined);
  }, [membersByGroup]);

  // Add camper directly to an existing lock group
  const addCamperToGroup = useCallback(async (camper: Camper, groupId: string) => {
    if (!isDraftMode) return;

    // Get the attendee PB ID from the camper
    const attendeePbId = camper.attendee_id || camper.id;

    if (!attendeePbId) {
      console.error('Camper missing attendee_id');
      toast.error('Cannot add camper: missing attendee ID');
      return;
    }

    // Check if camper is already in a group
    if (camperToGroup.has(camper.person_cm_id)) {
      toast.error('Camper is already in a friend group');
      return;
    }

    try {
      await pb.collection('locked_group_members').create({
        group: groupId,
        attendee: attendeePbId,
        added_by: pb.authStore.record?.['email'] || 'unknown'
      });

      // Invalidate queries to refresh
      queryClient.invalidateQueries({ queryKey: ['locked-groups', scenarioId, sessionPbId, currentYear] });
      queryClient.invalidateQueries({ queryKey: ['locked-group-members', scenarioId, sessionPbId] });
      queryClient.invalidateQueries({ queryKey: ['locked-groups-panel', scenarioId, sessionPbId, currentYear] });
      queryClient.invalidateQueries({ queryKey: ['locked-group-members-panel', scenarioId, sessionPbId] });

      const group = groups.find(g => g.id === groupId);
      const groupName = group?.name || 'friend group';
      toast.success(`Added ${camper.name} to ${groupName}`);
    } catch (error) {
      console.error('Failed to add camper to group:', error);
      toast.error('Failed to add camper to group');
    }
  }, [isDraftMode, camperToGroup, queryClient, scenarioId, sessionPbId, currentYear, groups]);

  const value: LockGroupContextValue = {
    // Pending campers
    pendingCampers,
    addPendingCamper,
    removePendingCamper,
    clearPendingCampers,
    isPending,
    getPendingAnimationDelay,

    // Lock groups data
    groups,
    groupsLoading,
    membersByGroup,
    membersLoading,

    // Helper functions
    getCamperLockGroup,
    getCamperLockState,
    getCamperLockGroupColor,
    getGroupMembers,
    addCamperToGroup,

    // UI state
    selectedGroupId,
    setSelectedGroupId,
    isLockPanelOpen,
    setIsLockPanelOpen,

    // Session and Scenario
    sessionPbId,
    setSessionPbId,
    scenarioId,
    isDraftMode
  };

  return (
    <LockGroupContext.Provider value={value}>
      {children}
    </LockGroupContext.Provider>
  );
}

export default LockGroupContext;
