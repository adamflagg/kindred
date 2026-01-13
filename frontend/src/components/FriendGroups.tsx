import { useMemo, useState } from 'react';
import type { Camper, Constraint, Bunk } from '../types/app-types';

interface FriendGroupsProps {
  sessionId: string;
  campers: Camper[];
  constraints: Constraint[];
  bunks?: Bunk[];
}

interface FriendGroup {
  id: string;
  campers: Camper[];
  size: number;
  isComplete: boolean; // All members are bunked together
  isSplit: boolean; // Members are in different bunks
  bunks: Set<string | null>;
  hasError?: boolean; // Has cross-session constraint error
  errorMessage?: string;
}

export default function FriendGroups({ campers, constraints, bunks = [] }: FriendGroupsProps) {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'complete' | 'split' | 'isolated'>('all');
  
  // Create bunk ID to name map
  const bunkIdToName = useMemo(() => {
    const map = new Map<string, string>();
    bunks.forEach(bunk => map.set(bunk.id, bunk.name));
    return map;
  }, [bunks]);

  // Build friend groups from pair_together constraints
  const friendGroups = useMemo(() => {
    const groups = new Map<string, Set<string>>();
    const camperToGroup = new Map<string, string>();
    const groupErrors = new Map<string, string>();
    
    // Track camper IDs in this session
    const sessionCamperIds = new Set(campers.map(c => c.id));
    
    // Only consider pair_together constraints
    const pairConstraints = constraints.filter(c => c.type === 'pair_together');
    
    // Build connected components
    pairConstraints.forEach(constraint => {
      // Check if constraint references campers not in this session
      const missingCampers = constraint.campers?.filter(id => !sessionCamperIds.has(id)) || [];
      if (missingCampers.length > 0 && constraint.campers) {
        // Create error group for cross-session constraints
        const errorGroupId = `error-${groups.size}`;
        const presentCampers = constraint.campers.filter(id => sessionCamperIds.has(id));
        if (presentCampers.length > 0) {
          groups.set(errorGroupId, new Set(presentCampers));
          presentCampers.forEach(id => camperToGroup.set(id, errorGroupId));
          groupErrors.set(errorGroupId, `Request includes ${missingCampers.length} camper(s) from other sessions`);
        }
        return;
      }
      constraint.campers?.forEach(camperId => {
        const existingGroupId = camperToGroup.get(camperId);
        
        if (!existingGroupId) {
          // Create new group
          const groupId = `group-${groups.size}`;
          const newGroup = new Set(constraint.campers || []);
          groups.set(groupId, newGroup);
          constraint.campers?.forEach(id => camperToGroup.set(id, groupId));
        } else {
          // Merge with existing group
          const existingGroup = groups.get(existingGroupId);
          if (existingGroup) {
            constraint.campers?.forEach(id => {
              if (!camperToGroup.has(id)) {
                existingGroup.add(id);
                camperToGroup.set(id, existingGroupId);
              } else if (camperToGroup.get(id) !== existingGroupId) {
                // Merge two groups
                const otherGroupId = camperToGroup.get(id);
                if (otherGroupId) {
                  const otherGroup = groups.get(otherGroupId);
                  if (otherGroup) {
                    otherGroup.forEach(otherId => {
                      existingGroup.add(otherId);
                      camperToGroup.set(otherId, existingGroupId);
                    });
                    groups.delete(otherGroupId);
                  }
                }
              }
            });
          }
        }
      });
    });
    
    // Add isolated campers (no constraints)
    campers.forEach(camper => {
      if (!camperToGroup.has(camper.id)) {
        const groupId = `isolated-${camper.id}`;
        groups.set(groupId, new Set([camper.id]));
        camperToGroup.set(camper.id, groupId);
      }
    });
    
    // Convert to FriendGroup objects
    const friendGroupsList: FriendGroup[] = [];
    groups.forEach((camperIds, groupId) => {
      const groupCampers = Array.from(camperIds)
        .map(id => campers.find(c => c.id === id))
        .filter(Boolean) as Camper[];
      
      const bunks = new Set<string | null>(groupCampers.map(c => c.assigned_bunk || null));
      const isComplete = bunks.size === 1 && !bunks.has(null);
      const isSplit = bunks.size > 1;
      
      const group: FriendGroup = {
        id: groupId,
        campers: groupCampers,
        size: groupCampers.length,
        isComplete,
        isSplit,
        bunks,
        hasError: groupErrors.has(groupId),
      };
      
      if (groupErrors.has(groupId)) {
        const errorMessage = groupErrors.get(groupId);
        if (errorMessage) {
          group.errorMessage = errorMessage;
        }
      }
      
      friendGroupsList.push(group);
    });
    
    // Sort by size (larger groups first), then by status
    return friendGroupsList.sort((a, b) => {
      if (a.size !== b.size) return b.size - a.size;
      if (a.isSplit !== b.isSplit) return a.isSplit ? -1 : 1;
      if (a.isComplete !== b.isComplete) return a.isComplete ? 1 : -1;
      return 0;
    });
  }, [campers, constraints]);

  // Filter groups
  const filteredGroups = useMemo(() => {
    switch (filter) {
      case 'complete':
        return friendGroups.filter(g => g.isComplete);
      case 'split':
        return friendGroups.filter(g => g.isSplit);
      case 'isolated':
        return friendGroups.filter(g => g.size === 1);
      default:
        return friendGroups;
    }
  }, [friendGroups, filter]);

  // Stats
  const stats = useMemo(() => {
    const total = friendGroups.length;
    const complete = friendGroups.filter(g => g.isComplete).length;
    const split = friendGroups.filter(g => g.isSplit).length;
    const isolated = friendGroups.filter(g => g.size === 1).length;
    const totalCampers = campers.length;
    const campersInGroups = friendGroups.filter(g => g.size > 1).reduce((sum, g) => sum + g.size, 0);
    
    return { total, complete, split, isolated, totalCampers, campersInGroups };
  }, [friendGroups, campers]);

  const getGroupTypeIcon = (group: FriendGroup) => {
    if (group.isComplete) {
      return (
        <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    }
    if (group.isSplit) {
      return (
        <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      );
    }
    if (group.size === 1) {
      return (
        <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      );
    }
    return (
      <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    );
  };

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold">{stats.total}</div>
          <div className="text-sm text-muted-foreground">Total Groups</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-green-600">{stats.complete}</div>
          <div className="text-sm text-muted-foreground">Complete Groups</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-yellow-600">{stats.split}</div>
          <div className="text-sm text-muted-foreground">Split Groups</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-muted-foreground">{stats.isolated}</div>
          <div className="text-sm text-muted-foreground">Isolated Campers</div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2">
        {(['all', 'complete', 'split', 'isolated'] as const).map(filterType => (
          <button
            key={filterType}
            onClick={() => setFilter(filterType)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              filter === filterType
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80 text-muted-foreground'
            }`}
          >
            {filterType.charAt(0).toUpperCase() + filterType.slice(1)}
            {filterType === 'all' && ` (${stats.total})`}
            {filterType === 'complete' && ` (${stats.complete})`}
            {filterType === 'split' && ` (${stats.split})`}
            {filterType === 'isolated' && ` (${stats.isolated})`}
          </button>
        ))}
      </div>

      {/* Groups List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredGroups.map(group => (
          <div
            key={group.id}
            onClick={() => setSelectedGroup(selectedGroup === group.id ? null : group.id)}
            className={`bg-card rounded-lg border p-4 cursor-pointer transition-all hover:shadow-md ${
              selectedGroup === group.id ? 'ring-2 ring-primary' : ''
            }`}
          >
            {/* Group Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {getGroupTypeIcon(group)}
                <span className="font-semibold">
                  {group.size === 1 ? 'Individual' : `Group of ${group.size}`}
                </span>
              </div>
              {group.hasError && (
                <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded-full">
                  Error
                </span>
              )}
              {!group.hasError && group.isSplit && (
                <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full">
                  Split
                </span>
              )}
              {!group.hasError && !group.isSplit && group.isComplete && (
                <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
                  Complete
                </span>
              )}
            </div>

            {/* Campers List */}
            <div className="space-y-2">
              {group.campers.slice(0, selectedGroup === group.id ? undefined : 3).map(camper => (
                <div key={camper.id} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{camper.name}</span>
                  <span className="text-muted-foreground">
                    {camper.assigned_bunk ? bunkIdToName.get(camper.assigned_bunk) || camper.assigned_bunk : 'Unassigned'}
                  </span>
                </div>
              ))}
              {!selectedGroup && group.campers.length > 3 && (
                <div className="text-sm text-muted-foreground">
                  +{group.campers.length - 3} more...
                </div>
              )}
            </div>

            {/* Bunks Summary */}
            {group.bunks.size > 1 && (
              <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                Spread across {group.bunks.size} bunks
              </div>
            )}
            
            {/* Error Message */}
            {group.hasError && group.errorMessage && (
              <div className="mt-3 pt-3 border-t text-xs text-red-600">
                ⚠️ {group.errorMessage}
              </div>
            )}
          </div>
        ))}
      </div>

      {filteredGroups.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No groups match the selected filter
        </div>
      )}
    </div>
  );
}