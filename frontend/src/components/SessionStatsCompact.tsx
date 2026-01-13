import { Users, Home, TrendingUp, AlertCircle } from 'lucide-react';
import type { Bunk, Camper } from '../types/app-types';

type AreaFilter = 'all' | 'boys' | 'girls' | 'all-gender';

interface SessionStatsCompactProps {
  bunks: Bunk[];
  campers: Camper[];
  defaultCapacity?: number;
  selectedArea?: AreaFilter;
  agSessionCmIds?: number[];  // CampMinder IDs of AG sessions for this parent
}

export default function SessionStatsCompact({
  bunks,
  campers,
  defaultCapacity = 12,
  selectedArea = 'all',
  agSessionCmIds = [],
}: SessionStatsCompactProps) {
  const agSessionIdSet = new Set(agSessionCmIds);

  // Filter bunks based on selected area (for capacity/bunk count)
  const filteredBunks = bunks.filter(bunk => {
    if (selectedArea === 'all') return true;
    const bunkGender = bunk.gender?.toLowerCase();
    if (selectedArea === 'boys') return bunkGender === 'm' || bunkGender === 'boys';
    if (selectedArea === 'girls') return bunkGender === 'f' || bunkGender === 'girls';
    if (selectedArea === 'all-gender') return bunkGender === 'ag' || bunkGender === 'all-gender' || bunkGender === 'nb' || bunkGender === 'mixed';
    return true;
  });

  // Get IDs of filtered bunks for determining assigned status
  const filteredBunkIds = new Set(filteredBunks.map(b => b.id));

  // Filter campers by their SEX and session enrollment, NOT by bunk type
  // This ensures unassigned campers are counted correctly
  const filteredCampers = campers.filter(camper => {
    if (selectedArea === 'all') return true;

    if (selectedArea === 'all-gender') {
      // AG campers are those enrolled in an AG session
      return agSessionIdSet.has(camper.session_cm_id);
    }

    // For boys/girls, filter by sex (M/F) and exclude AG session campers
    const isAgCamper = agSessionIdSet.has(camper.session_cm_id);
    if (isAgCamper) return false;  // AG campers only show in AG area

    if (selectedArea === 'boys') return camper.gender === 'M';
    if (selectedArea === 'girls') return camper.gender === 'F';

    return true;
  });

  // Count assigned campers (those with a bunk assignment in filtered bunks)
  const assignedCampers = filteredCampers.filter(c => c.assigned_bunk && filteredBunkIds.has(c.assigned_bunk));

  // Count unassigned campers for this area
  const unassignedCampers = filteredCampers.filter(c => !c.assigned_bunk);

  // Calculate sex breakdown for filtered campers (using biological sex M/F only)
  const sexBreakdown = filteredCampers.reduce((acc, camper) => {
    if (camper.gender === 'M') acc.boys++;
    else if (camper.gender === 'F') acc.girls++;
    return acc;
  }, { boys: 0, girls: 0 });

  // Calculate capacity: bunk count × default capacity (from config)
  // No overage logic - always use the standard capacity
  const totalCapacity = filteredBunks.length * defaultCapacity;

  const utilization = totalCapacity > 0 ? (assignedCampers.length / totalCapacity) * 100 : 0;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      {/* Total Campers */}
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" />
        <span className="font-semibold">{filteredCampers.length}</span>
        <span className="text-muted-foreground">campers</span>
        <span className="text-muted-foreground">({assignedCampers.length} assigned)</span>
      </div>

      <span className="text-border hidden sm:inline">|</span>

      {/* Sex Breakdown with silhouette icons */}
      <div className="flex items-center gap-3">
        {/* Male silhouette */}
        <div className="flex items-center gap-1">
          <svg className="h-4 w-4 text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="4" r="3" />
            <path d="M12 8c-2.5 0-4 1.5-4 3v5h2v6h4v-6h2v-5c0-1.5-1.5-3-4-3z" />
          </svg>
          <span className="font-semibold tabular-nums">{sexBreakdown.boys}</span>
        </div>
        {/* Female silhouette */}
        <div className="flex items-center gap-1">
          <svg className="h-4 w-4 text-pink-600 dark:text-pink-400" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="4" r="3" />
            <path d="M12 8c-3 0-5 1.5-5 3l2 7h2v4h2v-4h2l2-7c0-1.5-2-3-5-3z" />
          </svg>
          <span className="font-semibold tabular-nums">{sexBreakdown.girls}</span>
        </div>
      </div>

      <span className="text-border hidden sm:inline">|</span>

      {/* Bunks */}
      <div className="flex items-center gap-2">
        <Home className="h-4 w-4 text-primary" />
        <span className="font-semibold">{filteredBunks.length}</span>
        <span className="text-muted-foreground">bunks</span>
      </div>

      <span className="text-border hidden sm:inline">|</span>

      {/* Beds Filled */}
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-accent-foreground" />
        <span className="font-semibold">{utilization.toFixed(1)}%</span>
        <span className="text-muted-foreground">beds filled</span>
      </div>

      {/* Unassigned - highlighted if > 0 */}
      {unassignedCampers.length > 0 && (
        <>
          <span className="text-border hidden sm:inline">|</span>
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <AlertCircle className="h-4 w-4" />
            <span className="font-semibold">{unassignedCampers.length}</span>
            <span>unassigned</span>
          </div>
        </>
      )}
    </div>
  );
}
