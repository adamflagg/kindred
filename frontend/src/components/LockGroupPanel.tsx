import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Trash2, Users, ChevronRight, AlertTriangle, Plus } from 'lucide-react'
import clsx from 'clsx'
import { pb } from '../lib/pocketbase'
import { useYear } from '../hooks/useCurrentYear'
import { useLockGroupContext } from '../contexts/LockGroupContext'
import { getDisplayAgeForYear } from '../utils/displayAge'
import type {
  LockedGroupsResponse,
  LockedGroupMembersResponse,
  AttendeesResponse,
} from '../types/pocketbase-types'

import type { Camper } from '../types/app-types'
import { isAgSession } from '../utils/sessionTypePredicates'

type BunkArea = 'all' | 'boys' | 'girls' | 'all-gender'

interface LockGroupPanelProps {
  isOpen?: boolean
  onClose?: () => void
  sessionPbId?: string
  scenarioId?: string
  selectedGroupId?: string | null
  onGroupSelect?: (groupId: string | null) => void
  requestClose?: boolean // When true, triggers animated close
  selectedArea?: BunkArea
  campers?: Camper[] // All campers - used for area filtering
  sessionCampers?: Camper[] // All session campers - used for Add Member picker
}

// Type for members with expanded attendee and person
type ExpandedMember = LockedGroupMembersResponse & {
  expand?: {
    attendee?: AttendeesResponse & {
      expand?: {
        person?: {
          id: string
          cm_id: number
          first_name?: string
          last_name?: string
          preferred_name?: string
        }
        session?: {
          id: string
          cm_id: number
          name: string
          session_type: string
        }
      }
    }
  }
}

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
]

// Helper to check if a camper matches a specific area (same logic as unassigned filtering)
function camperMatchesArea(camper: Camper, area: BunkArea): boolean {
  if (area === 'all') return true

  const isFromAGSession = camper.expand?.session ? isAgSession(camper.expand.session) : false

  if (area === 'all-gender') {
    return isFromAGSession
  }

  if (isFromAGSession) return false

  if (area === 'boys') return camper.gender === 'M'
  return camper.gender === 'F'
}

interface AddMemberPickerProps {
  groupId: string
  sessionCampers: Camper[]
  getCamperLockGroup: (cmId: number) => unknown
  addCamperToGroup: (camper: Camper, groupId: string) => Promise<void>
}

function AddMemberPicker({
  groupId,
  sessionCampers,
  getCamperLockGroup,
  addCamperToGroup,
}: AddMemberPickerProps) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)

  const eligible = useMemo(
    () =>
      sessionCampers.filter(
        (c) =>
          !getCamperLockGroup(c.person_cm_id) &&
          (c.name ?? '').toLowerCase().includes(filter.toLowerCase())
      ),
    [sessionCampers, getCamperLockGroup, filter]
  )

  // Recompute position when opening
  useEffect(() => {
    if (!open) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      setDropdownPos({ top: rect.bottom + 4, left: rect.left })
    }
  }, [open])

  // Outside-click dismissal
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || dropdownRef.current?.contains(target)) {
        return
      }
      setOpen(false)
      setFilter('')
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleSelect = (camper: Camper) => {
    void addCamperToGroup(camper, groupId)
    setOpen(false)
    setFilter('')
  }

  return (
    <div className="relative mt-3">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
        aria-label="Add member"
      >
        <Plus className="h-3.5 w-3.5" />
        Add member
      </button>

      {open &&
        dropdownPos !== null &&
        createPortal(
          <div
            ref={dropdownRef}
            className="bg-background fixed z-50 min-w-[220px] rounded-lg border shadow-lg"
            style={{ top: dropdownPos.top, left: dropdownPos.left }}
          >
            <input
              autoFocus
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter campers…"
              className="w-full rounded-t-lg border-b px-3 py-2 text-sm outline-none"
            />
            <div className="max-h-48 overflow-y-auto">
              {eligible.length === 0 ? (
                <p className="text-muted-foreground px-3 py-2 text-sm">
                  All session campers are already in a group.
                </p>
              ) : (
                eligible.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleSelect(c)}
                    className="hover:bg-muted w-full px-3 py-1.5 text-left text-sm"
                  >
                    {c.name}
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}

function LockGroupPanel({
  isOpen = false,
  onClose = () => {},
  sessionPbId = '',
  scenarioId = '',
  selectedGroupId,
  onGroupSelect,
  requestClose = false,
  selectedArea = 'all',
  campers = [],
  sessionCampers = [],
}: LockGroupPanelProps) {
  const queryClient = useQueryClient()
  const currentYear = useYear()
  const { isActionBarVisible, getCamperLockGroup, addCamperToGroup } = useLockGroupContext()

  // Track expanded group - derive from prop or allow local overrides
  const [localExpandedGroupId, setLocalExpandedGroupId] = useState<string | null>(null)
  // Derive effective expanded group: use selectedGroupId if provided, otherwise use local state
  const expandedGroupId = selectedGroupId ?? localExpandedGroupId
  const setExpandedGroupId = setLocalExpandedGroupId

  const [isClosing, setIsClosing] = useState(false)
  // Track previous requestClose value for render-time comparison
  const [prevRequestClose, setPrevRequestClose] = useState(requestClose)

  // Handle close with animation - called directly from event handlers, not effects
  const handleClose = useCallback(() => {
    setIsClosing(true)
    setTimeout(() => {
      setIsClosing(false)
      onClose()
    }, 280) // Slightly less than animation duration
  }, [onClose])

  // Handle external close request during render (React pattern for responding to prop changes)
  if (requestClose && !prevRequestClose && isOpen && !isClosing) {
    setPrevRequestClose(requestClose)
    // Schedule the close animation (setTimeout is fine during render for one-time effects)
    setTimeout(() => handleClose(), 0)
  } else if (requestClose !== prevRequestClose) {
    setPrevRequestClose(requestClose)
  }

  // Fetch lock groups for the scenario, session, and year
  const { data: groups = [], isLoading: groupsLoading } = useQuery({
    queryKey: ['locked-groups-panel', scenarioId, sessionPbId, currentYear],
    queryFn: async () => {
      const result = await pb.collection('locked_groups').getList<LockedGroupsResponse>(1, 500, {
        filter: pb.filter('scenario = {:scenario} && session = {:session} && year = {:year}', {
          scenario: scenarioId,
          session: sessionPbId,
          year: currentYear,
        }),
        sort: 'created',
      })
      return result.items
    },
    enabled: isOpen && !!sessionPbId && !!scenarioId,
  })

  // Fetch all group members with expanded attendee -> person and session
  const { data: allMembers = [], isLoading: membersLoading } = useQuery({
    queryKey: ['locked-group-members-panel', scenarioId, sessionPbId, groups.length],
    queryFn: async () => {
      if (groups.length === 0) return []

      const groupIds = groups.map((g: LockedGroupsResponse) => g.id)
      // Build OR filter for each group ID
      const filterParts = groupIds.map((_, i) => `group = {:g${i}}`)
      const filterParams = groupIds.reduce((acc, id, i) => ({ ...acc, [`g${i}`]: id }), {})
      const filter = pb.filter(filterParts.join(' || '), filterParams)

      const result = await pb.collection('locked_group_members').getList<ExpandedMember>(1, 500, {
        filter,
        expand: 'attendee,attendee.person,attendee.session',
      })
      return result.items
    },
    enabled: isOpen && groups.length > 0,
  })

  // Group members by group ID
  const membersByGroup = allMembers.reduce<Record<string, ExpandedMember[]>>(
    (acc: Record<string, ExpandedMember[]>, member: ExpandedMember) => {
      const groupId = member.group
      acc[groupId] ??= []
      acc[groupId].push(member)
      return acc
    },
    {}
  )

  // Helper to get age from member (year-aware for historical viewing)
  const getMemberAge = useCallback(
    (member: ExpandedMember): number | null => {
      const person = member.expand?.attendee?.expand?.person
      if (!person) return null
      // Cast to include age/birthdate for getDisplayAgeForYear
      const personWithAge = person as { age?: number; birthdate?: string }
      return getDisplayAgeForYear(personWithAge, currentYear)
    },
    [currentYear]
  )

  // Calculate average age for a group's members
  const getGroupAverageAge = useCallback(
    (members: ExpandedMember[]): number | null => {
      const ages = members.map((m) => getMemberAge(m)).filter((age): age is number => age !== null)
      if (ages.length === 0) return null
      return ages.reduce((sum, age) => sum + age, 0) / ages.length
    },
    [getMemberAge]
  )

  // Sort groups by average age of members (ascending)
  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => {
      const avgA = getGroupAverageAge(membersByGroup[a.id] ?? []) ?? Infinity
      const avgB = getGroupAverageAge(membersByGroup[b.id] ?? []) ?? Infinity
      return avgA - avgB
    })
  }, [groups, membersByGroup, getGroupAverageAge])

  // Build a map of person CM ID -> Camper for quick lookups
  const camperByPersonCmId = useMemo(() => {
    const map = new Map<number, Camper>()
    for (const camper of campers) {
      map.set(camper.person_cm_id, camper)
    }
    return map
  }, [campers])

  // Filter groups by selected area (ALL members must match the area)
  const filteredGroups = useMemo(() => {
    if (selectedArea === 'all') return sortedGroups

    return sortedGroups.filter((group) => {
      const members = membersByGroup[group.id] ?? []
      if (members.length === 0) return true // Empty groups show everywhere

      // Get the person CM IDs for this group's members
      const memberPersonCmIds = members
        .map((m) => m.expand?.attendee?.person_id)
        .filter((id): id is number => id !== undefined)

      // ALL members must match the selected area
      return memberPersonCmIds.every((personCmId) => {
        const camper = camperByPersonCmId.get(personCmId)
        if (!camper) return false // If we can't find the camper, exclude from this area
        return camperMatchesArea(camper, selectedArea)
      })
    })
  }, [sortedGroups, membersByGroup, selectedArea, camperByPersonCmId])

  // Calculate filtered member count for footer
  const filteredMemberCount = useMemo(() => {
    return filteredGroups.reduce((sum, group) => {
      return sum + (membersByGroup[group.id]?.length ?? 0)
    }, 0)
  }, [filteredGroups, membersByGroup])

  // Update group color mutation
  const updateGroupMutation = useMutation({
    mutationFn: async ({
      groupId,
      updates,
    }: {
      groupId: string
      updates: Partial<LockedGroupsResponse>
    }) => {
      return await pb.collection('locked_groups').update(groupId, updates)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['locked-groups', scenarioId, sessionPbId, currentYear],
      })
      void queryClient.invalidateQueries({
        queryKey: ['locked-groups-panel', scenarioId, sessionPbId, currentYear],
      })
    },
  })

  // Delete group mutation
  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      // Delete all members first
      const members = membersByGroup[groupId] ?? []
      for (const member of members) {
        await pb.collection('locked_group_members').delete(member.id)
      }

      // Then delete the group
      return await pb.collection('locked_groups').delete(groupId)
    },
    onSuccess: (_data, deletedGroupId) => {
      void queryClient.invalidateQueries({
        queryKey: ['locked-groups', scenarioId, sessionPbId, currentYear],
      })
      void queryClient.invalidateQueries({
        queryKey: ['locked-groups-panel', scenarioId, sessionPbId, currentYear],
      })
      void queryClient.invalidateQueries({
        queryKey: ['locked-group-members', scenarioId, sessionPbId],
      })
      void queryClient.invalidateQueries({
        queryKey: ['locked-group-members-panel', scenarioId, sessionPbId],
      })
      if (deletedGroupId === selectedGroupId) {
        onGroupSelect?.(null)
      }
    },
  })

  // Remove member from group mutation
  const removeMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      return await pb.collection('locked_group_members').delete(memberId)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['locked-group-members', scenarioId, sessionPbId],
      })
      void queryClient.invalidateQueries({
        queryKey: ['locked-group-members-panel', scenarioId, sessionPbId],
      })
    },
  })

  const handleColorChange = (groupId: string, color: string) => {
    updateGroupMutation.mutate({
      groupId,
      updates: { color },
    })
  }

  // Get display name for a member
  const getMemberDisplayName = (member: ExpandedMember): string => {
    const person = member.expand?.attendee?.expand?.person
    if (person) {
      const firstName = person.preferred_name ?? person.first_name ?? ''
      const lastName = person.last_name ?? ''
      return `${firstName} ${lastName}`.trim() || `Camper ${person.cm_id}`
    }
    return `Attendee ${member.attendee}`
  }

  // Get session info for a member (for cross-session detection)
  const getMemberSessionInfo = (
    member: ExpandedMember
  ): { name: string; type: string; id: string } | null => {
    const session = member.expand?.attendee?.expand?.session
    if (session) {
      return {
        name: session.name,
        type: session.session_type,
        id: session.id,
      }
    }
    return null
  }

  // Get gender for a member (for cross-gender detection)
  const getMemberGender = (member: ExpandedMember): string | null => {
    // Gender is on the attendee, not the person
    const attendee = member.expand?.attendee
    if (attendee && 'gender' in attendee) {
      return (attendee as { gender?: string }).gender ?? null
    }
    return null
  }

  // Detect validation issues in a group
  const getGroupValidationIssues = (members: ExpandedMember[]): string[] => {
    const issues: string[] = []

    if (members.length < 2) return issues

    // Check for cross-session issues
    const sessions = new Map<string, string>()
    let hasAGSession = false

    for (const member of members) {
      const sessionInfo = getMemberSessionInfo(member)
      if (sessionInfo) {
        sessions.set(sessionInfo.id, sessionInfo.name)
        if (sessionInfo.type === 'ag') {
          hasAGSession = true
        }
      }
    }

    if (sessions.size > 1) {
      const sessionNames = Array.from(sessions.values())
      issues.push(`Cross-session: ${sessionNames.join(', ')}`)
    }

    // Check for cross-gender issues (only for non-AG sessions)
    if (!hasAGSession) {
      const genders = new Set<string>()
      for (const member of members) {
        const gender = getMemberGender(member)
        if (gender) {
          genders.add(gender)
        }
      }

      if (genders.size > 1 && !genders.has('NB')) {
        // Has both M and F without being in an AG session
        issues.push('Cross-gender: cannot bunk M and F campers together')
      }
    }

    return issues
  }

  const isLoading = groupsLoading || membersLoading

  if (!isOpen) return null

  return (
    <div
      data-panel="lock-group"
      className={clsx(
        'bg-background fixed top-0 left-0 z-50 w-96 border-r shadow-xl',
        isClosing ? 'animate-slide-out-left' : 'animate-slide-in-left',
        isActionBarVisible ? 'bottom-20' : 'bottom-0'
      )}
    >
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Friend Groups</h2>
            <p className="text-muted-foreground text-sm">
              Keep campers together during assignments
            </p>
          </div>
          <button onClick={handleClose} className="hover:bg-muted rounded-md p-2 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="text-muted-foreground p-6 text-center">Loading groups...</div>
          ) : groups.length === 0 ? (
            <div className="p-6 text-center">
              <Users className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
              <p className="text-muted-foreground mb-4">No friend groups yet</p>
              <p className="text-muted-foreground text-sm">
                Ctrl+Click campers to select them, then click "Create Group" to keep them together.
              </p>
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="p-6 text-center">
              <Users className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
              <p className="text-muted-foreground mb-4">No friend groups in this area</p>
              <p className="text-muted-foreground text-sm">
                {groups.length} group{groups.length !== 1 ? 's' : ''} exist in other areas.
              </p>
            </div>
          ) : (
            <div className="space-y-4 p-4">
              {filteredGroups.map((group: LockedGroupsResponse) => {
                const members = membersByGroup[group.id] ?? []
                const isExpanded = expandedGroupId === group.id
                const validationIssues = getGroupValidationIssues(members)
                const hasIssues = validationIssues.length > 0

                return (
                  <div
                    key={group.id}
                    className={clsx(
                      'overflow-hidden rounded-lg border transition-all',
                      isExpanded && 'ring-primary ring-2',
                      hasIssues && 'border-destructive'
                    )}
                  >
                    {/* Group Header */}
                    <div
                      data-group-id={group.id}
                      className="hover:bg-muted/50 cursor-pointer border-l-4 p-4 transition-colors"
                      style={{
                        borderLeftColor: group.color,
                        ...(selectedGroupId === group.id && {
                          backgroundColor: `${group.color}1a`,
                        }),
                      }}
                      onClick={() => {
                        setExpandedGroupId(isExpanded ? null : group.id)
                        onGroupSelect?.(isExpanded ? null : group.id)
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
                          <span className="font-medium">{group.name || 'Unnamed Group'}</span>
                          <span className="text-muted-foreground text-sm">
                            • {members.length} camper
                            {members.length !== 1 ? 's' : ''}
                          </span>
                          {hasIssues && <AlertTriangle className="text-destructive h-4 w-4" />}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              const displayName = group.name || 'this group'
                              if (
                                confirm(
                                  `Delete "${displayName}"? This will remove all ${members.length} campers from the group.`
                                )
                              ) {
                                deleteGroupMutation.mutate(group.id)
                              }
                            }}
                            className="hover:bg-muted rounded p-1"
                            title="Delete group"
                            aria-label="Delete group"
                          >
                            <Trash2 className="text-destructive h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="bg-muted/20 border-t p-4">
                        {/* Validation Warnings */}
                        {hasIssues && (
                          <div className="bg-destructive/10 border-destructive/20 mb-4 rounded-md border p-3">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="text-destructive mt-0.5 h-4 w-4 flex-shrink-0" />
                              <div className="text-sm">
                                <p className="text-destructive font-medium">Validation Issues</p>
                                <ul className="text-destructive/80 mt-1 space-y-1">
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
                          <label className="mb-2 block text-sm font-medium">Group Name</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              defaultValue={group.name || ''}
                              placeholder="Enter group name"
                              className="bg-background focus:ring-primary/50 flex-1 rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:outline-none"
                              onBlur={(e) => {
                                const newName = e.target.value.trim()
                                if (newName !== (group.name || '')) {
                                  updateGroupMutation.mutate({
                                    groupId: group.id,
                                    updates: { name: newName }, // Empty string clears the name
                                  })
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.currentTarget.blur()
                                }
                              }}
                            />
                          </div>
                        </div>

                        {/* Color Selection */}
                        <div className="mb-4">
                          <label className="mb-2 block text-sm font-medium">Group Color</label>
                          <div className="flex flex-wrap gap-2">
                            {GROUP_COLORS.map((color) => (
                              <button
                                key={color}
                                onClick={() => handleColorChange(group.id, color)}
                                className={clsx(
                                  'h-8 w-8 rounded-full transition-all',
                                  group.color === color &&
                                    'ring-foreground scale-110 ring-2 ring-offset-2'
                                )}
                                style={{ backgroundColor: color }}
                                title={color}
                              />
                            ))}
                          </div>
                        </div>

                        {/* Members List */}
                        <div>
                          <label className="mb-2 block text-sm font-medium">Members</label>
                          {members.length === 0 ? (
                            <p className="text-muted-foreground text-sm">
                              No members yet. Add campers using Ctrl+Click.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {members.map((member: ExpandedMember) => {
                                const sessionInfo = getMemberSessionInfo(member)
                                const gender = getMemberGender(member)

                                return (
                                  <div
                                    key={member.id}
                                    className="bg-background flex items-center justify-between rounded border p-2"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium">
                                        {getMemberDisplayName(member)}
                                      </p>
                                      <p className="text-muted-foreground text-xs">
                                        {sessionInfo?.name ?? 'Unknown session'}
                                        {gender && ` • ${gender}`}
                                      </p>
                                    </div>
                                    <button
                                      onClick={() => removeMemberMutation.mutate(member.id)}
                                      className="hover:bg-muted flex-shrink-0 rounded p-1"
                                      title="Remove from group"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>

                        {/* Add Member Picker */}
                        <AddMemberPicker
                          groupId={group.id}
                          sessionCampers={sessionCampers}
                          getCamperLockGroup={getCamperLockGroup}
                          addCamperToGroup={addCamperToGroup}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer with summary */}
        {filteredGroups.length > 0 && (
          <div className="bg-muted/20 border-t p-4">
            <p className="text-muted-foreground text-center text-sm">
              {filteredGroups.length} group
              {filteredGroups.length !== 1 ? 's' : ''} • {filteredMemberCount} camper
              {filteredMemberCount !== 1 ? 's' : ''} locked
              {selectedArea !== 'all' && groups.length > filteredGroups.length && (
                <span className="mt-1 block text-xs opacity-70">
                  ({groups.length - filteredGroups.length} more in other areas)
                </span>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default LockGroupPanel
