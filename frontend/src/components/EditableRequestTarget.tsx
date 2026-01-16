import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { ChevronDown, ChevronUp, Search, User, ExternalLink, Quote } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import type { PersonsResponse, AttendeesResponse } from '../types/pocketbase-types';
import { calculateAge } from '../utils/ageCalculator';
import { getDisplayAgeForYear } from '../utils/displayAge';
import clsx from 'clsx';

interface EditableRequestTargetProps {
  requestType: string;
  currentPersonId?: number | null;
  agePreferenceTarget?: string;
  sessionId: number;
  year: number;
  requesterCmId: number;
  onChange: (updates: { requestee_id?: number | null; age_preference_target?: string }) => void;
  disabled?: boolean;
  originalText?: string;
  parseNotes?: string;
  requestedPersonName?: string;
  onViewCamper?: (personCmId: number) => void;
  personMap?: Map<number, PersonsResponse>;
}

interface Camper {
  id: string;
  campminder_person_id: number;
  first_name: string;
  last_name: string;
  preferred_name?: string;
  age: number;
  grade: number;
  gender: string;
  session_cm_id: number;
}

// Helper function to format camper name
function formatCamperName(camper: Camper): string {
  const firstName = camper.first_name;
  const preferredName = camper.preferred_name?.replace(/^["']|["']$/g, '');
  const lastName = camper.last_name;
  
  if (preferredName && preferredName !== firstName) {
    return `${firstName} "${preferredName}" ${lastName}`;
  }
  
  return `${firstName} ${lastName}`;
}

export default function EditableRequestTarget({
  requestType,
  currentPersonId,
  agePreferenceTarget,
  sessionId,
  year,
  requesterCmId,
  onChange,
  disabled,
  originalText: _originalText,
  requestedPersonName,
  onViewCamper,
  personMap
}: EditableRequestTargetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownPosition, setDropdownPosition] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    direction: 'down' | 'up';
  }>({ left: 0, direction: 'down' });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Calculate dropdown position on open - use fixed positioning to escape overflow containers
  useLayoutEffect(() => {
    if (isOpen && triggerRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const dropdownHeight = 400; // Approximate max height of dropdown

      const spaceBelow = viewportHeight - triggerRect.bottom;
      const spaceAbove = triggerRect.top;

      // Open upward if not enough space below and more space above
      if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
        setDropdownPosition({
          bottom: viewportHeight - triggerRect.top + 4,
          left: triggerRect.left,
          direction: 'up',
        });
      } else {
        setDropdownPosition({
          top: triggerRect.bottom + 4,
          left: triggerRect.left,
          direction: 'down',
        });
      }
    }
  }, [isOpen]);

  // Recalculate position on scroll (parent container may scroll)
  useEffect(() => {
    if (!isOpen) return;

    const recalculatePosition = () => {
      if (triggerRef.current) {
        const triggerRect = triggerRef.current.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const dropdownHeight = 400;

        const spaceBelow = viewportHeight - triggerRect.bottom;
        const spaceAbove = triggerRect.top;

        if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
          setDropdownPosition({
            bottom: viewportHeight - triggerRect.top + 4,
            left: triggerRect.left,
            direction: 'up',
          });
        } else {
          setDropdownPosition({
            top: triggerRect.bottom + 4,
            left: triggerRect.left,
            direction: 'down',
          });
        }
      }
    };

    // Listen for scroll on any ancestor
    window.addEventListener('scroll', recalculatePosition, true);
    window.addEventListener('resize', recalculatePosition);

    return () => {
      window.removeEventListener('scroll', recalculatePosition, true);
      window.removeEventListener('resize', recalculatePosition);
    };
  }, [isOpen]);

  // Fetch session campers for person selection
  const { data: allCampers = [] } = useQuery({
    queryKey: ['session-campers', sessionId, year],
    queryFn: async () => {
      // Fetch attendees for this session with expanded person relation
      const attendees = await pb.collection<AttendeesResponse>('attendees').getFullList({
        filter: `year = ${year} && status = "enrolled"`,
        expand: 'person,session'
      });
      
      // Filter by session after expand since we can't filter on relation fields directly
      interface ExpandedAttendee {
        session?: { cm_id?: number };
        person?: PersonsResponse;
      }
      const sessionAttendees = attendees.filter(attendee => {
        const expanded = attendee.expand as ExpandedAttendee | undefined;
        return expanded?.session?.cm_id === sessionId;
      });

      // Map to camper format with session info
      return sessionAttendees.map(attendee => {
        const expanded = attendee.expand as ExpandedAttendee | undefined;
        const person = expanded?.person;
        if (!person) return null;
        const camper: Camper = {
          id: person.id,
          campminder_person_id: person.cm_id,
          first_name: person.first_name,
          last_name: person.last_name,
          preferred_name: person.preferred_name,
          age: person.birthdate ? calculateAge(person.birthdate) : 0,
          grade: person.grade || 0,
          gender: person.gender || '',
          session_cm_id: sessionId
        };
        return camper;
      }).filter(Boolean) as Camper[];
    },
    enabled: requestType !== 'age_preference' && isOpen
  });

  // Get current person from personMap (passed from parent) instead of separate query
  const currentPerson = useMemo(() => {
    if (!currentPersonId || currentPersonId <= 0 || requestType === 'age_preference') {
      return undefined;
    }
    return personMap?.get(currentPersonId);
  }, [currentPersonId, personMap, requestType]);

  // Filter campers based on search and exclude requester
  const filteredCampers = useMemo(() => {
    let filtered = allCampers.filter((camper) => 
      camper.campminder_person_id !== requesterCmId
    );

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((camper) => {
        const fullName = formatCamperName(camper).toLowerCase();
        return fullName.includes(query);
      });
    }

    // Sort by name
    return filtered.sort((a, b) => {
      const nameA = formatCamperName(a);
      const nameB = formatCamperName(b);
      return nameA.localeCompare(nameB);
    }).slice(0, 10); // Limit to 10 results for performance
  }, [allCampers, searchQuery, requesterCmId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Focus search input when opening
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const handlePersonSelect = (camperId: number) => {
    onChange({ requestee_id: camperId });
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleAgePreferenceChange = (target: string) => {
    onChange({ age_preference_target: target });
    setIsOpen(false);
  };

  // Render based on request type
  if (requestType === 'age_preference') {
    // Age preference dropdown
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => !disabled && setIsOpen(!isOpen)}
          className={clsx(
            "inline-flex items-center gap-1 px-2 py-1 text-sm rounded transition-colors",
            "hover:bg-muted border border-transparent hover:border-border",
            "w-full max-w-full",
            disabled && "opacity-50 cursor-not-allowed",
            !agePreferenceTarget && "text-muted-foreground"
          )}
          disabled={disabled}
        >
          <ChevronDown className="w-3 h-3 flex-shrink-0" />
          <span>
            {agePreferenceTarget === 'older' ? 'Prefers older' :
             agePreferenceTarget === 'younger' ? 'Prefers younger' :
             'Select preference'}
          </span>
        </button>

        {isOpen && (
          <div className="absolute z-[60] mt-1 w-40 bg-popover border border-border rounded-md shadow-lg">
            <div className="py-1">
              <button
                onClick={() => handleAgePreferenceChange('older')}
                className={clsx(
                  "w-full px-3 py-2 text-sm text-left hover:bg-muted transition-colors",
                  agePreferenceTarget === 'older' && "bg-muted font-medium"
                )}
              >
                Prefers older
              </button>
              <button
                onClick={() => handleAgePreferenceChange('younger')}
                className={clsx(
                  "w-full px-3 py-2 text-sm text-left hover:bg-muted transition-colors",
                  agePreferenceTarget === 'younger' && "bg-muted font-medium"
                )}
              >
                Prefers younger
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Person selection for bunk_with, not_bunk_with, prior_year_continuity
  let displayText = 'Select person';

  if (currentPerson) {
    displayText = `${currentPerson.first_name} ${currentPerson.last_name}`;
  } else if (currentPersonId && currentPersonId > 0) {
    displayText = `Person ${currentPersonId}`;
  } else if (!currentPersonId || currentPersonId === 0 || currentPersonId < 0) {
    // Use requested_person_name for unmatched requests (shows the individual split name)
    if (requestedPersonName) {
      displayText = `${requestedPersonName} (unresolved)`;
    }
  }

  // Determine if we can link to the target camper
  const canLinkToTarget = currentPersonId && currentPersonId > 0;

  return (
    <div className="relative flex items-center gap-1" ref={dropdownRef}>
      <button
        ref={triggerRef}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={clsx(
          "inline-flex items-center gap-1 px-2 py-1 text-sm rounded transition-colors",
          "hover:bg-muted border border-transparent hover:border-border",
          "max-w-full",
          disabled && "opacity-50 cursor-not-allowed",
          !currentPersonId && "text-muted-foreground"
        )}
        disabled={disabled}
      >
        {dropdownPosition.direction === 'up' && isOpen ? (
          <ChevronUp className="w-3 h-3 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-3 h-3 flex-shrink-0" />
        )}
        <User className="w-3 h-3 flex-shrink-0" />
        <span className="truncate max-w-[200px]">{displayText}</span>
      </button>
      {/* View target camper in modal */}
      {canLinkToTarget && onViewCamper && currentPersonId && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onViewCamper(currentPersonId);
          }}
          className="p-1 hover:bg-muted rounded transition-colors flex-shrink-0"
          title="View camper details"
        >
          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-primary" />
        </button>
      )}

      {isOpen && (
        <div
          className="fixed z-[9999] w-80 bg-popover border border-border rounded-md shadow-lg"
          style={{
            top: dropdownPosition.top !== undefined ? dropdownPosition.top : undefined,
            bottom: dropdownPosition.bottom !== undefined ? dropdownPosition.bottom : undefined,
            left: Math.min(dropdownPosition.left, window.innerWidth - 340), // Keep on screen
            maxWidth: 'calc(100vw - 2rem)',
          }}
        >
          {/* Reference banner - shows the name we're looking for */}
          {requestedPersonName && requestedPersonName.trim() && (
            <div className="px-3 py-2 bg-forest-50/60 dark:bg-forest-950/40 border-b border-forest-200/50 dark:border-forest-800/50">
              <div className="flex items-start gap-2">
                <Quote className="w-3.5 h-3.5 text-forest-600 dark:text-forest-400 flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-medium text-forest-700 dark:text-forest-300">
                    Looking for:
                  </span>
                  <p className="text-sm text-forest-800 dark:text-forest-200 italic truncate" title={requestedPersonName}>
                    "{requestedPersonName}"
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Search input */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Camper list */}
          <div className="max-h-64 overflow-y-auto">
            {filteredCampers.length === 0 ? (
              <div className="px-3 py-4 text-sm text-center text-muted-foreground">
                {searchQuery ? 'No campers match your search' : 'No campers found'}
              </div>
            ) : (
              <div className="py-1">
                {filteredCampers.map((camper) => (
                  <button
                    key={camper.id}
                    onClick={() => handlePersonSelect(camper.campminder_person_id)}
                    className={clsx(
                      "w-full px-3 py-2 text-sm text-left hover:bg-muted transition-colors",
                      currentPersonId === camper.campminder_person_id && "bg-muted"
                    )}
                  >
                    <div className="font-medium">{formatCamperName(camper)}</div>
                    <div className="text-xs text-muted-foreground">
                      Age {(getDisplayAgeForYear(camper, year) ?? 0).toFixed(2)} • Grade {camper.grade}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Clear selection option */}
          {currentPersonId && (
            <div className="border-t border-border py-1">
              <button
                onClick={() => onChange({ requestee_id: null })}
                className="w-full px-3 py-2 text-sm text-left text-muted-foreground hover:bg-muted transition-colors"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}