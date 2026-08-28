/**
 * The scenario-vs-CampMinder compare (kindred#2478 §5) — an overview, the
 * differing families, the write-in half, and a footer that says what the
 * comparison was against.
 *
 * ## It REPORTS. It does not act.
 *
 * Owner ruling §5.6, and the reason is worth keeping here so the deferral is
 * re-opened on the real argument rather than re-litigated. Two of the four
 * verdicts cannot be actioned at all: acting on `remove` — CampMinder has a
 * family placed and the scenario does not — means writing TOWARD the mirror,
 * which `api/services/lodging_write_service.py` forbids outright ("mirror
 * into draft, never back… there is still no promote/publish path, and adding
 * one is a decision, not a follow-up"). `conflict` and `add` WOULD be legal in
 * the draft direction, but a modal where half the verdicts carry a button
 * teaches staff a rule about our table permissions rather than about their
 * work. So acting is gated on the promote/publish decision, which is its own
 * issue and its own owner call; `PushDecisionDeck` is what would be reused if
 * and when that lands. There is no mutation in this file and no write call
 * behind `fetchScenarioCompare`.
 *
 * ## Both-unassigned is counted apart from a placed match
 *
 * §5.4. Agreement on a cabin and agreement that nobody has been given one are
 * two different kinds of agreement, and one green number over the pair hides a
 * scenario nobody has worked. The server splits the count; this screen renders
 * five tiles over four verdicts and never sums the pair back together.
 *
 * ## The footer states the mirror's age, and that is not decoration
 *
 * The comparison is against `lodging_assignments` — our CampMinder mirror,
 * refreshed by the daily transform — never against the CampMinder API. Without
 * the age on screen, staff read a stale diff as a live one. The age is the
 * `lodging_assignments` sync's own `end_time`, the same number §4's "Housing
 * synced" line reads.
 *
 * ⚠️ NO REFRESH CONTROL, deliberately. §5.4 wanted the footer to offer
 * `Refresh Housing`; that button does not exist yet — its own item shipped the
 * freshness lines and HELD the button on a backend blocker — and a refresh
 * affordance here would be the second place to build it. The footer states the
 * age and stops there until that button lands.
 *
 * ## THE BOARD NAMES THE PLACEMENTS, not the roster

Owner ruling, 2026-08-28: "take the board's state label ... if staff splits
[a house] on the board and reopens the modal, it should reflect the board
state. right now board is the authority, roster tab has been neglected
intentionally for a while." (The ruling named a real house; the bracket keeps
`verify-no-hardcoded-lodging.sh` happy without rewording the owner.)

`ComparePartyReport.*_unit_label` is `RosterParty.unit_name`, a pure function of
the assignment row's arity -- one unit gives that unit's name, 2+ gives them
joined. A family holding all of a combined house therefore arrived as `Delta 1
+ Delta 2` while the board it describes draws ONE card headed `Delta House`.
The label's own docstring gives the reason it is republished at all --
"so the modal never rebuilds a name from codes and shows staff something the
board does not" -- and that is an argument FOR taking the board's answer, not
against it.

So the name goes through `boardPlacementNamer`, the board's own roll-up
(`cardCodeResolver`), fed from `useWeekendRoster` under the SAME query key the
board renders from: in the page it is a cache hit on the board's own document,
which is what makes "what the board shows" a fact rather than a re-derivation.
It follows `is_combined`, so a split renames the placement to its rooms and a
merge renames it back, and `useUnitMerge` already invalidates that key through
`invalidateLodgingRegistryQueries`. `*_unit_label` stays as the FALLBACK for a
cold open or a code the registry has never heard of.

⚠️ BOTH SIDES ARE NAMED AT THE SCENARIO'S DRAW LEVEL, deliberately -- the
mirror's placement is spelled in the vocabulary of the board staff are looking
at, because a row whose two halves used different vocabularies would read as a
move that never happened.

⚠️ THE VERDICT IS UNTOUCHED. `_placement_verdict` is exact set equality on
`unit_codes` by owner ruling, so a mirror row naming two rooms against a
scenario row naming their combined house is still a `conflict` -- and now a
conflict whose two labels both read `Delta House`. That is a question about what the
comparison MEANS, not about what it is called, and it is the owner's to answer.

## staleTime 0, opted down from the app's 30-minute default
 *
 * Same divergence and the same reason as `PushWriteInsModal`: this modal stays
 * mounted across opens (`ui/Modal`'s exit fade needs that), so there is no
 * fresh mount for `refetchOnMount: 'always'` to catch on reopen — only an
 * existing observer's `enabled` flipping true again. Under the default, a
 * reopen would keep serving the FIRST open's comparison, which defeats a
 * "check this before you trust it" screen.
 */
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { useMemo, useState } from 'react'

import { useApiWithAuth } from '../../hooks/useApiWithAuth'
import { useSyncStatusAPI } from '../../hooks/useSyncStatusAPI'
import { useWeekendRoster } from '../../hooks/useWeekendRoster'
import { fetchScenarioCompare } from '../../services/lodgingApi'
import type { CompareParty, ScenarioCompare } from '../../types/lodging'
import { displayTruncatedAge } from '../../utils/age'
import { queryKeys } from '../../utils/queryKeys'
import { QueryGuard } from '../QueryGuard'
import { Modal } from '../ui/Modal'
import { boardPlacementNamer } from './boardLayout'
import { childrenRunLabel } from './householdIdentity'
import { partyKey } from './partyKey'
import { VERDICT_TONE, type Verdict } from './verdictTone'

/**
 * The five overview buckets. `both_unassigned` is not a fifth VERDICT — it is
 * the half of `match` §5.4 rules must be counted apart — so it borrows
 * `match`'s neutral tone rather than claiming a colour of its own.
 */
type CountBucket = 'match' | 'both_unassigned' | 'conflict' | 'add' | 'remove'

/**
 * One classified write-in building, taken off the compare payload rather than
 * off `lodgingApi`'s hand-written `PushBuildingReport`. Same rows either way,
 * but the payload's own generated type is the one the server actually sends,
 * and the two spell `note` differently (required vs. optional).
 */
type CompareWriteIn = NonNullable<ScenarioCompare['write_ins']>[number]

const BUCKET_META: Record<CountBucket, { label: string; tone: string }> = {
  match: { label: 'Same cabin', tone: VERDICT_TONE.match },
  both_unassigned: { label: 'Both unassigned', tone: VERDICT_TONE.match },
  conflict: { label: 'Different cabin', tone: VERDICT_TONE.conflict },
  add: { label: 'Only in this plan', tone: VERDICT_TONE.add },
  remove: { label: 'Only in CampMinder', tone: VERDICT_TONE.remove },
}

const BUCKET_ORDER: readonly CountBucket[] = [
  'match',
  'both_unassigned',
  'conflict',
  'add',
  'remove',
]

/**
 * What a differing row is CALLED. Names the direction rather than the action,
 * because there is no action: "Only in this plan" is a statement about the two
 * boards, where "Will add" would be a promise this screen cannot keep.
 */
const ROW_LABEL: Record<Verdict, string> = {
  match: 'Same cabin',
  conflict: 'Different cabin',
  add: 'Only in this plan',
  remove: 'Only in CampMinder',
}

function CountTile({ bucket, value }: { bucket: CountBucket; value: number }) {
  const meta = BUCKET_META[bucket]
  return (
    <div
      data-testid={`compare-tile-${bucket}`}
      className={`flex flex-col gap-1 rounded-2xl border-2 p-3 ${meta.tone}`}
    >
      <span className="text-xs font-bold tracking-wider uppercase opacity-80">{meta.label}</span>
      <span className="text-xl font-bold tabular-nums">{value}</span>
    </div>
  )
}

/** "—" for a side that holds nobody, so an empty cell never reads as a name
 * that failed to render. */
function UnitLabel({ label }: { label: string }) {
  return label === '' ? (
    <span className="text-muted-foreground">&mdash;</span>
  ) : (
    <span className="font-semibold">{label}</span>
  )
}

/**
 * What a row CALLS a family: its children, exactly as the board calls it.
 *
 * `FamilyCard`'s bold line is the children's run and `display_name` is only
 * the fallback beneath it, because CampMinder's mailing title ("The Okafor
 * Family") is not what staff are looking for when they scan a list -- the
 * children are, and the ages are what a housing decision turns on. A compare
 * that named families a second way would be the same drift `childrenRun`
 * exists to prevent (kindred#2072), so this goes through the shared helper
 * rather than reproducing its ordering, its age format or its lifted surname.
 *
 * `childrenRunLabel` rather than `childrenRun`: that is the text form, built
 * from the SAME segments the card renders as elements, and its own docstring
 * names this case ("the card wants one element per child and the modal wants
 * text"). `displayTruncatedAge` matches the card's bold line -- whole years,
 * because that is the granularity a similar-ages match is made on.
 *
 * Empty means no children on file, which is the signal the helper documents
 * for falling back: an adult-grain guest has none by construction, and a
 * household whose roster row failed to resolve has none either.
 */
function partyLabel(party: CompareParty): string {
  const run = childrenRunLabel(party.children ?? [], displayTruncatedAge)
  // `?? ''` on the fallback, not `||`: `display_name` is optional on the
  // generated type (the server defaults it to ""), and the server-side
  // `_household_display_name` has its own fallback, so an absent one here is
  // a wire-shape artifact rather than a party with no name.
  return run === '' ? (party.display_name ?? '') : run
}

/**
 * One side's placement, as the BOARD names it, falling back to the roster's own
 * label. See the module doc's "THE BOARD NAMES THE PLACEMENTS" section.
 *
 * The empty-codes case returns "" BEFORE asking the board, and the two are not
 * the same "": no codes is genuinely unplaced -- `UnitLabel`'s em-dash -- where
 * an empty answer from the namer means the registry could not place the codes
 * and the roster's label is the better thing to show.
 */
function sideLabel(
  codes: readonly string[] | undefined,
  rosterLabel: string | undefined,
  nameOnBoard: (codes: readonly string[]) => string
): string {
  const named = codes ?? []
  if (named.length === 0) return ''
  return nameOnBoard(named) || (rosterLabel ?? '')
}

/**
 * AN ARROW MEANS THE TWO SIDES DIFFER, so a `match` does not get one.
 *
 * A match rendered `Alpha 1 -> Alpha 1 · Same cabin`, pointing an arrow at
 * itself and spending the row's width restating the pill. Agreement on a unit
 * IS what the verdict means, so the row states the unit once and lets the pill
 * carry the rest. `scenario || mirror` picks the side that has it, the same way
 * `WriteInRow` below picks `draft || live` -- on a match the two are the same
 * unit set by construction, and when neither side placed the family both are
 * "" and `UnitLabel`'s em-dash stands in, under a `Both unassigned` pill.
 *
 * `add` and `remove` KEEP the arrow, and that is not an inconsistency: their
 * em-dash is the half of the comparison holding nobody, and it only reads as an
 * absence next to the side that does.
 */
function PartyRow({
  party,
  testId,
  nameOnBoard,
}: {
  party: CompareParty
  testId: string
  nameOnBoard: (codes: readonly string[]) => string
}) {
  const verdict = party.cls
  const scenario = sideLabel(party.scenario_unit_codes, party.scenario_unit_label, nameOnBoard)
  const mirror = sideLabel(party.mirror_unit_codes, party.mirror_unit_label, nameOnBoard)
  return (
    <div
      data-testid={testId}
      className="border-border/60 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b py-2 last:border-b-0"
    >
      <span className="min-w-48 flex-1 text-sm font-semibold">{partyLabel(party)}</span>
      <span className="flex items-baseline gap-2 text-sm">
        {verdict === 'match' ? (
          <UnitLabel label={scenario || mirror} />
        ) : (
          <>
            <UnitLabel label={scenario} />
            <span className="text-muted-foreground">&rarr;</span>
            <UnitLabel label={mirror} />
          </>
        )}
      </span>
      <span
        className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${VERDICT_TONE[verdict]}`}
      >
        {party.both_unassigned === true ? 'Both unassigned' : ROW_LABEL[verdict]}
      </span>
    </div>
  )
}

/**
 * The write-in half, straight from `preview_push` (§5.4). It costs nothing to
 * build and can never disagree with the Push Write-Ins review screen, because
 * it is literally the same classifier over the same rows — which is the whole
 * reason it is here rather than a second diff of our own.
 */
/**
 * One write-in building's occupants, as text.
 *
 * WHICH SIDE depends on the verdict, the same way `PushWriteInsModal`'s
 * `tileSummaryLines` picks one: an `add` exists only in the scenario's draft, a
 * `remove` only on the live board, and a `match` is the same row either way. A
 * `conflict` is the only one with two answers, so it is the only one that
 * renders an arrow.
 *
 * That is the SAME rule `PartyRow` follows on a match -- neither half points an
 * arrow at itself. The two part company on `add`/`remove`: a family row still
 * arrows to an em-dash there, because the unit is the thing being compared and
 * the absence has to be shown; a write-in already carries its building in its
 * own column, so the occupants have nothing to be absent from.
 *
 * `party_size` is OMITTED when null rather than printed as 0: null means
 * "occupies wholesale, never zero" (kindred#2540), and a 0 on screen would be a
 * fact the board declined to state.
 */
function occupantsOf(rows: NonNullable<CompareWriteIn['draft']>): string {
  return rows
    .map((row) =>
      row.party_size == null
        ? row.occupant_name
        : `${row.occupant_name} (${String(row.party_size)})`
    )
    .filter((text) => text !== '')
    .join(' · ')
}

function WriteInRow({ building }: { building: CompareWriteIn }) {
  const draft = occupantsOf(building.draft ?? [])
  const live = occupantsOf(building.live ?? [])
  return (
    <div
      data-testid="compare-write-in-row"
      className="border-border/60 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b py-2 last:border-b-0"
    >
      {/* The OCCUPANTS lead, where a family row carries the family. A cabin
          name on its own says nothing: "Gamma 1 — Only in this plan" does not
          tell staff who the scenario put there. */}
      <span className="min-w-48 flex-1 text-sm font-semibold">
        {building.cls === 'conflict' && draft !== '' && live !== '' ? (
          <>
            {draft} <span className="text-muted-foreground font-normal">&rarr;</span> {live}
          </>
        ) : (
          draft || live || <span className="text-muted-foreground">&mdash;</span>
        )}
      </span>
      <span className="text-sm">{building.label}</span>
      <span
        className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${VERDICT_TONE[building.cls]}`}
      >
        {ROW_LABEL[building.cls]}
      </span>
    </div>
  )
}

/**
 * The write-in half, straight from `preview_push` (kindred#2478 section 5.4).
 * It costs nothing to build and can never disagree with the Push Write-Ins
 * review screen, because it is literally the same classifier over the same
 * rows.
 *
 * MATCHING BUILDINGS COLLAPSE, exactly as matching families do above. A matched
 * write-in is agreement, and a screen whose job is to surface disagreement
 * should not make you scroll past the agreement to find it.
 */
function WriteInSection({ buildings }: { buildings: readonly CompareWriteIn[] }) {
  const [showMatches, setShowMatches] = useState(false)
  if (buildings.length === 0) return null
  const differing = buildings.filter((b) => b.cls !== 'match')
  const matching = buildings.filter((b) => b.cls === 'match')
  return (
    <section data-testid="compare-write-ins" className="flex flex-col gap-2">
      <h3 className="text-muted-foreground text-xs font-bold tracking-wider uppercase">
        Write-ins
      </h3>
      {differing.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Every write-in in this plan is already on the board.
        </p>
      ) : (
        <div className="flex flex-col">
          {differing.map((building) => (
            <WriteInRow key={building.key} building={building} />
          ))}
        </div>
      )}
      {matching.length > 0 && (
        <>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground self-start text-xs font-semibold underline-offset-2 hover:underline"
            onClick={() => {
              setShowMatches((open) => !open)
            }}
          >
            {`${showMatches ? 'Hide' : 'Show'} ${String(matching.length)} matching write-in${matching.length === 1 ? '' : 's'}`}
          </button>
          {showMatches && (
            <div className="flex flex-col">
              {matching.map((building) => (
                <WriteInRow key={building.key} building={building} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function CompareFooter({ syncedAt }: { syncedAt: string | undefined }) {
  return (
    <p data-testid="compare-footer" className="text-muted-foreground text-xs">
      {syncedAt === undefined
        ? 'Compared against the CampMinder mirror — its last sync time is unknown, so anything staff changed in CampMinder may not be here yet.'
        : `Compared against the CampMinder mirror, last synced ${formatDistanceToNow(new Date(syncedAt), { addSuffix: true })}. Anything staff changed in CampMinder since then is not here yet.`}
    </p>
  )
}

function CompareScreen({
  compare,
  syncedAt,
  nameOnBoard,
}: {
  compare: ScenarioCompare
  syncedAt: string | undefined
  nameOnBoard: (codes: readonly string[]) => string
}) {
  const [showMatches, setShowMatches] = useState(false)
  const parties = compare.parties ?? []
  const counts = compare.counts ?? {}
  const differing = parties.filter((party) => party.cls !== 'match')
  const matching = parties.filter((party) => party.cls === 'match')

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {BUCKET_ORDER.map((bucket) => (
          <CountTile key={bucket} bucket={bucket} value={counts[bucket] ?? 0} />
        ))}
      </div>

      {/* THE BODY SCROLLS, NOT THE OVERLAY. A real weekend runs to a list
          taller than the viewport, and `ui/Modal`'s top-anchored wrapper is
          itself the scroll container -- so without a bound here the whole
          dialog grew past the screen and the page scrolled behind it.
          Bounding the body keeps the tiles above and the footer below in
          view, which matters most for the footer: it is the line that says
          how old the mirror is, and a stale diff read as a live one is the
          failure this screen exists to prevent. */}
      <div
        data-testid="compare-scroll"
        className="-mr-2 flex max-h-[55vh] flex-col gap-4 overflow-y-auto pr-2"
      >
        {differing.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Every family is in the same place in this plan and in CampMinder.
          </p>
        ) : (
          <section className="flex flex-col">
            {differing.map((party) => (
              <PartyRow
                key={partyKey(party)}
                party={party}
                testId="compare-difference-row"
                nameOnBoard={nameOnBoard}
              />
            ))}
          </section>
        )}

        {matching.length > 0 && (
          <section className="flex flex-col gap-2">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground self-start text-xs font-semibold underline-offset-2 hover:underline"
              onClick={() => {
                setShowMatches((open) => !open)
              }}
            >
              {`${showMatches ? 'Hide' : 'Show'} ${String(matching.length)} matching famil${matching.length === 1 ? 'y' : 'ies'}`}
            </button>
            {showMatches && (
              <div className="flex flex-col">
                {matching.map((party) => (
                  <PartyRow
                    key={partyKey(party)}
                    party={party}
                    testId="compare-match-row"
                    nameOnBoard={nameOnBoard}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        <WriteInSection buildings={compare.write_ins ?? []} />
      </div>

      <CompareFooter syncedAt={syncedAt} />
    </div>
  )
}

export interface ScenarioCompareModalProps {
  year: number
  sessionCmId: number
  scenario: string
  isOpen: boolean
  onClose: () => void
}

export function ScenarioCompareModal({
  year,
  sessionCmId,
  scenario,
  isOpen,
  onClose,
}: ScenarioCompareModalProps) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()
  // The same number §4's "Housing synced" line reads: `lodging_assignments` is
  // the transform that writes the mirror this compare is against, and it is
  // the last job of the six-job chain. Fetched only while the modal is open —
  // `useSyncStatusAPI` polls solely while a sync is running and costs nothing
  // at rest.
  // `!isAuthLoading` on BOTH reads, per `frontend/CLAUDE.md`: "useAuth().isLoading
  // first. Always check isLoading before making authenticated API calls."
  // `useApiWithAuth` reads `pb.authStore.token` at CALL time, so a query that
  // fires mid-restore sends no Authorization header; both endpoints here are
  // permission-gated, and the global 401 handler would clear auth and bounce
  // the user to /login out of a modal they had just opened.
  const ready = isOpen && !isAuthLoading
  const { data: syncStatus } = useSyncStatusAPI({ enabled: ready })
  const syncedAt = syncStatus?.lodging_assignments.end_time

  // THE BOARD'S OWN DOCUMENT, under the board's own query key -- see the module
  // doc. `sessionCmId` goes null until the modal is open so a closed modal
  // never fetches; on the weekend page the board already holds this entry, so
  // opening costs a cache read rather than `build_roster`'s eleven fetches.
  const { data: roster } = useWeekendRoster(year, ready ? sessionCmId : null, scenario)
  // `?? []` INSIDE the memo (frontend/CLAUDE.md): a bare one mints a new array
  // every render and defeats the dependency list.
  const nameOnBoard = useMemo(() => boardPlacementNamer(roster?.units ?? []), [roster])

  const query = useQuery<ScenarioCompare>({
    queryKey: queryKeys.scenarioCompare(year, sessionCmId, scenario),
    queryFn: () => fetchScenarioCompare(fetchWithAuth, { year, sessionCmId, scenario }),
    enabled: ready,
    // See the module doc's staleTime section: this modal stays mounted, so
    // `refetchOnMount` alone cannot make a reopen re-ask.
    staleTime: 0,
    refetchOnMount: 'always',
  })

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Compare with CampMinder"
      size="xl"
      // `top` for the same defect `PushWriteInsModal` cites: the disclosure
      // changes the content's height, and a centred card would re-centre the
      // tiles and the whole differing list under the cursor that opened it.
      anchor="top"
    >
      <QueryGuard<ScenarioCompare>
        isLoading={query.isPending}
        error={query.error}
        data={query.data}
        label="comparison"
      >
        {(compare) => (
          <CompareScreen compare={compare} syncedAt={syncedAt} nameOnBoard={nameOnBoard} />
        )}
      </QueryGuard>
    </Modal>
  )
}

export default ScenarioCompareModal
