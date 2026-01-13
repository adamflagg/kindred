import { useState, useMemo } from 'react';
import { Users, ChevronUp } from 'lucide-react';
import clsx from 'clsx';
import type { LockedGroupsResponse, LockedGroupMembersResponse, AttendeesResponse } from '../types/pocketbase-types';
import type { Camper } from '../types/app-types';

// Type for members with expanded attendee (matching LockGroupContext)
type ExpandedMember = LockedGroupMembersResponse & {
  expand?: {
    attendee?: AttendeesResponse & {
      expand?: {
        person?: {
          id: string;
          cm_id: number;
        };
      };
    };
  };
};

type BunkArea = 'all' | 'boys' | 'girls' | 'all-gender';

interface LockGroupsHubProps {
  groups: LockedGroupsResponse[];
  membersByGroup: Record<string, ExpandedMember[]>;
  pendingCampers: Camper[];
  selectedArea: BunkArea;
  campers: Camper[]; // All campers - used for looking up gender/session data
  onOpenPanel: () => void;
  isDraftMode: boolean;
}

// Helper to check if a camper matches a specific area (same logic as unassigned filtering)
function camperMatchesArea(camper: Camper, area: BunkArea): boolean {
  if (area === 'all') return true;

  const isFromAGSession = camper.expand?.session?.session_type === 'ag';

  if (area === 'all-gender') {
    // AG area: only campers from AG sessions
    return isFromAGSession;
  }

  // Boys/Girls areas: campers must NOT be from AG sessions
  if (isFromAGSession) return false;

  if (area === 'boys') return camper.gender === 'M';
  if (area === 'girls') return camper.gender === 'F';

  return true;
}

export default function LockGroupsHub({
  groups,
  membersByGroup,
  pendingCampers,
  selectedArea,
  campers,
  onOpenPanel,
  isDraftMode
}: LockGroupsHubProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  // Build a map of person CM ID -> Camper for quick lookups
  const camperByPersonCmId = useMemo(() => {
    const map = new Map<number, Camper>();
    for (const camper of campers) {
      map.set(camper.person_cm_id, camper);
    }
    return map;
  }, [campers]);

  // Filter groups by selected area - ALL members must match
  const filteredGroups = useMemo(() => {
    if (selectedArea === 'all') return groups;

    return groups.filter(group => {
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
  }, [groups, membersByGroup, selectedArea, camperByPersonCmId]);

  // Filter pending campers by selected area
  const filteredPendingCampers = useMemo(() => {
    if (selectedArea === 'all') return pendingCampers;
    return pendingCampers.filter(camper => camperMatchesArea(camper, selectedArea));
  }, [pendingCampers, selectedArea]);

  if (!isDraftMode) return null;

  const hasGroups = filteredGroups.length > 0;
  const hasPending = filteredPendingCampers.length > 0;
  const pendingCount = filteredPendingCampers.length;
  // When action bar is visible (pending > 0), shift up to avoid overlap
  const actionBarHeight = hasPending ? 'bottom-16' : 'bottom-4';

  return (
    <div className={clsx('fixed left-4 z-40 transition-all duration-200', actionBarHeight)}>
      {/* Main Hub Button */}
      <button
        onClick={() => {
          if (hasGroups || hasPending) {
            onOpenPanel();
          }
        }}
        onMouseEnter={() => !hasGroups && !hasPending && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={clsx(
          'flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lodge-lg transition-all',
          'hover:shadow-lodge-xl hover:scale-[1.02] active:scale-[0.98]',
          hasGroups || hasPending
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted/80 backdrop-blur-sm text-muted-foreground hover:bg-muted border border-border'
        )}
      >
        <Users className="h-4 w-4" />
        <span className="font-medium">
          {hasGroups ? (
            <>
              {filteredGroups.length} Friend Group{filteredGroups.length !== 1 ? 's' : ''}
              {hasPending && <span className="text-accent"> +{pendingCount}</span>}
            </>
          ) : hasPending ? (
            <>{pendingCount} Selected</>
          ) : (
            'Friend Groups'
          )}
        </span>
        {(hasGroups || hasPending) && (
          <ChevronUp className="h-3 w-3 opacity-60" />
        )}
      </button>

      {/* Empty State Tooltip - simple tip, no unclickable button */}
      {!hasGroups && !hasPending && showTooltip && (
        <div
          className="absolute left-0 bottom-full mb-2 w-64 p-3 card-lodge shadow-lodge-lg text-sm animate-fade-in"
        >
          <p className="text-muted-foreground">
            <strong className="text-foreground">Ctrl+Click</strong> campers to select,
            then create a friend group to keep them together.
          </p>
        </div>
      )}
    </div>
  );
}
