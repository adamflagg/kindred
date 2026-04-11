import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { ChevronDown, ChevronUp, Search, User, ExternalLink, Quote } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import type { PersonsResponse, AttendeesResponse } from '../types/pocketbase-types'
import { getDisplayAgeForYear } from '../utils/displayAge'
import clsx from 'clsx'
import { useClickOutside } from '../hooks/useClickOutside'

interface EditableRequestTargetProps {
  requestType: string
  currentPersonId?: number | null
  agePreferenceTarget?: string
  sessionId: number
  year: number
  requesterCmId: number
  onChange: (updates: { requestee_id?: number | null; age_preference_target?: string }) => void
  disabled?: boolean
  originalText?: string
  parseNotes?: string
  requestedPersonName?: string
  onViewCamper?: (personCmId: number) => void
  personMap?: Map<number, PersonsResponse>
  sessionName?: string | undefined // Session display name for the "Looking in session X for:" banner
}

interface Camper {
  id: string
  campminder_person_id: number
  first_name: string
  last_name: string
  preferred_name?: string
  age: number
  birthdate?: string
  grade: number
  gender: string
  session_cm_id: number
}

// Helper function to format camper name
function formatCamperName(camper: Camper): string {
  const firstName = camper.first_name
  const preferredName = camper.preferred_name?.replace(/^["']|["']$/g, '')
  const lastName = camper.last_name

  if (preferredName && preferredName !== firstName) {
    return `${firstName} "${preferredName}" ${lastName}`
  }

  return `${firstName} ${lastName}`
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
  personMap,
  sessionName,
}: EditableRequestTargetProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [dropdownPosition, setDropdownPosition] = useState<{
    top?: number
    bottom?: number
    left: number
    direction: 'down' | 'up'
  }>({ left: 0, direction: 'down' })
  const dropdownRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Calculate dropdown position on open - use fixed positioning to escape overflow containers
  useLayoutEffect(() => {
    if (isOpen && triggerRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect()
      const viewportHeight = window.innerHeight
      const dropdownHeight = 400 // Approximate max height of dropdown

      const spaceBelow = viewportHeight - triggerRect.bottom
      const spaceAbove = triggerRect.top

      // Open upward if not enough space below and more space above
      if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
        setDropdownPosition({
          bottom: viewportHeight - triggerRect.top + 4,
          left: triggerRect.left,
          direction: 'up',
        })
      } else {
        setDropdownPosition({
          top: triggerRect.bottom + 4,
          left: triggerRect.left,
          direction: 'down',
        })
      }
    }
  }, [isOpen])

  // Recalculate position on scroll (parent container may scroll)
  useEffect(() => {
    if (!isOpen) return

    const recalculatePosition = () => {
      if (triggerRef.current) {
        const triggerRect = triggerRef.current.getBoundingClientRect()
        const viewportHeight = window.innerHeight
        const dropdownHeight = 400

        const spaceBelow = viewportHeight - triggerRect.bottom
        const spaceAbove = triggerRect.top

        if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
          setDropdownPosition({
            bottom: viewportHeight - triggerRect.top + 4,
            left: triggerRect.left,
            direction: 'up',
          })
        } else {
          setDropdownPosition({
            top: triggerRect.bottom + 4,
            left: triggerRect.left,
            direction: 'down',
          })
        }
      }
    }

    // Listen for scroll on any ancestor
    window.addEventListener('scroll', recalculatePosition, true)
    window.addEventListener('resize', recalculatePosition)

    return () => {
      window.removeEventListener('scroll', recalculatePosition, true)
      window.removeEventListener('resize', recalculatePosition)
    }
  }, [isOpen])

  // Fetch session campers for person selection
  const { data: allCampers = [] } = useQuery({
    queryKey: ['session-campers', sessionId, year],
    queryFn: async () => {
      // Fetch attendees for this session with expanded person relation
      const attendees = await pb.collection<AttendeesResponse>('attendees').getFullList({
        filter: `year = ${year} && status = "enrolled"`,
        expand: 'person,session',
      })

      // Filter by session after expand since we can't filter on relation fields directly
      interface ExpandedAttendee {
        session?: { cm_id?: number }
        person?: PersonsResponse
      }
      const sessionAttendees = attendees.filter((attendee) => {
        const expanded = attendee.expand as ExpandedAttendee | undefined
        return expanded?.session?.cm_id === sessionId
      })

      // Map to camper format with session info
      return sessionAttendees
        .map((attendee) => {
          const expanded = attendee.expand as ExpandedAttendee | undefined
          const person = expanded?.person
          if (!person) return null
          const camper: Camper = {
            id: person.id,
            campminder_person_id: person.cm_id,
            first_name: person.first_name,
            last_name: person.last_name,
            preferred_name: person.preferred_name,
            age: person.age,
            birthdate: person.birthdate,
            grade: person.grade ?? 0,
            gender: person.gender || '',
            session_cm_id: sessionId,
          }
          return camper
        })
        .filter(Boolean) as Camper[]
    },
    enabled: requestType !== 'age_preference' && isOpen,
  })

  // Get current person from personMap (passed from parent) instead of separate query
  const currentPerson = useMemo(() => {
    if (!currentPersonId || currentPersonId <= 0 || requestType === 'age_preference') {
      return undefined
    }
    return personMap?.get(currentPersonId)
  }, [currentPersonId, personMap, requestType])

  // Filter campers based on search and exclude requester
  const filteredCampers = useMemo(() => {
    let filtered = allCampers.filter((camper) => camper.campminder_person_id !== requesterCmId)

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter((camper) => {
        const fullName = formatCamperName(camper).toLowerCase()
        return fullName.includes(query)
      })
    }

    // Sort by name
    return filtered
      .sort((a, b) => {
        const nameA = formatCamperName(a)
        const nameB = formatCamperName(b)
        return nameA.localeCompare(nameB)
      })
      .slice(0, 10) // Limit to 10 results for performance
  }, [allCampers, searchQuery, requesterCmId])

  // Close dropdown when clicking outside
  const handleClickOutside = useCallback(() => {
    setIsOpen(false)
    setSearchQuery('')
  }, [])
  useClickOutside(dropdownRef, handleClickOutside, isOpen)

  // Focus search input when opening
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [isOpen])

  const handlePersonSelect = (camperId: number) => {
    onChange({ requestee_id: camperId })
    setIsOpen(false)
    setSearchQuery('')
  }

  const handleAgePreferenceChange = (target: string) => {
    onChange({ age_preference_target: target })
    setIsOpen(false)
  }

  // Render based on request type
  if (requestType === 'age_preference') {
    // Age preference dropdown
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => !disabled && setIsOpen(!isOpen)}
          className={clsx(
            'inline-flex items-center gap-1 rounded px-2 py-1 text-sm transition-colors',
            'hover:bg-muted hover:border-border border border-transparent',
            'w-full max-w-full',
            disabled && 'cursor-not-allowed opacity-50',
            !agePreferenceTarget && 'text-muted-foreground'
          )}
          disabled={disabled}
        >
          <ChevronDown className="h-3 w-3 flex-shrink-0" />
          <span>
            {agePreferenceTarget === 'older'
              ? 'Prefers older'
              : agePreferenceTarget === 'younger'
                ? 'Prefers younger'
                : 'Select preference'}
          </span>
        </button>

        {isOpen && (
          <div className="bg-popover border-border absolute z-[60] mt-1 w-40 rounded-md border shadow-lg">
            <div className="py-1">
              <button
                onClick={() => handleAgePreferenceChange('older')}
                className={clsx(
                  'hover:bg-muted w-full px-3 py-2 text-left text-sm transition-colors',
                  agePreferenceTarget === 'older' && 'bg-muted font-medium'
                )}
              >
                Prefers older
              </button>
              <button
                onClick={() => handleAgePreferenceChange('younger')}
                className={clsx(
                  'hover:bg-muted w-full px-3 py-2 text-left text-sm transition-colors',
                  agePreferenceTarget === 'younger' && 'bg-muted font-medium'
                )}
              >
                Prefers younger
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Person selection for bunk_with, not_bunk_with, prior_year_continuity
  let displayText = 'Select person'

  if (currentPerson) {
    displayText = `${currentPerson.first_name} ${currentPerson.last_name}`
  } else if (currentPersonId && currentPersonId > 0) {
    displayText = `Person ${currentPersonId}`
  } else if (!currentPersonId || currentPersonId === 0 || currentPersonId < 0) {
    // Use requested_person_name for unmatched requests (shows the individual split name)
    if (requestedPersonName) {
      displayText = `${requestedPersonName} (unresolved)`
    }
  }

  // Determine if we can link to the target camper
  const canLinkToTarget = !!currentPersonId && currentPersonId > 0

  return (
    <div className="relative flex items-center gap-1" ref={dropdownRef}>
      <button
        ref={triggerRef}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={clsx(
          'inline-flex items-center gap-1 rounded px-2 py-1 text-sm transition-colors',
          'hover:bg-muted hover:border-border border border-transparent',
          'max-w-full',
          disabled && 'cursor-not-allowed opacity-50',
          !currentPersonId && 'text-muted-foreground',
          requestType === 'not_bunk_with' &&
            'text-red-600 [text-shadow:0_0_8px_rgba(239,68,68,0.4)] dark:text-red-400'
        )}
        disabled={disabled}
      >
        {dropdownPosition.direction === 'up' && isOpen ? (
          <ChevronUp className="h-3 w-3 flex-shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 flex-shrink-0" />
        )}
        <User className="h-3 w-3 flex-shrink-0" />
        <span className="max-w-[200px] truncate">{displayText}</span>
      </button>
      {/* View target camper in modal */}
      {canLinkToTarget && onViewCamper && currentPersonId && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onViewCamper(currentPersonId)
          }}
          className="hover:bg-muted flex-shrink-0 rounded p-1 transition-colors"
          title="View camper details"
        >
          <ExternalLink className="text-muted-foreground hover:text-primary h-3.5 w-3.5" />
        </button>
      )}

      {isOpen && (
        <div
          className="bg-popover text-popover-foreground border-border fixed z-[9999] w-80 rounded-md border shadow-lg"
          style={{
            top: dropdownPosition.top ?? undefined,
            bottom: dropdownPosition.bottom ?? undefined,
            left: Math.min(dropdownPosition.left, window.innerWidth - 340), // Keep on screen
            maxWidth: 'calc(100vw - 2rem)',
          }}
        >
          {/* Reference banner - shows the name we're looking for */}
          {requestedPersonName?.trim() && (
            <div className="bg-forest-50/60 dark:bg-forest-950/40 border-forest-200/50 dark:border-forest-800/50 border-b px-3 py-2">
              <div className="flex items-start gap-2">
                <Quote className="text-forest-600 dark:text-forest-400 mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <span className="text-forest-700 dark:text-forest-300 text-xs font-medium">
                    {sessionName ? `Looking in ${sessionName} for:` : 'Looking for:'}
                  </span>
                  <p
                    className="text-forest-800 dark:text-forest-200 truncate text-sm italic"
                    title={requestedPersonName}
                  >
                    "{requestedPersonName}"
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Search input */}
          <div className="border-border border-b p-2">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 transform" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-background focus:ring-primary w-full rounded border py-1.5 pr-3 pl-8 text-sm focus:ring-1 focus:outline-none"
              />
            </div>
          </div>

          {/* Camper list */}
          <div className="max-h-64 overflow-y-auto">
            {filteredCampers.length === 0 ? (
              <div className="text-muted-foreground px-3 py-4 text-center text-sm">
                {searchQuery ? 'No campers match your search' : 'No campers found'}
              </div>
            ) : (
              <div className="py-1">
                {filteredCampers.map((camper) => (
                  <button
                    key={camper.id}
                    onClick={() => handlePersonSelect(camper.campminder_person_id)}
                    className={clsx(
                      'hover:bg-muted w-full px-3 py-2 text-left text-sm transition-colors',
                      currentPersonId === camper.campminder_person_id && 'bg-muted'
                    )}
                  >
                    <div className="font-medium">{formatCamperName(camper)}</div>
                    <div className="text-muted-foreground text-xs">
                      Age {(getDisplayAgeForYear(camper, year) ?? 0).toFixed(2)}
                      {camper.grade > 0 && ` • Grade ${camper.grade}`}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Clear selection option */}
          {!!currentPersonId && (
            <div className="border-border border-t py-1">
              <button
                onClick={() => onChange({ requestee_id: null })}
                className="text-muted-foreground hover:bg-muted w-full px-3 py-2 text-left text-sm transition-colors"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
