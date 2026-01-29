import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, UserCheck } from 'lucide-react';
import { pb } from '../lib/pocketbase';
import type { BunkRequest, Camper } from '../types/app-types';
import type { PersonsResponse, AttendeesResponse } from '../types/pocketbase-types';
import { calculateAge } from '../utils/ageCalculator';
import { getDisplayAgeForYear } from '../utils/displayAge';
import { Modal } from './ui/Modal';

interface ManualResolutionModalProps {
  request: BunkRequest;
  requesterPerson?: PersonsResponse;
  sessionId: number;
  year: number;
  isOpen: boolean;
  onClose: () => void;
  onResolve: (personCmId: number) => void;
}

// Helper function to format camper name
function formatCamperName(camper: Camper): string {
  const firstName = camper.first_name || '';
  const preferredName = camper.preferred_name?.replace(/^["']|["']$/g, '');
  const lastName = camper.last_name || '';
  
  if (preferredName && preferredName !== firstName) {
    return `${firstName} "${preferredName}" ${lastName}`.trim();
  }
  
  return `${firstName} ${lastName}`.trim();
}

export default function ManualResolutionModal({
  request,
  requesterPerson,
  sessionId,
  year,
  isOpen,
  onClose,
  onResolve
}: ManualResolutionModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCamperId, setSelectedCamperId] = useState<number | null>(null);

  // Fetch all campers for this session
  const { data: allCampers = [] } = useQuery({
    queryKey: ['session-campers', sessionId, year],
    queryFn: async () => {
      // Get attendees for this specific session
      const attendeeFilter = `session_id = ${sessionId} && status = "enrolled" && year = ${year}`;
      const attendees = await pb.collection('attendees').getFullList<AttendeesResponse>({ filter: attendeeFilter });
      
      if (attendees.length === 0) return [];
      
      // Collect unique person CampMinder IDs
      const personCmIds = [...new Set(attendees.map(a => a.person_id))];
      
      // Load persons in batches
      const persons: PersonsResponse[] = [];
      const BATCH_SIZE = 50;
      
      for (let i = 0; i < personCmIds.length; i += BATCH_SIZE) {
        const batch = personCmIds.slice(i, i + BATCH_SIZE);
        const batchFilter = batch.map(id => `person_id = ${id}`).join(' || ');
        
        try {
          const batchPersons = await pb.collection('persons').getFullList<PersonsResponse>({ filter: batchFilter });
          persons.push(...batchPersons);
        } catch (error) {
          console.error(`Error fetching person batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error);
        }
      }
      
      // Transform attendees to campers
      const campers: Camper[] = [];
      
      for (const attendee of attendees) {
        const person = persons.find(p => p.id === attendee.person);
        if (!person || !person.is_camper) continue;
        
        // Create a minimal camper object using available data
        const camper: Camper = {
          id: `${person.cm_id}:${sessionId}`,
          attendee_id: attendee.id,
          name: `${person.first_name} ${person.last_name}`,
          person_cm_id: person.cm_id,
          first_name: person.first_name,
          last_name: person.last_name,
          preferred_name: person.preferred_name,
          age: person.age ?? (person.birthdate ? calculateAge(person.birthdate) : 0),
          birthdate: person.birthdate,
          grade: person.grade || 0,
          gender: (person.gender || 'NB') as 'M' | 'F' | 'NB',
          session_cm_id: sessionId,
          assigned_bunk: '', // Will be set later if they have an assignment
          created: attendee.created || new Date().toISOString(),
          updated: attendee.updated || new Date().toISOString(),
        };
        
        campers.push(camper);
      }
      
      return campers;
    },
    enabled: isOpen
  });

  // Filter campers based on search query and exclude the requester
  const filteredCampers = useMemo(() => {
    let filtered = allCampers.filter((camper: Camper) => 
      camper.person_cm_id !== request.requester_id
    );

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((camper: Camper) => {
        const fullName = formatCamperName(camper).toLowerCase();
        const firstName = camper.first_name?.toLowerCase() || '';
        const lastName = camper.last_name?.toLowerCase() || '';
        const preferredName = camper.preferred_name?.toLowerCase() || '';
        
        return fullName.includes(query) ||
               firstName.includes(query) ||
               lastName.includes(query) ||
               preferredName.includes(query);
      });
    }

    // Sort by name
    return filtered.sort((a: Camper, b: Camper) => {
      const nameA = formatCamperName(a);
      const nameB = formatCamperName(b);
      return nameA.localeCompare(nameB);
    });
  }, [allCampers, searchQuery, request.requester_id]);

  const handleResolve = () => {
    if (selectedCamperId) {
      onResolve(selectedCamperId);
    }
  };

  const headerContent = (
    <div className="p-6 pr-14 border-b border-border flex-shrink-0">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-blue-600" />
          Manual Resolution
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Select the correct camper for this bunk request
        </p>
      </div>
    </div>
  );

  const footerContent = (
    <div className="p-6 border-t border-border bg-muted/20">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {filteredCampers.length} camper{filteredCampers.length !== 1 ? 's' : ''} available
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2.5 border-2 border-border rounded-full font-semibold hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleResolve}
            disabled={!selectedCamperId}
            className="px-6 py-2.5 bg-primary text-primary-foreground rounded-full font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            Resolve Request
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      header={headerContent}
      footer={footerContent}
      size="lg"
      noPadding
    >
      <div className="flex flex-col max-h-[60vh]">
        {/* Request Info */}
        <div className="p-6 bg-muted/30 border-b border-border flex-shrink-0">
          <div className="space-y-2">
            <div className="flex gap-2">
              <span className="text-sm font-medium text-muted-foreground">Requester:</span>
              <span className="text-sm font-medium">
                {requesterPerson
                  ? `${requesterPerson.first_name} ${requesterPerson.last_name}`
                  : `Person ${request.requester_id}`}
              </span>
            </div>
            <div className="flex gap-2">
              <span className="text-sm font-medium text-muted-foreground">Original Request:</span>
              <span className="text-sm italic">"{request.original_text}"</span>
            </div>
            {request.parse_notes && (
              <div className="flex gap-2">
                <span className="text-sm font-medium text-muted-foreground">Parse notes:</span>
                <span className="text-sm font-medium text-primary">{request.parse_notes}</span>
              </div>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="p-6 border-b border-border flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search campers by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border-2 rounded-xl bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary transition-all"
              autoFocus
            />
          </div>
        </div>

        {/* Camper List - Scrollable */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-2">
            {filteredCampers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchQuery ? 'No campers match your search' : 'No campers found in this session'}
              </div>
            ) : (
              filteredCampers.map((camper: Camper) => (
                <button
                  key={camper.id}
                  onClick={() => setSelectedCamperId(camper.person_cm_id)}
                  className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
                    selectedCamperId === camper.person_cm_id
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50 hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{formatCamperName(camper)}</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        Age {(getDisplayAgeForYear(camper, year) ?? 0).toFixed(2)} • Grade {camper.grade} • {camper.gender}
                      </div>
                    </div>
                    {selectedCamperId === camper.person_cm_id && (
                      <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-primary-foreground" />
                      </div>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}