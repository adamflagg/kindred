/**
 * The weekend's unplaced parties, over the shared corner queue.
 *
 * It replaces the fixed rails the board and map used to carry — 240px and
 * 280px of permanent width for a list that is usually short and sometimes
 * empty. Summer has never had a rail; this is that divergence closing.
 *
 * `isExpanded` is local. Summer's board owns its badge's open state because
 * other board affordances read it; nothing on the weekend surfaces does.
 */
import { useDroppable } from '@dnd-kit/core'
import { useState } from 'react'

import type { RosterPartyRow } from '../../types/lodging'
import { FloatingQueueBadge } from '../ui'
import { UNPLACED_DROPPABLE_ID } from './dragPlacement'
import { FamilyCard } from './FamilyCard'
import { partyIdentityLabel, partySearchText } from './householdIdentity'
import { partyKey } from './partyKey'

export interface FloatingUnplacedBadgeProps {
  parties: RosterPartyRow[]
  onOpenParty: (party: RosterPartyRow) => void
  /** A FamilyDetailsPanel is open, so shift out from under it and stay up. */
  isPanelOpen?: boolean
  /** Placement is live: dropping a family here UNPLACES it (a DELETE, not a tombstone). */
  canPlace?: boolean
}

// Module-level so their identity is stable across renders: the shell memoises
// its sort and filter on them.
//
// The tiebreaker is `partyIdentityLabel`, not `party.display_name` --
// kindred#2084: the latter is CampMinder's mailing_title salutation, which
// disagreed with the real attending-adult list on 26.7% of 2026's rostered
// households. Same construction FamilyCard uses (`householdIdentity.ts`).
const sortKey = (party: RosterPartyRow): string[] => [
  party.sort_name ?? '',
  partyIdentityLabel(party),
]

const EMPTY_STATE = (
  <div className="flex h-full flex-col items-center justify-center py-8 text-center">
    <p className="text-muted-foreground text-sm italic">Everyone has a cabin.</p>
  </div>
)

export function FloatingUnplacedBadge({
  parties,
  onOpenParty,
  isPanelOpen = false,
  canPlace = false,
}: FloatingUnplacedBadgeProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  // The shell has carried `listRef`/`isDropTarget` since it was extracted,
  // annotated "the weekend's at C2". This is C2.
  const { setNodeRef, isOver } = useDroppable({
    id: UNPLACED_DROPPABLE_ID,
    disabled: !canPlace,
  })

  return (
    <FloatingQueueBadge
      items={parties}
      sortKey={sortKey}
      getSearchText={partySearchText}
      renderList={(visible) => (
        <div className="flex flex-col gap-1.5">
          {visible.map((party) => (
            <FamilyCard
              key={partyKey(party)}
              party={party}
              inQueue={true}
              isDraggable={canPlace}
              onOpen={onOpenParty}
            />
          ))}
        </div>
      )}
      label="Unplaced"
      // "parties", not "families": an adult weekend enrols individuals, so the
      // person-grain rows in this queue are not families and the accessible
      // name would be wrong for a whole session type. "Parties" is already the
      // weekend's own word — the lander and the stats bar both count parties.
      noun="parties"
      cardSelector="[data-family-card]"
      emptyState={EMPTY_STATE}
      isExpanded={isExpanded}
      onToggle={() => {
        setIsExpanded((open) => !open)
      }}
      onClose={() => {
        setIsExpanded(false)
      }}
      isPanelOpen={isPanelOpen}
      dropRef={setNodeRef}
      isDropTarget={isOver}
    />
  )
}
