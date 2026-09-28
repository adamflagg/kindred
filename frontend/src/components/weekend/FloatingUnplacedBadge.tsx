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
import { useCallback, useMemo, useState } from 'react'

import type { RosterPartyRow } from '../../types/lodging'
import type { CardNoteSlots } from '../../types/noteSlots'
import { isAdultSessionType } from '../../utils/sessionTypePredicates'
import { FloatingQueueBadge } from '../ui'
import { UNPLACED_DROPPABLE_ID } from './dragPlacement'
import { FamilyCard } from './FamilyCard'
import { partyIdentityLabel, partySearchText } from './householdIdentity'
import { partyKey } from './partyKey'
import {
  unplacedFilterGroup,
  unplacedFilterGroupsFor,
  type UnplacedFilterKey,
} from './unplacedFilters'

export interface FloatingUnplacedBadgeProps {
  parties: RosterPartyRow[]
  onOpenParty: (party: RosterPartyRow) => void
  /** A FamilyDetailsPanel is open, so shift out from under it and stay up. */
  isPanelOpen?: boolean
  /** Placement is live: dropping a family here UNPLACES it (a DELETE, not a tombstone). */
  canPlace?: boolean
  /** The weekend's `session_type`, forwarded to each card (kindred#2759). */
  sessionType?: string | undefined
  /** Board-note slots per queued party (board notes). */
  partyNoteSlots?: ((party: RosterPartyRow) => CardNoteSlots | undefined) | undefined
  /** The weekend's session is male-only (Men's), so "Child under 2" is dropped (kindred#2859). */
  maleOnly?: boolean
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

/**
 * An adult weekend sorts by AGE ONLY (kindred#2859, owner 2026-09-27: "we dont
 * need alpha, esp with typeahead search") -- the name search finds a guest, so
 * the order is free to answer the placing question. Summer's queue has no
 * sort control and a household has no single age, so this is adult-only.
 *
 * The age is the one the card prints (`adults[0].age`, kindred#2767), under the
 * card's own `> 0` test: the server sends None for CampMinder's stored 0, and a
 * 0 that slipped through is no more an age here than it is on the card.
 *
 * An unknown age sorts LAST in both directions -- the leading bucket token does
 * that, so negating the age for Oldest cannot drag the unknowns to the top.
 * Ties fall back to the name order above.
 */
type AgeOrder = 'youngest' | 'oldest'

const AGE_ORDERS: ReadonlyArray<{ key: AgeOrder; label: string }> = [
  { key: 'youngest', label: 'Youngest' },
  { key: 'oldest', label: 'Oldest' },
]

function guestAge(party: RosterPartyRow): number | null {
  const age = party.adults?.[0]?.age ?? null
  return age !== null && age > 0 ? age : null
}

const byAge =
  (direction: 1 | -1) =>
  (party: RosterPartyRow): Array<string | number> => {
    const age = guestAge(party)
    return [age === null ? 1 : 0, age === null ? 0 : direction * age, ...sortKey(party)]
  }

const AGE_SORT_KEYS: Record<AgeOrder, (party: RosterPartyRow) => Array<string | number>> = {
  youngest: byAge(1),
  oldest: byAge(-1),
}

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
  sessionType,
  partyNoteSlots,
  maleOnly = false,
}: FloatingUnplacedBadgeProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isAdultWeekend = isAdultSessionType(sessionType ?? '')
  // Oldest first by default (owner pick 2026-09-27). Local for `group`'s reason below.
  const [ageOrder, setAgeOrder] = useState<AgeOrder>('oldest')
  const filterGroups = useMemo(
    () => unplacedFilterGroupsFor(isAdultWeekend, maleOnly),
    [isAdultWeekend, maleOnly]
  )
  // Single-select by ruling (kindred#2480): `null` or exactly one group, so a
  // party in two groups never needs a tie-break. Local, like `isExpanded` --
  // nothing outside this popout reads it, and the board's URL state is for
  // things worth linking to, not a scratch filter.
  const [pickedGroup, setGroup] = useState<UnplacedFilterKey | null>(null)
  // Applied only while this weekend still offers it (kindred#2859). A cached
  // weekend re-renders this badge in place rather than remounting it, so a
  // pick made on Women's or a family weekend survives the switch to one that
  // drops the chip, and would go on filtering with no chip left to clear it.
  const group =
    pickedGroup !== null && filterGroups.some((spec) => spec.key === pickedGroup)
      ? pickedGroup
      : null

  // Over ALL unplaced parties, never the name-searched subset: the number is
  // there to answer "is this group worth clicking", and one that moved while
  // you typed would stop answering it.
  const counts = useMemo(() => {
    const tally = {} as Record<UnplacedFilterKey, number>
    for (const spec of filterGroups) {
      tally[spec.key] = parties.filter((party) => spec.matches(party)).length
    }
    return tally
  }, [parties, filterGroups])

  const itemFilter = useMemo(() => {
    if (!group) return undefined
    const { matches } = unplacedFilterGroup(group)
    return (party: RosterPartyRow) => matches(party)
  }, [group])

  const clearFilter = useCallback(() => {
    setGroup(null)
  }, [])

  // "…are open to sharing" reads; "…need open to sharing" does not. The two
  // need-shaped groups and the one state-shaped group take different verbs.
  const emptyFilterSentence = group
    ? `No unplaced parties ${group === 'sharing' ? 'are' : 'need'} ${unplacedFilterGroup(
        group
      ).label.toLowerCase()}.`
    : ''
  // The shell has carried `listRef`/`isDropTarget` since it was extracted,
  // annotated "the weekend's at C2". This is C2.
  const { setNodeRef, isOver } = useDroppable({
    id: UNPLACED_DROPPABLE_ID,
    disabled: !canPlace,
  })

  return (
    <FloatingQueueBadge
      items={parties}
      sortKey={isAdultWeekend ? AGE_SORT_KEYS[ageOrder] : sortKey}
      getSearchText={partySearchText}
      renderList={(visible) => (
        <div className="flex flex-col gap-1.5">
          {visible.map((party) => (
            <FamilyCard
              key={partyKey(party)}
              party={party}
              inQueue={true}
              isDraggable={canPlace}
              sessionType={sessionType}
              noteSlots={partyNoteSlots?.(party)}
              onOpen={onOpenParty}
            />
          ))}
        </div>
      )}
      filterRow={
        <div data-testid="unplaced-filters" className="flex flex-wrap items-center gap-1">
          {filterGroups.map((spec) => {
            const Icon = spec.Icon
            const isActive = group === spec.key
            const count = counts[spec.key]
            return (
              <button
                key={spec.key}
                type="button"
                // Icon + count, no text label (owner pick 2026-08-24), so the
                // label is the button's only name -- a test handle per
                // frontend/CLAUDE.md, not an accessibility posture.
                aria-label={spec.label}
                aria-pressed={isActive}
                title={spec.label}
                // A zero-count chip is DIMMED, never hidden: a chip that
                // vanished could not tell staff the group is empty, and empty
                // groups are ordinary (2026's FC3 has no power parties). The
                // active chip stays live at zero so it can be switched off.
                disabled={count === 0 && !isActive}
                onClick={() => {
                  setGroup((current) => (current === spec.key ? null : spec.key))
                }}
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium tabular-nums transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-lodge-sm'
                    : 'text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent'
                }`}
              >
                <Icon
                  className={`h-3.5 w-3.5 flex-shrink-0 ${isActive ? '' : spec.hueClassName}`}
                />
                {count}
              </button>
            )
          })}
          {isAdultWeekend && (
            // Segmented, worded, right-anchored (owner picks 2026-09-27 from
            // the kindred#2859 mock). Both states stay visible because there
            // are only two -- a flip button would hide the one you are not on.
            <div className="bg-muted ml-auto inline-flex flex-shrink-0 rounded-lg p-0.5">
              {AGE_ORDERS.map(({ key, label }) => {
                const isActive = ageOrder === key
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={isActive}
                    title={`${label} first`}
                    onClick={() => {
                      setAgeOrder(key)
                    }}
                    className={`rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap transition-colors ${
                      isActive
                        ? 'bg-card text-foreground shadow-lodge-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      }
      itemFilter={itemFilter}
      filterEmptyState={
        <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
          {/* Built as ONE string, not an interleaved JSX sentence: the latter
              splits into several text nodes and stops matching as a sentence. */}
          <p className="text-muted-foreground text-sm">{emptyFilterSentence}</p>
          <button
            type="button"
            onClick={clearFilter}
            className="border-border hover:bg-muted rounded-lg border px-2.5 py-1 text-xs transition-colors"
          >
            Clear filter
          </button>
        </div>
      }
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
