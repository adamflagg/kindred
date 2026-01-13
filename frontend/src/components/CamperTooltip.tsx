import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import { useAuth } from '../contexts/AuthContext';
import { useYear } from '../hooks/useCurrentYear';
import { getSessionDisplayNameFromString } from '../utils/sessionDisplay';
import { getDisplayAgeForYear } from '../utils/displayAge';
import { formatGradeOrdinal } from '../utils/gradeUtils';
import type { Camper } from '../types/app-types';
import type { BunkRequestsResponse } from '../types/pocketbase-types';

interface CamperTooltipProps {
  camper: Camper;
  isVisible: boolean;
  position: { x: number; y: number };
}

interface CamperHistory {
  year: number;
  sessionName: string;
  sessionType: string;
  bunkName: string;
  startDate: string;
  endDate: string;
}


export default function CamperTooltip({ camper, isVisible, position }: CamperTooltipProps) {
  const currentYear = useYear();
  const { user } = useAuth();

  // Query for age preference social requests
  const { data: agePreferenceRequests = [] } = useQuery<BunkRequestsResponse[]>({
    queryKey: ['bunk_requests_tooltip', camper.person_cm_id, currentYear],
    queryFn: async () => {
      if (!camper.person_cm_id) return [];
      
      const records = await pb.collection<BunkRequestsResponse>('bunk_requests').getFullList({
        filter: `requester_id = ${camper.person_cm_id} && request_type = 'age_preference' && year = ${currentYear}`
      });
      
      return records;
    },
    enabled: !!user && isVisible && !!camper.person_cm_id,
  });

  // Fetch camper history from bunk_assignments table
  const { data: history = [] } = useQuery<CamperHistory[]>({
    queryKey: ['camper-history', camper.person_cm_id, currentYear],
    queryFn: async () => {
      if (!camper.person_cm_id) return [];

      try {
        // Parse ID to ensure it's a number
        const personCmId = parseInt(camper.person_cm_id.toString(), 10);
        if (isNaN(personCmId)) return [];

        // Fetch from bunk_assignments with expanded relations
        const filter = `person.cm_id = ${personCmId} && year < ${currentYear}`;
        const assignments = await pb.collection('bunk_assignments').getFullList({
          filter,
          expand: 'person,session,bunk',
          sort: '-year'
        });

        // Filter to only include standard camp session types
        const allowedTypes = ['main', 'ag', 'embedded', 'taste'];

        // Type for expanded assignment records
        interface ExpandedAssignment {
          session?: { session_type?: string; name?: string; start_date?: string; end_date?: string };
          bunk?: { name?: string };
        }

        const allHistory = assignments
          .filter((record) => {
            const expanded = record.expand as ExpandedAssignment | undefined;
            const sessionType = expanded?.session?.session_type;
            return sessionType && allowedTypes.includes(sessionType);
          })
          .map((record) => {
            const expanded = record.expand as ExpandedAssignment | undefined;
            return {
              year: record.year,
              sessionName: expanded?.session?.name ?? '',
              sessionType: expanded?.session?.session_type ?? '',
              bunkName: expanded?.bunk?.name ?? 'Unassigned',
              startDate: expanded?.session?.start_date ?? '',
              endDate: expanded?.session?.end_date ?? ''
            };
          });

        // Filter out unassigned bunks and limit to 3 most recent years
        return allHistory
          .filter(record => record.bunkName !== 'Unassigned')
          .slice(0, 3);
      } catch (error) {
        console.error('Error fetching camper history:', error);
        return [];
      }
    },
    enabled: !!user && isVisible && !!camper.person_cm_id,
    gcTime: 10 * 60 * 1000, // 10 minutes
  });


  // Calculate tooltip position to avoid going off-screen
  // Using useMemo instead of useState+useEffect to avoid cascading renders
  const tooltipPosition = useMemo(() => {
    if (!isVisible || position.x <= 0 || position.y <= 0) {
      return { top: 0, left: 0 };
    }

    const tooltipWidth = 320; // Approximate width
    const tooltipHeight = 300; // Approximate height (increased for 3 years of history)
    const padding = 10;

    // Start with the position relative to viewport
    let left = position.x;
    let top = position.y;

    // Adjust if tooltip would go off right edge
    if (left + tooltipWidth > window.innerWidth) {
      left = position.x - tooltipWidth - padding;
    }

    // Adjust if tooltip would go off bottom edge
    if (top + tooltipHeight > window.innerHeight) {
      // Position above the element instead
      top = Math.max(padding, position.y - tooltipHeight - padding);
    }

    // Ensure tooltip stays within viewport bounds
    left = Math.max(padding, Math.min(left, window.innerWidth - tooltipWidth - padding));
    top = Math.max(padding, Math.min(top, window.innerHeight - tooltipHeight - padding));

    return { top, left };
  }, [position.x, position.y, isVisible]);

  if (!isVisible) return null;

  return createPortal(
    <div
      className="fixed z-[100] bg-popover rounded-lg shadow-lg border p-4 w-80 pointer-events-none"
      style={{
        top: `${tooltipPosition.top}px`,
        left: `${tooltipPosition.left}px`,
      }}
    >
      {/* Camper Info Header */}
      <div className="mb-3 pb-3 border-b">
        <h3 className="font-semibold text-lg">{camper.name}</h3>
        <p className="text-sm text-muted-foreground">
          Age {(getDisplayAgeForYear(camper, currentYear) ?? 0).toFixed(2)} • {formatGradeOrdinal(camper.grade)} • {camper.gender}
        </p>
      </div>

      {/* Historical Assignments */}
      <div className="mb-3">
        <h4 className="font-medium text-sm text-muted-foreground mb-2">Previous Years</h4>
        {history.length > 0 ? (
          <div className="space-y-1">
            {history.map((record, index) => (
              <div key={`${record.year}-${record.sessionName}-${index}`} className="text-sm">
                <span className="font-medium">{record.year}:</span>{' '}
                <span className="text-muted-foreground">
                  {getSessionDisplayNameFromString(record.sessionName, record.sessionType)} - {record.bunkName}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">No previous camp history</p>
        )}
      </div>

      {/* Bunking Preferences */}
      {agePreferenceRequests.length > 0 && (
        <div className="mb-3">
          <h4 className="font-medium text-sm text-muted-foreground mb-2">Bunking Preferences</h4>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {agePreferenceRequests[0]?.original_text || 'No preference specified'}
            </p>
            {agePreferenceRequests[0]?.parse_notes && (
              <div className="text-sm italic text-muted-foreground">
                "{agePreferenceRequests[0]?.parse_notes}"
              </div>
            )}
          </div>
        </div>
      )}

    </div>,
    document.body
  );
}