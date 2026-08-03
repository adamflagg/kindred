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
import { useState } from 'react'

import type { RosterPartyRow } from '../../types/lodging'
import { FloatingQueueBadge } from '../ui'
import { FamilyCard } from './FamilyCard'
import { partyKey } from './partyKey'

export interface FloatingUnplacedBadgeProps {
  parties: RosterPartyRow[]
  onOpenParty: (party: RosterPartyRow) => void
  /** A FamilyDetailsPanel is open, so shift out from under it and stay up. */
  isPanelOpen?: boolean
}

// Module-level so their identity is stable across renders: the shell memoises
// its sort and filter on them.
const sortKey = (party: RosterPartyRow): string[] => [
  party.sort_name ?? '',
  party.display_name ?? '',
]

// Children and adults included so a household can be found by the name of
// whoever the staff member happens to remember.
const getSearchText = (party: RosterPartyRow): string =>
  [
    party.display_name ?? '',
    ...(party.adults ?? []).map((adult) => adult.display_name ?? ''),
    ...(party.children ?? []).map((child) => child.display_name ?? ''),
  ].join(' ')

const EMPTY_STATE = (
  <div className="flex h-full flex-col items-center justify-center py-8 text-center">
    <p className="text-muted-foreground text-sm italic">Everyone has a cabin.</p>
  </div>
)

export function FloatingUnplacedBadge({
  parties,
  onOpenParty,
  isPanelOpen = false,
}: FloatingUnplacedBadgeProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <FloatingQueueBadge
      items={parties}
      sortKey={sortKey}
      getSearchText={getSearchText}
      renderList={(visible) => (
        <div className="flex flex-col gap-1.5">
          {visible.map((party) => (
            <FamilyCard key={partyKey(party)} party={party} inQueue={true} onOpen={onOpenParty} />
          ))}
        </div>
      )}
      label="Unplaced"
      noun="families"
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
    />
  )
}
