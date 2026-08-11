import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, UserCheck } from 'lucide-react'
import { pb } from '../lib/pocketbase'
import type { BunkRequest, Camper } from '../types/app-types'
import type { PersonsResponse, AttendeesResponse } from '../types/pocketbase-types'
import { getDisplayAgeForYear } from '../utils/displayAge'
import { Modal } from './ui/Modal'

interface ManualResolutionModalProps {
  request: BunkRequest
  requesterPerson?: PersonsResponse
  sessionId: number
  year: number
  isOpen: boolean
  onClose: () => void
  onResolve: (personCmId: number) => void
}

// Helper function to format camper name
function formatCamperName(camper: Camper): string {
  const firstName = camper.first_name ?? ''
  const preferredName = camper.preferred_name?.replace(/^["']|["']$/g, '')
  const lastName = camper.last_name ?? ''

  if (preferredName && preferredName !== firstName) {
    return `${firstName} "${preferredName}" ${lastName}`.trim()
  }

  return `${firstName} ${lastName}`.trim()
}

export default function ManualResolutionModal({
  request,
  requesterPerson,
  sessionId,
  year,
  isOpen,
  onClose,
  onResolve,
}: ManualResolutionModalProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCamperId, setSelectedCamperId] = useState<number | null>(null)

  // Fetch all campers for this session
  const { data: allCampers = [] } = useQuery({
    queryKey: ['session-campers', sessionId, year],
    queryFn: async () => {
      // Get attendees for this specific session
      const attendeeFilter = `session.cm_id = ${sessionId} && status = "enrolled" && year = ${year}`
      const attendees = await pb
        .collection('attendees')
        .getFullList<AttendeesResponse>({ filter: attendeeFilter })

      if (attendees.length === 0) return []

      // Collect unique person CampMinder IDs
      const personCmIds = [...new Set(attendees.map((a) => a.person_id))]

      // Load persons in batches
      const persons: PersonsResponse[] = []
      const BATCH_SIZE = 50

      for (let i = 0; i < personCmIds.length; i += BATCH_SIZE) {
        const batch = personCmIds.slice(i, i + BATCH_SIZE)
        const batchFilter = batch.map((id) => `person_id = ${id}`).join(' || ')

        try {
          const batchPersons = await pb
            .collection('persons')
            .getFullList<PersonsResponse>({ filter: batchFilter })
          persons.push(...batchPersons)
        } catch (error) {
          console.error(`Error fetching person batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error)
        }
      }

      // Transform attendees to campers
      const campers: Camper[] = []

      for (const attendee of attendees) {
        const person = persons.find((p) => p.id === attendee.person)
        if (!person || !person.is_camper) continue

        // Create a minimal camper object using available data
        const camper: Camper = {
          id: `${person.cm_id}:${sessionId}`,
          attendee_id: attendee.id,
          name: `${person.first_name} ${person.last_name}`,
          person_cm_id: person.cm_id,
          first_name: person.first_name,
          last_name: person.last_name,
          preferred_name: person.preferred_name,
          age: person.age,
          birthdate: person.birthdate,
          grade: person.grade || 0,
          gender: (person.gender || 'NB') as 'M' | 'F' | 'NB',
          session_cm_id: sessionId,
          assigned_bunk: '', // Will be set later if they have an assignment
          created: attendee.created || new Date().toISOString(),
          updated: attendee.updated || new Date().toISOString(),
        }

        campers.push(camper)
      }

      return campers
    },
    enabled: isOpen,
  })

  // Filter campers based on search query and exclude the requester
  const filteredCampers = useMemo(() => {
    let filtered = allCampers.filter(
      (camper: Camper) => camper.person_cm_id !== request.requester_id
    )

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter((camper: Camper) => {
        const fullName = formatCamperName(camper).toLowerCase()
        const firstName = camper.first_name?.toLowerCase() ?? ''
        const lastName = camper.last_name?.toLowerCase() ?? ''
        const preferredName = camper.preferred_name?.toLowerCase() ?? ''

        return (
          fullName.includes(query) ||
          firstName.includes(query) ||
          lastName.includes(query) ||
          preferredName.includes(query)
        )
      })
    }

    // Sort by name
    return filtered.sort((a: Camper, b: Camper) => {
      const nameA = formatCamperName(a)
      const nameB = formatCamperName(b)
      return nameA.localeCompare(nameB)
    })
  }, [allCampers, searchQuery, request.requester_id])

  const handleResolve = () => {
    if (selectedCamperId) {
      onResolve(selectedCamperId)
    }
  }

  const headerContent = (
    <div className="border-border flex-shrink-0 border-b p-6 pr-14">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <UserCheck className="h-5 w-5 text-blue-600" />
          Manual Resolution
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Select the correct camper for this bunk request
        </p>
      </div>
    </div>
  )

  const footerContent = (
    <div className="border-border bg-muted/20 border-t p-6">
      <div className="flex items-center justify-between">
        <div className="text-muted-foreground text-sm">
          {filteredCampers.length} camper
          {filteredCampers.length !== 1 ? 's' : ''} available
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="border-border hover:bg-muted rounded-full border-2 px-6 py-2.5 font-semibold transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleResolve}
            disabled={!selectedCamperId}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full px-6 py-2.5 font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50"
          >
            Resolve Request
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      header={headerContent}
      footer={footerContent}
      size="lg"
      noPadding
    >
      <div className="flex max-h-[60vh] flex-col">
        {/* Request Info */}
        <div className="bg-muted/30 border-border flex-shrink-0 border-b p-6">
          <div className="space-y-2">
            <div className="flex gap-2">
              <span className="text-muted-foreground text-sm font-medium">Requester:</span>
              <span className="text-sm font-medium">
                {requesterPerson
                  ? `${requesterPerson.first_name} ${requesterPerson.last_name}`
                  : `Person ${request.requester_id}`}
              </span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground text-sm font-medium">Original Request:</span>
              <span className="text-sm italic">"{request.original_text}"</span>
            </div>
            {request.parse_notes && (
              <div className="flex gap-2">
                <span className="text-muted-foreground text-sm font-medium">Parse notes:</span>
                <span className="text-primary text-sm font-medium">{request.parse_notes}</span>
              </div>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="border-border flex-shrink-0 border-b p-6">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform" />
            <input
              type="text"
              placeholder="Search campers by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-background text-foreground focus:ring-primary focus:border-primary w-full rounded-xl border-2 py-2.5 pr-4 pl-10 transition-all focus:ring-2"
              // Deliberate: this modal's entire purpose is "search for a camper to
              // resolve", opened by an explicit staff click; focusing the search box
              // on open lets them start typing immediately instead of needing an
              // extra click.
              autoFocus
            />
          </div>
        </div>

        {/* Camper List - Scrollable */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-2">
            {filteredCampers.length === 0 ? (
              <div className="text-muted-foreground py-8 text-center">
                {searchQuery ? 'No campers match your search' : 'No campers found in this session'}
              </div>
            ) : (
              filteredCampers.map((camper: Camper) => (
                <button
                  key={camper.id}
                  onClick={() => setSelectedCamperId(camper.person_cm_id)}
                  className={`w-full rounded-lg border-2 p-4 text-left transition-all ${
                    selectedCamperId === camper.person_cm_id
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50 hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{formatCamperName(camper)}</div>
                      <div className="text-muted-foreground mt-1 text-sm">
                        Age {(getDisplayAgeForYear(camper, year) ?? 0).toFixed(2)} • Grade{' '}
                        {camper.grade} • {camper.gender}
                      </div>
                    </div>
                    {selectedCamperId === camper.person_cm_id && (
                      <div className="bg-primary flex h-5 w-5 items-center justify-center rounded-full">
                        <div className="bg-primary-foreground h-2 w-2 rounded-full" />
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
  )
}
