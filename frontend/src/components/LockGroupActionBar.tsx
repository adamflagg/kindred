import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, AlertTriangle, Heart } from 'lucide-react';
import clsx from 'clsx';
import { pb, getCurrentUserEmail } from '../lib/pocketbase';
import type { Camper } from '../types/app-types';
import { useLockGroupContext } from '../contexts/LockGroupContext';

interface LockGroupActionBarProps {
  pendingCampers: Camper[];
  sessionPbId: string;
  scenarioId: string;
  year: number;
  onClearPending: () => void;
  onGroupCreated: (groupId: string) => void;
}

// Validation result type
interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
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
];

/**
 * Generate a default group name from the two shortest last names.
 * Example: ["Richardson", "Lee", "Smith"] -> "Lee, Smith"
 */
function generateDefaultGroupName(campers: Camper[]): string {
  const lastNames = campers
    .map(c => c.last_name)
    .filter((name): name is string => !!name && name.length > 0);

  if (lastNames.length === 0) return '';
  if (lastNames.length === 1) return lastNames[0] ?? '';

  // Sort by length, take shortest two
  const sorted = [...lastNames].sort((a, b) => a.length - b.length);
  const shortest = sorted.slice(0, 2);

  // Sort alphabetically for consistent display
  shortest.sort((a, b) => a.localeCompare(b));

  return shortest.join(', ');
}

/**
 * Validates that campers can be grouped together.
 * Rules:
 * 1. Cross-session: All campers must be from the same session
 *    - Exception: AG campers can only be grouped with other AG campers from the same parent session
 * 2. Cross-gender: For non-AG sessions, campers must be the same gender (M or F)
 *    - AG sessions allow mixed genders
 */
function validateFriendGroup(campers: Camper[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (campers.length < 2) {
    return { isValid: true, errors, warnings };
  }

  // Check for session consistency
  const sessions = new Map<number, { name: string; type: string; count: number }>();
  let hasAGSession = false;

  for (const camper of campers) {
    const sessionCmId = camper.session_cm_id;
    const sessionType = camper.expand?.session?.session_type || 'main';
    const sessionName = camper.expand?.session?.name || `Session ${sessionCmId}`;

    if (sessionType === 'ag') {
      hasAGSession = true;
    }

    const existing = sessions.get(sessionCmId);
    if (existing) {
      existing.count++;
    } else {
      sessions.set(sessionCmId, { name: sessionName, type: sessionType, count: 1 });
    }
  }

  // Cross-session validation
  if (sessions.size > 1) {
    const sessionNames = Array.from(sessions.values()).map(s => s.name);
    errors.push(`Cross-session: ${sessionNames.join(', ')}`);
  }

  // Cross-gender validation (only for non-AG sessions)
  if (!hasAGSession) {
    const genders = new Set<string>();
    for (const camper of campers) {
      if (camper.gender) {
        genders.add(camper.gender);
      }
    }

    // Check if we have both M and F (excluding NB which can go with either)
    const hasM = genders.has('M');
    const hasF = genders.has('F');

    if (hasM && hasF) {
      errors.push('Cross-gender: Cannot group M and F campers together');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

function LockGroupActionBar({
  pendingCampers,
  sessionPbId,
  scenarioId,
  year,
  onClearPending,
  onGroupCreated
}: LockGroupActionBarProps) {
  const queryClient = useQueryClient();
  const { groups } = useLockGroupContext();

  // Auto-select next color based on existing groups count
  const nextColorIndex = groups.length % GROUP_COLORS.length;
  const [selectedColor, setSelectedColor] = useState(GROUP_COLORS[nextColorIndex] || GROUP_COLORS[0]);
  const [groupName, setGroupName] = useState('');

  // Validate pending campers
  const validation = useMemo(() => validateFriendGroup(pendingCampers), [pendingCampers]);

  // Generate default name preview for placeholder
  const defaultName = useMemo(() => generateDefaultGroupName(pendingCampers), [pendingCampers]);

  // Create lock group mutation
  const createGroupMutation = useMutation({
    mutationFn: async () => {
      // Use custom name if provided, otherwise auto-generate from last names
      const trimmedName = groupName.trim();
      const finalName = trimmedName || generateDefaultGroupName(pendingCampers);

      const groupData: Record<string, unknown> = {
        color: selectedColor,
        session: sessionPbId,  // relation to camp_sessions
        scenario: scenarioId,  // relation to saved_scenarios
        year: year,
        created_by: getCurrentUserEmail()
      };
      // Add name (either custom or auto-generated)
      if (finalName) {
        groupData['name'] = finalName;
      }
      const group = await pb.collection('locked_groups').create(groupData);

      // Add all pending campers to the group using relations
      for (const camper of pendingCampers) {
        if (!camper.attendee_id) {
          console.warn(`Camper ${camper.name} missing attendee_id, skipping`);
          continue;
        }
        await pb.collection('locked_group_members').create({
          group: group.id,      // relation to locked_groups
          attendee: camper.attendee_id,  // relation to attendees (PB ID)
          added_by: getCurrentUserEmail()
        });
      }

      return group;
    },
    onSuccess: (group) => {
      queryClient.invalidateQueries({ queryKey: ['locked-groups', scenarioId, sessionPbId, year] });
      queryClient.invalidateQueries({ queryKey: ['locked-groups-panel', scenarioId, sessionPbId, year] });
      queryClient.invalidateQueries({ queryKey: ['locked-group-members', scenarioId, sessionPbId] });
      queryClient.invalidateQueries({ queryKey: ['locked-group-members-panel', scenarioId, sessionPbId] });
      onGroupCreated(group.id);
      onClearPending();
      // Advance to next color and clear name
      const newNextIndex = (groups.length + 1) % GROUP_COLORS.length;
      setSelectedColor(GROUP_COLORS[newNextIndex] || GROUP_COLORS[0]);
      setGroupName('');
    }
  });

  const handleCreateGroup = () => {
    if (pendingCampers.length >= 2) {
      createGroupMutation.mutate();
    }
  };

  // Don't show if no pending campers
  if (pendingCampers.length === 0) {
    return null;
  }

  // Max group size matches standard bunk capacity
  const maxGroupSize = 12;
  const isOverLimit = pendingCampers.length > maxGroupSize;
  const hasValidationErrors = !validation.isValid;
  const canCreate = pendingCampers.length >= 2 && !isOverLimit && !hasValidationErrors && !createGroupMutation.isPending;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-background border-t shadow-lodge-lg z-40">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Selection info */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <span className="font-medium">
                {pendingCampers.length} camper{pendingCampers.length !== 1 ? 's' : ''} selected
              </span>
            </div>
            {pendingCampers.length < 2 && (
              <span className="text-sm text-muted-foreground">
                (select at least 2)
              </span>
            )}
            {isOverLimit && (
              <span className="text-sm text-destructive">
                (max {maxGroupSize})
              </span>
            )}
            {hasValidationErrors && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span>{validation.errors[0]}</span>
              </div>
            )}
          </div>

          {/* Right: Name input, color picker and actions */}
          <div className="flex items-center gap-3">
            {/* Optional group name input - shows auto-generated name as placeholder */}
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder={defaultName || 'Group name'}
              className="px-3 py-1.5 text-sm border rounded-lg bg-background w-44 focus:outline-none focus:ring-2 focus:ring-primary/50"
            />

            <div className="w-px h-6 bg-border" />

            {/* Inline color picker */}
            <div className="flex items-center gap-1.5">
              {GROUP_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setSelectedColor(color)}
                  className={clsx(
                    'w-6 h-6 rounded-full transition-all',
                    selectedColor === color && 'ring-2 ring-offset-2 ring-foreground scale-110'
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>

            <div className="w-px h-6 bg-border" />

            <button
              onClick={onClearPending}
              className="px-3 py-1.5 text-sm border rounded-lg hover:bg-muted transition-colors"
            >
              Clear
            </button>
            <button
              onClick={handleCreateGroup}
              disabled={!canCreate}
              className="inline-flex items-center gap-2 px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Heart className="h-4 w-4" />
              {createGroupMutation.isPending ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LockGroupActionBar;