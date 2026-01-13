import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Trash2, Users, ChevronRight, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { pb } from '../lib/pocketbase';
import { useYear } from '../hooks/useCurrentYear';
import { useLockGroupContext } from '../contexts/LockGroupContext';
import { getDisplayAgeForYear } from '../utils/displayAge';
import type { LockedGroupsResponse, LockedGroupMembersResponse, AttendeesResponse } from '../types/pocketbase-types';

import type { Camper } from '../types/app-types';

type BunkArea = 'all' | 'boys' | 'girls' | 'all-gender';

interface LockGroupPanelProps {
  isOpen: boolean;
  onClose: () => void;
  sessionPbId: string;
  scenarioId: string;
  selectedGroupId?: string | null;
  onGroupSelect?: (groupId: string | null) => void;
  requestClose?: boolean; // When true, triggers animated close
  selectedArea?: BunkArea;
  campers?: Camper[]; // All campers - used for area filtering
}

// Type for members with expanded attendee and person
type ExpandedMember = LockedGroupMembersResponse & {
  expand?: {
    attendee?: AttendeesResponse & {
      expand?: {
        person?: {
          id: string;
          cm_id: number;
          first_name?: string;
          last_name?: string;
          preferred_name?: string;
        };
        session?: {
          id: string;
          cm_id: number;
          name: string;
          session_type: string;
        };
      };
    };
  };
};

// Available colors for groups - hex values in rainbow order (no greys)
const GROUP_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#a855f7', // purple
  '#ec4899', // pink
];

// Helper to check if a camper matches a specific area (same logic as unassigned filtering)
function camperMatchesArea(camper: Camper, area: BunkArea): boolean {
  if (area === 'all') return true;

  const isFromAGSession = camper.expand?.session?.session_type === 'ag';

  if (area === 'all-gender') {
    return isFromAGSession;
  }

  if (isFromAGSession) return false;

  if (area === 'boys') return camper.gender === 'M';
  if (area === 'girls') return camper.gender === 'F';

  return true;
}

function LockGroupPanel({
  isOpen,
  onClose,
  sessionPbId,
  scenarioId,
  selectedGroupId,
  onGroupSelect,
  requestClose = false,
  selectedArea = 'all',
  campers = []
}: LockGroupPanelProps) {
  const queryClient = useQueryClient();
  const currentYear = useYear();
  useLockGroupContext(); // Keep context subscription for future use

  // Track expanded group - derive from prop or allow local overrides
  const [localExpandedGroupId, setLocalExpandedGroupId] = useState<string | null>(null);
  // Derive effective expanded group: use selectedGroupId if provided, otherwise use local state
  const expandedGroupId = selectedGroupId || localExpandedGroupId;
  const setExpandedGroupId = setLocalExpandedGroupId;

  const [isClosing, setIsClosing] = useState(false);

  // Handle close with animation - called directly from event handlers, not effects
  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 280); // Slightly less than animation duration
  }, [onClose]);

  // Handle external close request (animated)
  useEffect(() => {
    if (requestClose && isOpen && !isClosing) {
      handleClose();
    }
  }, [requestClose, isOpen, isClosing, handleClose]);

  // Fetch lock groups for the scenario, session, and year
  const { data: groups = [], isLoading: groupsLoading } = useQuery({
    queryKey: ['locked-groups-panel', scenarioId, sessionPbId, currentYear],
    queryFn: async () => {
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
    enabled: isOpen && !!sessionPbId && !!scenarioId
  });

  // Fetch all group members with expanded attendee -> person and session
  const { data: allMembers = [], isLoading: membersLoading } = useQuery({
    queryKey: ['locked-group-members-panel', scenarioId, sessionPbId, groups.length],
    queryFn: async () => {
      if (groups.length === 0) return [];

      const groupIds = groups.map((g: LockedGroupsResponse) => g.id);
      // Build OR filter for each group ID
      const filterParts = groupIds.map((_, i) => `group = {:g${i}}`);
      const filterParams = groupIds.reduce((acc, id, i) => ({ ...acc, [`g${i}`]: id }), {});
      const filter = pb.filter(filterParts.join(' || '), filterParams);

      const result = await pb.collection('locked_group_members').getList<ExpandedMember>(1, 500, {
        filter,
        expand: 'attendee,attendee.person,attendee.session'
      });
      return result.items;
    },
    enabled: isOpen && groups.length > 0
  });

  // Group members by group ID
  const membersByGroup = allMembers.reduce((acc: Record<string, ExpandedMember[]>, member: ExpandedMember) => {
    const groupId = member.group;
    if (!acc[groupId]) {
      acc[groupId] = [];
    }
    acc[groupId]?.push(member);
    return acc;
  }, {} as Record<string, ExpandedMember[]>);

  // Helper to get age from member (year-aware for historical viewing)
  const getMemberAge = useCallback((member: ExpandedMember): number | null => {
    const person = member.expand?.attendee?.expand?.person;
    if (!person) return null;
    // Cast to include age/birthdate for getDisplayAgeForYear
    const personWithAge = person as { age?: number; birthdate?: string };
    return getDisplayAgeForYear(personWithAge, currentYear);
  }, [currentYear]);

  // Calculate average age for a group's members
  const getGroupAverageAge = useCallback((members: ExpandedMember[]): number | null => {
    const ages = members.map(m => getMemberAge(m)).filter((age): age is number => age !== null);
    if (ages.length === 0) return null;
    return ages.reduce((sum, age) => sum + age, 0) / ages.length;
  }, [getMemberAge]);

  // Sort groups by average age of members (ascending)
  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => {
      const avgA = getGroupAverageAge(membersByGroup[a.id] || []) ?? Infinity;
      const avgB = getGroupAverageAge(membersByGroup[b.id] || []) ?? Infinity;
      return avgA - avgB;
    });
  }, [groups, membersByGroup, getGroupAverageAge]);

  // Build a map of person CM ID -> Camper for quick lookups
  const camperByPersonCmId = useMemo(() => {
    const map = new Map<number, Camper>();
    for (const camper of campers) {
      map.set(camper.person_cm_id, camper);
    }
    return map;
  }, [campers]);

  // Filter groups by selected area (ALL members must match the area)
  const filteredGroups = useMemo(() => {
    if (selectedArea === 'all') return sortedGroups;

    return sortedGroups.filter(group => {
      const members = membersByGroup[group.id] || [];
      if (members.length === 0) return true; // Empty groups show everywhere

      // Get the person CM IDs for this group's members
      const memberPersonCmIds = members
        .map(m => m.expand?.attendee?.person_id)
        .filter((id): id is number => id !== undefined);

      // ALL members must match the selected area
      return memberPersonCmIds.every(personCmId => {
        const camper = camperByPersonCmId.get(personCmId);
        if (!camper) return false; // If we can't find the camper, exclude from this area
        return camperMatchesArea(camper, selectedArea);
      });
    });
  }, [sortedGroups, membersByGroup, selectedArea, camperByPersonCmId]);

  // Calculate filtered member count for footer
  const filteredMemberCount = useMemo(() => {
    return filteredGroups.reduce((sum, group) => {
      return sum + (membersByGroup[group.id]?.length || 0);
    }, 0);
  }, [filteredGroups, membersByGroup]);

  // Update group color mutation
  const updateGroupMutation = useMutation({
    mutationFn: async ({ groupId, updates }: { groupId: string; updates: Partial<LockedGroupsResponse> }) => {
      return await pb.collection('locked_groups').update(groupId, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locked-groups', scenarioId, sessionPbId, currentYear] });
      queryClient.invalidateQueries({ queryKey: ['locked-groups-panel', scenarioId, sessionPbId, currentYear] });
    }
  });

  // Delete group mutation
  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      // Delete all members first
      const members = membersByGroup[groupId] || [];
      for (const member of members) {
        await pb.collection('locked_group_members').delete(member.id);
      }

      // Then delete the group
      return await pb.collection('locked_groups').delete(groupId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locked-groups', scenarioId, sessionPbId, currentYear] });
      queryClient.invalidateQueries({ queryKey: ['locked-groups-panel', scenarioId, sessionPbId, currentYear] });
      queryClient.invalidateQueries({ queryKey: ['locked-group-members', scenarioId, sessionPbId] });
      queryClient.invalidateQueries({ queryKey: ['locked-group-members-panel', scenarioId, sessionPbId] });
    }
  });

  // Remove member from group mutation
  const removeMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      return await pb.collection('locked_group_members').delete(memberId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locked-group-members', scenarioId, sessionPbId] });
      queryClient.invalidateQueries({ queryKey: ['locked-group-members-panel', scenarioId, sessionPbId] });
    }
  });

  const handleColorChange = (groupId: string, color: string) => {
    updateGroupMutation.mutate({
      groupId,
      updates: { color }
    });
  };

  // Get display name for a member
  const getMemberDisplayName = (member: ExpandedMember): string => {
    const person = member.expand?.attendee?.expand?.person;
    if (person) {
      const firstName = person.preferred_name || person.first_name || '';
      const lastName = person.last_name || '';
      return `${firstName} ${lastName}`.trim() || `Camper ${person.cm_id}`;
    }
    return `Attendee ${member.attendee}`;
  };

  // Get session info for a member (for cross-session detection)
  const getMemberSessionInfo = (member: ExpandedMember): { name: string; type: string; id: string } | null => {
    const session = member.expand?.attendee?.expand?.session;
    if (session) {
      return {
        name: session.name,
        type: session.session_type,
        id: session.id
      };
    }
    return null;
  };

  // Get gender for a member (for cross-gender detection)
  const getMemberGender = (member: ExpandedMember): string | null => {
    // Gender is on the attendee, not the person
    const attendee = member.expand?.attendee;
    if (attendee && 'gender' in attendee) {
      return (attendee as { gender?: string }).gender || null;
    }
    return null;
  };

  // Detect validation issues in a group
  const getGroupValidationIssues = (members: ExpandedMember[]): string[] => {
    const issues: string[] = [];

    if (members.length < 2) return issues;

    // Check for cross-session issues
    const sessions = new Map<string, string>();
    let hasAGSession = false;

    for (const member of members) {
      const sessionInfo = getMemberSessionInfo(member);
      if (sessionInfo) {
        sessions.set(sessionInfo.id, sessionInfo.name);
        if (sessionInfo.type === 'ag') {
          hasAGSession = true;
        }
      }
    }

    if (sessions.size > 1) {
      const sessionNames = Array.from(sessions.values());
      issues.push(`Cross-session: ${sessionNames.join(', ')}`);
    }

    // Check for cross-gender issues (only for non-AG sessions)
    if (!hasAGSession) {
      const genders = new Set<string>();
      for (const member of members) {
        const gender = getMemberGender(member);
        if (gender) {
          genders.add(gender);
        }
      }

      if (genders.size > 1 && !genders.has('NB')) {
        // Has both M and F without being in an AG session
        issues.push('Cross-gender: cannot bunk M and F campers together');
      }
    }

    return issues;
  };

  const isLoading = groupsLoading || membersLoading;

  if (!isOpen) return null;

  return (
    <div
      data-panel="lock-group"
      className={clsx(
        "fixed inset-y-0 left-0 w-96 bg-background border-r shadow-xl z-50",
        isClosing ? "animate-slide-out-left" : "animate-slide-in-left"
      )}
    >
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Friend Groups</h2>
            <p className="text-sm text-muted-foreground">
              Keep campers together during assignments
            </p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-muted rounded-md transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-6 text-center text-muted-foreground">
              Loading groups...
            </div>
          ) : groups.length === 0 ? (
            <div className="p-6 text-center">
              <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground mb-4">
                No friend groups yet
              </p>
              <p className="text-sm text-muted-foreground">
                Ctrl+Click campers to select them, then click "Create Group" to keep them together.
              </p>
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="p-6 text-center">
              <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground mb-4">
                No friend groups in this area
              </p>
              <p className="text-sm text-muted-foreground">
                {groups.length} group{groups.length !== 1 ? 's' : ''} exist in other areas.
              </p>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {filteredGroups.map((group: LockedGroupsResponse) => {
                const members = membersByGroup[group.id] || [];
                const isExpanded = expandedGroupId === group.id;
                const validationIssues = getGroupValidationIssues(members);
                const hasIssues = validationIssues.length > 0;

                return (
                  <div
                    key={group.id}
                    className={clsx(
                      'border rounded-lg overflow-hidden transition-all',
                      isExpanded && 'ring-2 ring-primary',
                      hasIssues && 'border-destructive'
                    )}
                  >
                    {/* Group Header */}
                    <div
                      className="p-4 cursor-pointer hover:bg-muted/50 transition-colors border-l-4"
                      style={{ borderLeftColor: group.color }}
                      onClick={() => {
                        setExpandedGroupId(isExpanded ? null : group.id);
                        onGroupSelect?.(isExpanded ? null : group.id);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <ChevronRight
                            className={clsx(
                              'h-4 w-4 transition-transform',
                              isExpanded && 'rotate-90'
                            )}
                          />
                          <span className="font-medium">
                            {group.name || 'Unnamed Group'}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            • {members.length} camper{members.length !== 1 ? 's' : ''}
                          </span>
                          {hasIssues && (
                            <AlertTriangle className="h-4 w-4 text-destructive" />
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const displayName = group.name || 'this group';
                              if (confirm(`Delete "${displayName}"? This will remove all ${members.length} campers from the group.`)) {
                                deleteGroupMutation.mutate(group.id);
                              }
                            }}
                            className="p-1 hover:bg-muted rounded"
                            title="Delete group"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="border-t p-4 bg-muted/20">
                        {/* Validation Warnings */}
                        {hasIssues && (
                          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                              <div className="text-sm">
                                <p className="font-medium text-destructive">Validation Issues</p>
                                <ul className="mt-1 space-y-1 text-destructive/80">
                                  {validationIssues.map((issue, i) => (
                                    <li key={i}>{issue}</li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Group Name */}
                        <div className="mb-4">
                          <label className="text-sm font-medium mb-2 block">
                            Group Name
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              defaultValue={group.name || ''}
                              placeholder="Enter group name"
                              className="flex-1 px-3 py-1.5 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                              onBlur={(e) => {
                                const newName = e.target.value.trim();
                                if (newName !== (group.name || '')) {
                                  updateGroupMutation.mutate({
                                    groupId: group.id,
                                    updates: { name: newName } // Empty string clears the name
                                  });
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.currentTarget.blur();
                                }
                              }}
                            />
                          </div>
                        </div>

                        {/* Color Selection */}
                        <div className="mb-4">
                          <label className="text-sm font-medium mb-2 block">
                            Group Color
                          </label>
                          <div className="flex gap-2 flex-wrap">
                            {GROUP_COLORS.map((color) => (
                              <button
                                key={color}
                                onClick={() => handleColorChange(group.id, color)}
                                className={clsx(
                                  'w-8 h-8 rounded-full transition-all',
                                  group.color === color && 'ring-2 ring-offset-2 ring-foreground scale-110'
                                )}
                                style={{ backgroundColor: color }}
                                title={color}
                              />
                            ))}
                          </div>
                        </div>

                        {/* Members List */}
                        <div>
                          <label className="text-sm font-medium mb-2 block">
                            Members
                          </label>
                          {members.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              No members yet. Add campers using Ctrl+Click.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {members.map((member: ExpandedMember) => {
                                const sessionInfo = getMemberSessionInfo(member);
                                const gender = getMemberGender(member);

                                return (
                                  <div
                                    key={member.id}
                                    className="flex items-center justify-between p-2 bg-background rounded border"
                                  >
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium truncate">
                                        {getMemberDisplayName(member)}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {sessionInfo?.name || 'Unknown session'}
                                        {gender && ` • ${gender}`}
                                      </p>
                                    </div>
                                    <button
                                      onClick={() => removeMemberMutation.mutate(member.id)}
                                      className="p-1 hover:bg-muted rounded flex-shrink-0"
                                      title="Remove from group"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer with summary */}
        {filteredGroups.length > 0 && (
          <div className="p-4 border-t bg-muted/20">
            <p className="text-sm text-muted-foreground text-center">
              {filteredGroups.length} group{filteredGroups.length !== 1 ? 's' : ''} • {filteredMemberCount} camper{filteredMemberCount !== 1 ? 's' : ''} locked
              {selectedArea !== 'all' && groups.length > filteredGroups.length && (
                <span className="block text-xs mt-1 opacity-70">
                  ({groups.length - filteredGroups.length} more in other areas)
                </span>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default LockGroupPanel;
