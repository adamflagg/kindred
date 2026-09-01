/**
 * The cabin-weekend chip's detail modal — Home 1's condensed form popping
 * open (kindred#2648 UI half, Q1/Q2 decided 2026-08-31). `ui/Modal` shell,
 * `SessionAttributionRow` for the shared row rendering, same as the admin
 * queue tab (Home 2).
 *
 * CONDENSED STAYS CONDENSED: unlike the admin tab, this never shows a stale
 * row and offers no toggle to reveal one — that detail belongs to the
 * always-accessible home this modal links out to ("See the full list").
 * Nothing places itself and nothing here pre-selects a candidate as chosen —
 * `SessionAttributionRow` only marks the backend's suggestion, exactly as it
 * does on the admin tab.
 */
import { useMemo } from 'react'
import { Link } from 'react-router'

import { useSessionAttributionQueue } from '../../hooks/useSessionAttributionQueue'
import type { RosterPartyRow } from '../../types/lodging'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, LABEL, MUTED_PILL } from '../admin/lodging/lodgingStyles'
import { SessionAttributionRow } from '../admin/lodging/SessionAttributionRow'
import { partyFamilyLabel } from './householdIdentity'
import { Modal } from '../ui/Modal'

export interface CabinWeekendModalProps {
  isOpen: boolean
  onClose: () => void
  weekendCmId: number
  weekendLabel: string
  /**
   * The weekend's already-loaded roster (kindred#2650) — `WeekendRosterPage`
   * has it in hand regardless of which tab is open, since the attribution
   * chip lives in the stats bar, not inside a tab panel. Used ONLY to
   * resolve a row's family name and its full `RosterPartyRow`, the same way
   * `FamilyCard` derives its own name (`partyFamilyLabel`) — never to
   * re-derive anything `useSessionAttributionQueue` already computed.
   * Defaults to `[]`, so a household with no roster match still shows its
   * raw id rather than throwing.
   */
  parties?: RosterPartyRow[]
  /**
   * Opens the household's full detail surface (`FamilyDetailsPanel`) for a
   * clicked row. Handed the FULL `RosterPartyRow`, not just the id — the
   * panel needs adults/children/placement, none of which
   * `SessionAttributionQueueItem` carries. Omitted renders the name as plain
   * text.
   */
  onOpenFamily?: ((party: RosterPartyRow) => void) | undefined
}

export function CabinWeekendModal({
  isOpen,
  onClose,
  weekendCmId,
  weekendLabel,
  parties = [],
  onOpenFamily,
}: CabinWeekendModalProps) {
  // ON OPEN, NOT ON MOUNT. `CabinWeekendEntry` renders this modal
  // unconditionally and toggles `isOpen`, so this function — and every hook in
  // it — runs for the whole board session. The §12.8 evidence query is
  // uncached and refetches on window focus, so an ungated mount would re-read
  // every candidate weekend's board on each alt-tab back while this modal is
  // shut and drawing nothing. Gating it here is also what makes
  // `useSessionAttributionConflicts`'s `gcTime: 0` note true as written.
  const { data, confirm, isConfirming } = useSessionAttributionQueue({ evidence: isOpen })
  const items = data ?? []

  // Household grain only, cm_id > 0 — mirrors `SessionAttributionRow`'s own
  // "exactly one id is ever set" contract. A person-scoped row (adult
  // weekend guest) never looks itself up here.
  const householdParties = useMemo(() => {
    const byId = new Map<number, RosterPartyRow>()
    for (const party of parties) {
      const cmId = party.household_cm_id ?? 0
      if (party.grain === 'household' && cmId > 0) byId.set(cmId, party)
    }
    return byId
  }, [parties])

  const here = items.filter(
    (i) => !i.isStale && i.candidates.some((c) => c.sessionCmId === weekendCmId)
  )
  const elsewhere = items.filter(
    (i) => !i.isStale && !i.candidates.some((c) => c.sessionCmId === weekendCmId)
  )

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Which weekend is this cabin for? · ${weekendLabel}`}
      size="xl"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed">
          CampMinder only stores one cabin per household or person per year, so when a party is
          booked into more than one weekend it can&rsquo;t say which weekend the cabin is for.{' '}
          {/*
           * ⭐ THE COPY #2650 WITHHELD. That PR avoided "confident"-adjacent
           * language about the best guess, because the only signal behind it
           * was `AttributeSession`'s `last_updated` heuristic — and the 2026
           * snapshot shows that heuristic has no per-household resolution at
           * all: 136 cabin values, seven distinct `last_updated` days, 83% of
           * them on two. §12.8 supplies the board comparison that was missing,
           * so the explanation can now say what the guess is made of instead
           * of hedging around it.
           */}
          The best guess compares the cabin against what each weekend&rsquo;s board already holds
          &mdash; a weekend where it is already taken is demoted.
        </p>

        {here.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            Nothing waiting on this weekend.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {here.map((item) => {
              const party = householdParties.get(item.householdCmId)
              return (
                <SessionAttributionRow
                  key={item.id}
                  item={item}
                  isConfirming={isConfirming}
                  onConfirm={(sessionCmId) => {
                    confirm(item, sessionCmId)
                  }}
                  familyName={party ? partyFamilyLabel(party) : undefined}
                  onOpenFamily={
                    party !== undefined && onOpenFamily !== undefined
                      ? () => {
                          onOpenFamily(party)
                        }
                      : undefined
                  }
                />
              )
            })}
          </div>
        )}

        {elsewhere.length > 0 && (
          <div className="border-border/50 mt-1 border-t pt-4">
            <p className={LABEL}>Also waiting, for other weekends</p>
            <div className="flex flex-wrap gap-2">
              {elsewhere.map((item) => (
                <span key={item.id} className={MUTED_PILL}>
                  {item.rawValue} · {item.candidates.map((c) => c.short).join('/')}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="border-border/50 flex flex-wrap items-center gap-2 border-t pt-4">
          <Link to="/manage/lodging/attribution" onClick={onClose} className={BUTTON_SECONDARY}>
            See the full list
          </Link>
          <button type="button" onClick={onClose} className={`${BUTTON_PRIMARY} ml-auto`}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  )
}
