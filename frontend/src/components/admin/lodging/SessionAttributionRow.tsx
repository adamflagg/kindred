/**
 * One row of the cabin-weekend attribution queue (kindred#2648 UI half).
 *
 * Shared by the admin queue tab (the always-accessible home) and the board's
 * stats-bar chip modal — `useSessionAttributionQueue` fetches once, this
 * renders it twice. Style matches `UnresolvedAliasQueue.tsx` row-for-row:
 * `card-lodge flex flex-col gap-3 p-4`, mono raw value, an action row.
 *
 * ⛔ NO CHANGE-WEEKEND AFFORDANCE, DELIBERATELY. Confirming is one-time: the
 * backend materialises a NEW `lodging_assignments` row on the false -> true
 * `is_resolved` transition (`replayOnResolve`), not an update to whatever a
 * party's confirmed weekend used to be, so re-confirming a different weekend
 * would put a household in two cabins rather than moving it. Whether a
 * re-confirmation may ever delete a `staff_touched` row to make room is an
 * open owner decision (kindred#2648) — until it is ruled, this row offers no
 * "Undo" and no "Change weekend". A resolved row never reaches this
 * component anyway: `useSessionAttributionQueue` reads only
 * `is_resolved = false` rows, so once a confirm lands the row simply stops
 * being fetched.
 *
 * ⭐ OCCUPANCY EVIDENCE (§12.8 of the round-2 triage-attack plan, owner-ruled
 * 2026-08-31; closes no issue and none is filed). Each candidate card carries
 * an evidence line saying whether the cabin is already occupied that weekend
 * and by whom — TREATMENT A, so the card's own chrome is unchanged and all
 * three verdicts draw, *"for the sake of visual uniformity and information."*
 * Two banners sit above the card: one naming both weekends when a conflict
 * moved the best guess, and one alarm about the cabin VALUE when every
 * candidate conflicts.
 *
 * ⛔ NOTHING HERE CLASSIFIES ANYTHING. The verdicts, the occupants and the
 * conflict-aware suggestion all arrive computed from
 * `GET /api/lodging/attribution/conflicts`; see `attributionEvidence.ts`.
 *
 * ⚠️ A CONFLICT NEVER BLOCKS CONFIRMATION (§12.8.3, adopted default). The
 * conflicted card's confirm button is DIMMED and still clickable: the rule is
 * evidence for staff, not a gate, and a cabin genuinely can be double-booked.
 */
import {
  ATTRIBUTION_BANNER,
  ATTRIBUTION_BANNER_ALARM,
  ATTRIBUTION_BANNER_MOVE,
  ATTRIBUTION_VERDICT_CLASS,
  EVIDENCE_LINE,
  occupantClause,
} from './attributionEvidence'
import { LABEL, MUTED_PILL, PILL } from './lodgingStyles'
import type {
  SessionAttributionCandidate,
  SessionAttributionQueueItem,
} from '../../../hooks/useSessionAttributionQueue'

// Named CANDIDATE_*, not BUTTON_PRIMARY/BUTTON_SECONDARY: those names are
// lodgingStyles.ts's own exports (px-4 py-2 text-sm), which this file already
// imports LABEL/MUTED_PILL/PILL from. Reusing the identifiers here for a
// deliberately denser px-3 py-1.5 text-xs variant (these buttons sit inside a
// 2-column grid of small candidate cards) would shadow the shared module's
// definition with a same-named, different-value local — exactly the "six
// dialects" drift that module's own header comment warns against.
const CANDIDATE_BUTTON_PRIMARY =
  'bg-primary text-primary-foreground shadow-lodge-sm inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-50'
const CANDIDATE_BUTTON_SECONDARY =
  'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50'

export interface SessionAttributionRowProps {
  item: SessionAttributionQueueItem
  onConfirm: (sessionCmId: number) => void
  isConfirming: boolean
  /**
   * The household's resolved family name (kindred#2650 owner finding: a raw
   * `Household 2000001` tells staff nothing). Undefined or blank falls back
   * to the raw id — a poor id still beats a blank row, and a household with
   * no resolvable name is exactly the kind of row staff most need to see.
   *
   * Deliberately a plain string, not a resolver function or a hook: the two
   * homes resolve it through entirely different data (the board's already-
   * loaded roster vs. the admin tab's own per-household fetch), and handing
   * down the ALREADY-RESOLVED value keeps this component ignorant of both.
   * Never applies to a person-scoped row (an adult-weekend guest) — see
   * `useSessionAttributionQueue`'s "exactly one id is ever set" comment.
   */
  familyName?: string | undefined
  /**
   * Opens the household's full detail surface (`FamilyDetailsPanel`,
   * kindred#2073's "see members" precedent) when the name is clicked.
   * Omitted renders the name as plain text — the admin tab has no roster
   * party to hand the panel, so it passes nothing here rather than wiring a
   * click that goes nowhere (a dead click is worse than no click).
   */
  onOpenFamily?: ((householdCmId: number) => void) | undefined
}

export function SessionAttributionRow({
  item,
  onConfirm,
  isConfirming,
  familyName,
  onOpenFamily,
}: SessionAttributionRowProps) {
  // Exactly one of the two ids is ever set, as everywhere else in this
  // ingest — see `lodging_confirmed_session.go`'s `forParty`.
  const isHousehold = item.householdCmId > 0
  const resolvedName = familyName?.trim() ?? ''
  const partyLabel = isHousehold
    ? resolvedName.length > 0
      ? resolvedName
      : `Household ${String(item.householdCmId)}`
    : `Person ${String(item.personCmId)}`
  const canOpenFamily = isHousehold && onOpenFamily !== undefined

  // What staff would go and check. The alias-resolved name when it resolved,
  // the raw CampMinder string otherwise — the client's alias query can fail
  // independently of the evidence fetch, and a banner about a blank cabin is
  // worse than one about a string.
  const cabinLabel =
    item.resolvedUnitNames.length > 0 ? item.resolvedUnitNames.join(' + ') : item.rawValue
  const alarm = item.conflictInEveryCandidate === true
  const demotion = item.demotion

  return (
    <div className="flex flex-col gap-3">
      {alarm && (
        /*
         * THE ALARM POINTS AT THE VALUE, NOT AT A WEEKEND, and it demotes
         * nothing. If the cabin is taken in every weekend the party could be
         * in, moving the guess would move it onto a weekend the rule has just
         * called wrong; the likely explanation is that the string CampMinder
         * holds is out of date, which is a thing staff can go and check.
         *
         * "this party", not the mock's "this family": a queue row is filed at
         * household grain for family camp and at PERSON grain for an adult
         * weekend, and this component renders both.
         */
        <p className={`${ATTRIBUTION_BANNER} ${ATTRIBUTION_BANNER_ALARM}`}>
          ⚠ <strong>{cabinLabel}</strong> is occupied in <strong>every</strong> weekend this party
          attends — so no weekend is a safe guess. That usually means the cabin CampMinder has
          recorded is out of date. Check the value before confirming.
        </p>
      )}
      {!alarm && demotion !== undefined && (
        /*
         * BOTH WEEKENDS ARE NAMED. `suggested_session` in PocketBase still
         * holds the date heuristic's answer and nothing in Go moves, so a row
         * that quietly pointed somewhere else would disagree with its own
         * record. Saying which weekend the date pointed at, and why the guess
         * left it, is the whole reason the endpoint publishes both.
         */
        <p className={`${ATTRIBUTION_BANNER} ${ATTRIBUTION_BANNER_MOVE}`}>
          Best guess moved to <strong>{demotion.toShort}</strong>. The date on the CampMinder value
          points at {demotion.fromShort}, but <strong>{cabinLabel}</strong> is already taken that
          weekend.
        </p>
      )}
      <div className="card-lodge flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className={`${LABEL} mb-0.5`}>CampMinder says</p>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-foreground font-mono text-sm font-semibold">{item.rawValue}</p>
              {item.isStale && (
                <span className={`bg-muted text-muted-foreground ${PILL}`}>outdated</span>
              )}
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              {canOpenFamily ? (
                <button
                  type="button"
                  onClick={() => {
                    onOpenFamily?.(item.householdCmId)
                  }}
                  className="text-foreground font-semibold underline-offset-2 hover:underline"
                >
                  {partyLabel}
                </button>
              ) : (
                partyLabel
              )}{' '}
              · seen {item.occurrences}× · last checked {item.lastSeen}
            </p>
          </div>
          <div className="text-right">
            <p className={`${LABEL} mb-0.5`}>Cabin</p>
            <p className="font-mono text-xs">
              {item.resolvedUnitNames.length > 0 ? (
                item.resolvedUnitNames.join(' + ')
              ) : (
                <span className="text-muted-foreground italic">not recognized yet</span>
              )}
            </p>
          </div>
        </div>

        {item.isStale && (
          <p className="rounded-xl border-2 border-slate-300 bg-slate-50 p-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-200">
            Out of date — a more recent CampMinder sync no longer shows this value for {partyLabel}.
          </p>
        )}

        <div>
          <p className={LABEL}>
            Which weekend could this be? (only weekends this party is attending)
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {item.candidates.map((candidate) => (
              <div
                key={candidate.sessionCmId}
                // Test infrastructure and nothing else — the suite has no other
                // handle on which card is which verdict. The CLASS list is
                // deliberately identical across all three (Treatment A): the
                // rejected Treatment B tinted the card itself.
                data-verdict={candidate.verdict}
                className="border-border rounded-xl border p-2"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{candidate.short}</p>
                  {candidate.isSuggested && (
                    <span
                      className={`bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300 ${PILL}`}
                    >
                      best guess
                    </span>
                  )}
                </div>
                {candidate.dateRange !== '' && (
                  <p className="text-muted-foreground text-xs">{candidate.dateRange}</p>
                )}
                <EvidenceLine candidate={candidate} cabinLabel={cabinLabel} />
                <button
                  type="button"
                  disabled={isConfirming}
                  onClick={() => {
                    onConfirm(candidate.sessionCmId)
                  }}
                  // DIMMED, NEVER DISABLED. A conflict is evidence, not a gate.
                  className={`${candidate.isSuggested ? CANDIDATE_BUTTON_PRIMARY : CANDIDATE_BUTTON_SECONDARY} mt-2 w-full justify-center${candidate.verdict === 'conflict' ? 'opacity-45' : ''}`}
                >
                  This is {candidate.short}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/*
           * No onClick — deliberately inert. "I don't know yet" is the honest
           * answer for a row with no evidence, and the queue already gives it
           * for free: leaving a row unconfirmed does nothing and keeps it here
           * until staff are ready. There is no dismiss write for a party-scoped
           * row that would not immediately bounce back — `replayOnResolve`
           * re-runs attribution on any resolve, finds the same two-or-more
           * candidates, and re-opens the row (see that hook's own doc comment).
           * This button exists so the option reads as offered, not missing.
           */}
          <button type="button" className={MUTED_PILL}>
            I don&rsquo;t know yet
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The evidence line inside one candidate card — Treatment A.
 *
 * ALL THREE VERDICTS DRAW, in the same box, differing only in colour: owner
 * ruling 6, *"for the sake of visual uniformity and information."* Treatment C
 * drew conflicts only and was not chosen.
 *
 * ⚠️ `no_data` IS WORDED AS "NO PLACEMENTS", never as "empty". It means the
 * weekend has no placements at all — six of the eight live 2026 queue rows have
 * such a candidate, and one of those weekends carries three write-ins. A
 * weekend with write-ins and no placements is not empty; calling it that would
 * report an absence of PLANNING as a fact about the cabin.
 *
 * Nothing draws until the evidence has loaded. The verdict is absent while the
 * uncached conflicts query is in flight and after it fails, and an absent
 * verdict is not a verdict.
 */
function EvidenceLine({
  candidate,
  cabinLabel,
}: {
  candidate: SessionAttributionCandidate
  cabinLabel: string
}) {
  const verdict = candidate.verdict
  if (verdict === undefined) return null

  const occupants = candidate.occupants ?? []
  let content
  if (verdict === 'conflict') {
    content = (
      <>
        ⛔ <strong>Taken.</strong>{' '}
        {occupants.length > 0
          ? `${occupants.map(occupantClause).join(' · ')}.`
          : // Arm 1 of the rule with nobody to name: `is_family_available` is
            // false on its own, which is what staff marking a unit unavailable
            // looks like. The verdict is still a conflict and still has to say
            // something.
            `${cabinLabel} is not available this weekend.`}
      </>
    )
  } else if (verdict === 'free') {
    content = <>✓ {cabinLabel} is free this weekend.</>
  } else {
    content = <>No placements recorded for {candidate.short} yet — nothing to compare against.</>
  }

  return (
    // `data-evidence` is a test handle, the only one the suite has for "the
    // box is the same across verdicts" — not an ARIA affordance.
    <p data-evidence className={`${EVIDENCE_LINE} ${ATTRIBUTION_VERDICT_CLASS[verdict]}`}>
      {content}
    </p>
  )
}
