/**
 * A household's cabin-sharing request, unresolved.
 *
 * NEAR and WITH are DIFFERENT requests and must never render alike: NEAR is
 * satisfied by map distance between assigned units, WITH by placing both
 * parties in the same unit. `similar_ages` ACCOMPANIES `with` rather than
 * replacing it — showing one or the other would drop those households out of
 * any "wants to share a cabin" view.
 *
 * The structured half is READ from ingest-derived columns. Nothing is
 * re-parsed from the raw share/modes answers: the Go normaliser carries fixes
 * this layer would lose, most importantly the guard that stops the modes
 * field's own "No requests" option reading as a hard decline.
 *
 * ## Up to eight labelled rows, the same grammar as `HousingNeedDetails`' list
 *
 * Two choice rows (the radio, the checkboxes) plus up to six free-text note
 * rows, one per `REQUEST_TEXT_SOURCES` entry (`api/services/lodging_rules.py`)
 * that actually carries text. "Five labelled rows" was this section's count
 * under an earlier, reverted design that fixed the note rows at three; it is
 * not a ceiling any more.
 *
 * The owner's approved mockup (2026-08-27, share-request rework) supersedes
 * the board-style chip row this panel briefly shipped with: the section is
 * now one `<ul>` of rows, each an icon chip, a bold label and — when there is
 * text — an indented paragraph under it, the SAME grammar
 * `HousingNeedDetails` already uses for housing needs. `SharePreferenceChip`
 * and the local `PROXIMITY` chip map were removed one rework ago; this pass
 * removes the board-style Tooltip/capsule-row treatment that replaced them,
 * because it never matched what the owner actually wanted here.
 *
 * Icons, colours, wording and order for the radio and the checkboxes are
 * still entirely owned by `shareMarks.ts` — `resolveShareAnchor` (row 1) and
 * `resolveShareCluster` (row 2) — this file only draws the row markup. The
 * one addition `shareMarks.ts` picked up for this rework is additive:
 * `ShareAnchorSpec.label`, the anchor's bare state wording
 * (`"Yes, Share Cabin"` etc.), read once rather than restated here — see that
 * module's header comment.
 *
 * Both resolvers gate on `party.grain !== 'household'` (an adult weekend has
 * no share question), which is why this component takes `party` rather than
 * `share` — computing the anchor/cluster in each caller and passing the
 * results down would move that gate into two places and let them drift. Both
 * callers (`FamilyDetailsPanel`, `HouseholdRosterRow`) already hold `party`.
 * A household whose payload omits the `share` block entirely still falls
 * back to `NO_SHARE_REQUEST` for the rest of this component's own logic
 * (fold state, the free-text blocks below) — only the anchor/cluster read
 * `party` directly, per `shareMarks.ts`'s own null/empty handling.
 *
 * ## The free-text half is SPLIT, per source field and per child
 *
 * It used to arrive pre-joined and was never split, and that was the defect
 * kindred#2330 fixed. `family_camp_registrations.request_text` concatenates
 * several distinct source fields with `'; '` and keeps no field boundary, and
 * 10 of 422 non-blank 2026 values contain that separator themselves — so no
 * client-side split was ever possible, and staff could not tell which form,
 * or which child, produced which sentence.
 *
 * The server now sends `request_blocks` alongside: one block per source
 * field, one entry per distinct answer, every contributing child named.
 * `request_text` stays on the wire for `HouseholdRosterTable`, and is the
 * fallback below if blocks ever come back empty against a non-empty join —
 * losing a family's ask is worse than losing its provenance.
 *
 * ## A CHOICE and a NOTE are two different facts — owner ruling 2026-08-27,
 * correcting a defect one rework introduced
 *
 * An earlier pass on this file lifted `Shared-request` and `COVID-19 Bunking
 * Requests` out of the fold loop to PAIR their text under the radio/checkbox
 * rows, and then tried composing one merged label for the result. Both
 * shipped and both were wrong: merging a free-text note into a choice row is
 * what let the SAME field (`COVID-19 Bunking Requests`) render under two
 * different labels depending on an unrelated tick — 202 of 260 real
 * households by the ticked marks' shorthand, 58 by the field's friendly name
 * — and the composed-label fix that followed still merged the two facts into
 * one row, which the owner found confusing to read. The ruling that stands:
 * a SELECT's answer and a FREE-TEXT note are different facts, and each gets
 * its own row. Never merge a note into a choice row again.
 *
 * 202/260/58 above is the PRODUCTION figure — `pocketbase/pb_data/data-prod.db`,
 * not the sibling `data.db` (dev), a known trap — scoped exactly as the spec
 * defines the cohort: `attendees.status_id = 2`, `camp_sessions.session_type
 * = 'family'`, year 2026, 392 households. 260 of them carry
 * `COVID-19 Bunking Requests` text; 202 with at least one multiselect tick,
 * 58 with none. Re-derive against `data-prod.db` with that same scope if
 * these numbers ever need checking again — a dev-DB measurement is not this
 * repo's convention for a comment that ships.
 *
 * Rows 1-2 are the two SELECTS, and carry NO text underneath, ever:
 *
 *   - Row 1, the radio (`resolveShareAnchor`) — always renders for a
 *     household-grain party, labelled with the anchor's own state wording
 *     (`ShareAnchorSpec.label` — "Yes, Share Cabin", "Don't Share Cabin", …).
 *   - Row 2, the checkboxes (`resolveShareCluster`) — renders ONLY when at
 *     least one mark is ticked, labelled with the ticked marks' shorthands
 *     joined `' · '` (`ShareClusterMark.ariaLabel`). With nothing ticked
 *     there is nothing to show — no fallback icon, no fallback label; the
 *     row simply does not render.
 *
 * `Shared-request` and `COVID-19 Bunking Requests` are ordinary NOTES now,
 * flowing through the SAME fold loop as the other four source fields, under
 * their own `DISPLAY_LABELS` names ("Reg Form Bunk Notes", "Fam Info Form
 * Bunk Notes") — no special-casing, no filtering out of the block list.
 * Server order (`REQUEST_TEXT_SOURCES`, `api/services/lodging_rules.py`)
 * already puts them first, so this file does not re-sort anything.
 *
 * ⚠️ ONE BEHAVIOUR CHANGE, AND IT IS INTENDED: `Shared-request` used to be
 * hard-gated to `preference` being `yes_share`/`maybe_mutual` — rule 3 in
 * `shareMarks.ts`, "a value on no/unanswered is data drift, not a case to
 * render". That gate does NOT transfer here — settled by the owner, not
 * inferred: rule 3 is BOARD-tooltip-scoped, conflating the two fields was an
 * artifact of how the board's tooltips happened to be built, and a
 * standalone labelled row in this panel was never the case rule 3 was
 * written to cover. Appending a request to a compact mark that says "won't
 * share" is self-contradictory on that ONE glyph; a free-text row under its
 * own field label contradicts nothing. `shareMarks.ts`'s own rule 3 is
 * untouched and still governs `resolveShareAnchor`'s tooltip; only this
 * panel stopped applying it to itself. Measured before this ruling: 102
 * rostered 2026 households carried `Shared-request` text, 101 with the radio
 * at yes/maybe and exactly 1 hidden by the gate regardless — that one
 * family's actual written request is what this change surfaces.
 *
 * Also confirmed, not assumed: the no-empty-row principle ("a source field
 * with no text renders NOTHING") still holds for these two fields now that
 * the `show*Text` flags that used to enforce it are gone. `withText` (below)
 * drops any block whose entries are all blank before the fold loop ever
 * sees it, uniformly across all six source fields — a household with no
 * `Shared-request` text gets no `Reg Form Bunk Notes` row at all, not an
 * empty one. Pinned in `ShareRequestPanel.test.tsx`.
 *
 * Layout for the free-text rows (all six source fields, now uniform) is the
 * owner's 2026-08-17 ruling, a hybrid of two mockup options: blocks start
 * EXPANDED, because a scanning eye must not miss request text, and each is
 * COLLAPSIBLE, because 9 of 382 rostered 2026 households render four blocks
 * and one renders seven entries inside them. The expectation was explicitly
 * that this would ship and get tuned against real staff use.
 *
 * kindred#2476 (owner ruling 2026-08-21) is that tuning: `Share Bunk With`
 * now starts COLLAPSED — see `DEFAULT_FOLDED` below — while every other
 * block keeps the 2026-08-17 default. It also moves to the LAST block
 * server-side (`REQUEST_TEXT_SOURCES`, `api/services/lodging_rules.py`), by
 * staff request rather than by volume: on 2026 family-camp households it is
 * the second most populated of the six.
 *
 * Labels are the ORIGINAL CampMinder field names, verbatim, UNLESS THE OWNER
 * NAMED ONE. That was the 2026-08-17 ruling — "call them the original
 * fieldnames for now until staff can weigh in after it's live" — and staff
 * have since weighed in on three of the six, so `DISPLAY_LABELS` below is the
 * whole list of exceptions and the other three keep the raw CampMinder
 * spelling. Do not "improve" a label that is not already in that map.
 *
 * Each row — the two choice rows, and every free-text note — carries a small
 * circular icon chip and a bold label. Every NOTE row additionally carries,
 * pushed to the row's right edge, a chevron that rotates 90° open rather
 * than swapping icons, per the mockup. The choice rows have no chevron
 * (there is nothing to fold); only the note rows do.
 *
 * ## One treatment — the row grammar, not a rail
 *
 * This section used to inherit the camper details panel's amber blockquote
 * for every entry, reasoning that a request should read the same wherever
 * staff meet one. The owner's approved mockup supersedes that reasoning here:
 * every text in this section is now plain, indented, italic prose under its
 * row's label — no border, no background, no "quoted" treatment at all. The
 * owner looked at the live panel and named the amber rail itself as the
 * defect, not merely its colour (a grey variant for the two staff fields was
 * tried and reverted for the same underlying complaint before this rework).
 * The ONE thing carried forward is that staff- and family-authored text still
 * render identically — nothing here paints by `authorship` — because that
 * distinction is a permission gate, not a colour: `block.authorship` still
 * decides whether `/lodging/roster` sends a staff block to this client at
 * all (`_may_read_staff_notes`, api/routers/lodging.py), and it is still
 * surfaced as `data-authorship` below, plus a small "Staff" tag on the row.
 *
 * A source field with no text renders NOTHING — no "nothing applicable"
 * clutter, composing with kindred#2255's chip ruling in this same modal.
 *
 * ## No permission gate on a FAMILY's own request text
 *
 * `request_text` and the family-authored blocks built from the same answers
 * have no permission check at all, while `HousingNeedDetails` (rendered
 * beside them in `FamilyDetailsPanel`) is gated on `bunking.manage`. The
 * split is intentional: request text is a placement input — why a household
 * wants a particular cabin or setting is a legitimate placement concern for
 * any authenticated user to see, the same way the rest of the roster is. It
 * is free text a household wrote about where it wants to sleep, not the
 * structured medical questionnaire, even though it sometimes contains health
 * detail. `HousingNeedDetails` covers that questionnaire, and that one is
 * screen-reduced behind `bunking.manage` (kindred#2312: it used to be a
 * separate `lodging.phi` permission, removed because RBAC here is
 * screen-reduction, not a data boundary, and every sibling endpoint on the
 * lodging router already gated on `bunking.manage`). One permission decides
 * both answers; the two fields simply get different answers from it.
 *
 * The TWO STAFF-AUTHORED blocks get the gated answer, and this component does
 * not implement that — the server does. `BunkingNotes Notes` and `Internal
 * Bunk Notes` are `original_bunk_requests` rows, a table PocketBase itself
 * lists behind `bunking.manage` and whose raw text every other API route
 * serves only to an admin, so `/lodging/roster` omits them for a caller
 * without it (`_may_read_staff_notes`, api/routers/lodging.py). Nothing is
 * hidden client-side: a block that arrives is a block staff may read. That
 * gate is the whole reason `authorship` still travels on the wire now that it
 * paints nothing.
 */
import {
  BedDouble,
  ChevronRight,
  Handshake,
  Lock,
  MessageSquare,
  Tent,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useState } from 'react'

import type { RequestTextBlockRow, RosterPartyRow, ShareRequest } from '../../types/lodging'
import { CAP_CLASSES, clusterCap, resolveShareAnchor, resolveShareCluster } from './shareMarks'

/** An unanswered request, used when the payload omits the block entirely. */
const NO_SHARE_REQUEST: ShareRequest = {
  preference: 'unknown',
  preference_raw: '',
  proximity: [],
  request_text: '',
  request_blocks: [],
}

/** 22px icon-chip frame (mockup `.mkic`). No rounding baked in here, mirroring `shareMarks.ts`'s own `CAP_CLASSES` split — the anchor/cluster rows supply their corner via `CAP_CLASSES`, the note rows below hardcode `rounded-full` since they are always solo. */
const ROW_ICON_FRAME = 'inline-flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center'
/** 13px icon glyph inside every row's chip (mockup `.mkic svg`). */
const MARK_ICON = 'h-[13px] w-[13px]'
/** The muted, always-solo chip for the three CSV-lane note rows (mockup `.mkic.nt`). */
const NOTE_ICON_FRAME = `${ROW_ICON_FRAME} rounded-full bg-muted text-muted-foreground`

/**
 * Every text in this section (mockup `.mksay`): plain, 30px-indented,
 * italic, `opacity-85`, no rail. `break-words` is the one addition beyond the
 * mockup's literal CSS — the longest single 2026 answer is 680 characters in
 * a 416px panel, and an unbroken token (an email address, a URL) would
 * otherwise push the panel into a horizontal scroll; `whitespace-pre-wrap`
 * keeps a family's own line breaks.
 */
const MK_SAY =
  'text-foreground pl-[30px] text-[13px] italic whitespace-pre-wrap break-words opacity-[.85]'

/** The small uppercase authorship tag on a note row (mockup `.who`). */
const WHO_TAG = 'text-muted-foreground text-[9.5px] tracking-[.07em] uppercase opacity-75'

/**
 * DISPLAY names. The key stays the CampMinder source-field identity — it is
 * what the ingest, `REQUEST_TEXT_SOURCES` and the permission gate all key on,
 * so only the right-hand side may ever be edited to change what staff read.
 * Renaming a key here would be a data change wearing a label change's clothes.
 *
 * Three entries, from two passes of the owner's 2026-08-17 review of the live
 * panel: `BunkingNotes Notes` reads as a typo, and the two general-purpose
 * fields are better named by the FORM staff meet them on than by whatever
 * CampMinder happened to call the column.
 *
 * ⚠️ THE FORM ATTRIBUTION WAS SHIPPED BACKWARDS AND CORRECTED 2026-08-23
 * (owner ruling, an owner field report on kindred#2544). Both source names
 * mislead: `COVID-19 Bunking Requests` (cm_id 206286) is the FAMILY CAMP
 * INFORMATION form's names box — provenance doc §3 row 2, staff-read, and
 * its writes land a median 0.0d from the shared-cabin multi's across 252
 * people — while `Shared-request` (cm_id 274133) is the REGISTRATION-time
 * comments box gated on the radio: 93 of 94 people wrote it in the radio's
 * sitting (median 0.00d), a median 181d before the information form. The
 * 2026-08-17 naming pass attributed each by the sound of its name, which is
 * exactly the trap the provenance doc warns these two fields set.
 *
 * `Shared-request` is still NOT its lookalike `FAM CAMP-Share Comments`
 * (cm_id 240598) — 171 values in 2025, ZERO in 2026 — which keeps its
 * verbatim name. The other three fields stay verbatim, and the rule for the
 * next reader is **verbatim unless the owner named it**; silence is not a
 * rename. Do not "improve" a label here on your own judgement.
 *
 * All three entries are read as ordinary row labels now — `Shared-request`
 * and `COVID-19 Bunking Requests` included, per the owner's 2026-08-27
 * ruling that a free-text note is never merged into a choice row (see the
 * file header). Nothing here is special-cased for them any more.
 */
const DISPLAY_LABELS: Readonly<Record<string, string>> = {
  'BunkingNotes Notes': 'Bunking Notes',
  'COVID-19 Bunking Requests': 'Fam Info Form Bunk Notes',
  'Shared-request': 'Reg Form Bunk Notes',
}

/** The row icon for each of the three CSV-lane notes (spec §6). Anything else — `FAM CAMP-Share Comments`, `Shared-request`, `COVID-19 Bunking Requests` — gets `DEFAULT_ROW_ICON`, the same muted note chip. */
const ROW_ICON: Readonly<Record<string, LucideIcon>> = {
  'BunkingNotes Notes': Tent,
  'Internal Bunk Notes': Lock,
  'Share Bunk With': BedDouble,
}
const DEFAULT_ROW_ICON: LucideIcon = MessageSquare

export interface ShareRequestPanelProps {
  party: RosterPartyRow
}

/**
 * Source fields that start FOLDED. `Share Bunk With` was the first,
 * kindred#2476 (owner ruling 2026-08-21) / PR #2521. `Internal Bunk Notes`
 * was added the same day by a follow-up staff ruling, mirroring that exact
 * precedent. Every field not listed here keeps the 2026-08-17 default of
 * starting expanded — do not fold anything else in here on your own
 * judgement.
 */
const DEFAULT_FOLDED: ReadonlySet<string> = new Set(['Share Bunk With', 'Internal Bunk Notes'])

function isDefaultFolded(folded: ReadonlySet<string>): boolean {
  if (folded.size !== DEFAULT_FOLDED.size) return false
  for (const sourceField of folded) {
    if (!DEFAULT_FOLDED.has(sourceField)) return false
  }
  return true
}

/** Blocks with nothing left to say after trimming render nothing at all. */
function withText(blocks: RequestTextBlockRow[]): RequestTextBlockRow[] {
  return blocks
    .map((block) => ({
      ...block,
      entries: (block.entries ?? []).filter((entry) => (entry.text ?? '').trim().length > 0),
    }))
    .filter((block) => block.entries.length > 0)
}

/** One row's paragraph of free text (mockup `.mksay`). No label here — a row's label lives in its own header, never as a caption above the text. */
function RowText({ text }: { text: string }) {
  return (
    <p data-testid="request-entry" className={MK_SAY}>
      {text}
    </p>
  )
}

function RequestBlock({
  block,
  expanded,
  onToggle,
}: {
  block: RequestTextBlockRow
  expanded: boolean
  onToggle: (sourceField: string) => void
}) {
  // The fold lives on the PANEL, not here, and is reset whenever the `share`
  // object changes — see `ShareRequestPanel` below. A `useState` in this
  // component looked like it gave every household a fresh expansion and did
  // not: the panel is never remounted between families (all three callsites
  // render `<FamilyDetailsPanel party={panelParty} …>` with no `key`, and
  // `usePanelParty` only swaps `selectedKey`), so a block keyed on its source
  // field kept its instance — and its fold — across the click.
  const isStaff = block.authorship === 'staff'
  const sourceField = block.source_field ?? ''
  const label = DISPLAY_LABELS[sourceField] ?? sourceField
  const RowIcon = ROW_ICON[sourceField] ?? DEFAULT_ROW_ICON

  return (
    <li
      data-testid="request-block"
      data-source-field={sourceField}
      data-authorship={isStaff ? 'staff' : 'family'}
      className="flex flex-col gap-[3px]"
    >
      {/* The WHOLE ROW is the click target (mockup `.mk.note .mkbtn`:
          `all:unset; display:flex; width:100%`), not just the label — a
          collapsed row used to leave the chevron and the Staff tag OUTSIDE
          the button with no handler, so clicking the glyph staff actually
          looked at did nothing. `aria-hidden` on the Staff tag keeps it out
          of the button's accessible name (dom-accessibility-api excludes
          aria-hidden descendants from "name from content"), so a query by
          exact label text still finds a staff-authored row's button. The
          chevron icon needs no such treatment — lucide already marks an
          icon with no a11y prop `aria-hidden` on its own. */}
      {/* `aria-expanded` is NOT the accessibility scaffolding
          `frontend/CLAUDE.md` rules out, and it is worth saying why so nobody
          strips it in a later sweep. It is in the approved mockup's own
          `.mkbtn` markup; it is already how this repo spells a disclosure
          control (`LockGroupPanel`, `OptimizeBunksButton`,
          `RequestRowDesktop`, `SeasonRollForwardPanel`, and both admin/geo
          panels); and it is the fold state a test can assert without reaching
          for a class name — the test-handle case that section explicitly
          allows. Raised by CodeRabbit. */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => {
          onToggle(sourceField)
        }}
        className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 text-left text-[13.5px] transition-colors"
      >
        <span className={`${NOTE_ICON_FRAME}`}>
          <RowIcon className={MARK_ICON} />
        </span>
        {/* Deliberately NOT the section heading's uppercase/tracked style,
            which `FamilyDetailsPanel`'s `Section` already spends above this.
            Repeating it would make a row read as a peer of "Share request"
            rather than a child of it. */}
        <span className="ml-0.5 font-semibold">{label}</span>
        {/* `Staff` only — the mockup's `NOTE_SPEC.shareWith` also tags
            `Share Bunk With` `who: 'CSV'`, but this app has no real CSV
            vs. form provenance signal on the wire, only `authorship`
            ('staff' | 'family'); inventing a label the data can't back is
            worse than omitting it, so `Share Bunk With` renders no tag. */}
        {isStaff && (
          <span className={WHO_TAG} aria-hidden="true">
            Staff
          </span>
        )}
        <ChevronRight
          className={`ml-auto h-3 w-3 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {expanded &&
        block.entries?.map((entry, index) => (
          <div key={`${String(index)}-${String(entry.text)}`} className="flex flex-col gap-0.5">
            {(entry.contributors ?? []).length > 0 && (
              <span
                data-testid="request-entry-contributors"
                className="text-muted-foreground pl-[30px] text-[11px]"
              >
                {(entry.contributors ?? []).join(', ')}
              </span>
            )}
            <RowText text={entry.text ?? ''} />
          </div>
        ))}
    </li>
  )
}

export function ShareRequestPanel({ party }: ShareRequestPanelProps) {
  const share = party.share ?? NO_SHARE_REQUEST

  // Which source fields staff have folded away, and WHOSE. Held here rather
  // than inside each block because the panel outlives the household it is
  // showing: `usePanelParty` swaps `selectedKey` and the same
  // `FamilyDetailsPanel` — and so the same `ShareRequestPanel` — renders the
  // next family. Resetting during render on a changed `share` is React's own
  // "adjust state when a prop changes" pattern, already used by
  // `usePanelParty` and `WeekendRosterPage` for exactly this reason; an
  // Effect would add a commit pass and paint the previous family's fold
  // first. `share` is referentially stable per party (`usePanelParty`
  // memoises it), so a parent re-render does not unfold anything.
  //
  // `DEFAULT_FOLDED` is applied in BOTH the initial seed below AND the reset
  // branch — that duplication is deliberate, not an oversight. A panel is
  // never remounted between households (see above), so the reset branch is
  // where every household after the first actually gets its starting fold;
  // seeding only the `useState` initializer would open `Share Bunk With` the
  // moment staff click the next family.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set(DEFAULT_FOLDED))
  const [foldedFor, setFoldedFor] = useState<ShareRequest>(share)
  if (foldedFor !== share) {
    setFoldedFor(share)
    if (!isDefaultFolded(folded)) setFolded(new Set(DEFAULT_FOLDED))
  }
  const toggleFold = useCallback((sourceField: string) => {
    setFolded((current) => {
      const next = new Set(current)
      if (!next.delete(sourceField)) next.add(sourceField)
      return next
    })
  }, [])

  // The radio and the checkboxes, in the board's own vocabulary. Both read
  // `party` directly (not `share`) so the grain gate lives in exactly one
  // place — see the file header. NEITHER carries text underneath any more
  // (owner ruling 2026-08-27): a choice row and a free-text note are
  // different facts, and merging them is the defect this ruling removes.
  const anchor = resolveShareAnchor(party)
  const cluster = resolveShareCluster(party)

  // ALL SIX source fields now flow through the ordinary fold loop, uniformly
  // — `Shared-request` and `COVID-19 Bunking Requests` included. No field is
  // lifted out or filtered any more, so `c39c5599`'s split between an
  // unfiltered list (for the joined fallback) and a filtered one (for the
  // rows) has nothing left to guard: there is only one list.
  const blocks = withText(share.request_blocks ?? [])
  const requestText = share.request_text ?? ''
  // The pre-split fallback. Reachable only if the raw values and the derived
  // column disagree — a state production should not produce, and one where
  // silently dropping the text would be the worse failure.
  const showJoinedFallback = blocks.length === 0 && requestText.length > 0

  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-col gap-2">
        {anchor && (
          <li className="flex flex-col gap-[3px]">
            <div className="flex items-center gap-1.5 text-[13.5px]">
              <span
                data-testid="share-anchor"
                className={`${ROW_ICON_FRAME} ${anchor.className} ${CAP_CLASSES.solo}`}
              >
                <Handshake className={MARK_ICON} />
              </span>
              <span className="ml-0.5 font-semibold">{anchor.label}</span>
            </div>
          </li>
        )}

        {cluster.length > 0 && (
          <li className="flex flex-col gap-[3px]">
            <div className="flex items-center gap-1.5 text-[13.5px]">
              <div className="flex items-center">
                {cluster.map((mark, index) => {
                  const cap = CAP_CLASSES[clusterCap(index, cluster.length)]
                  const Icon = mark.Icon
                  return (
                    <span
                      key={mark.key}
                      data-testid={`share-mark-${mark.key}`}
                      className={`${ROW_ICON_FRAME} ${mark.className} ${cap}`}
                    >
                      <Icon className={MARK_ICON} />
                    </span>
                  )
                })}
              </div>
              <span className="ml-0.5 font-semibold">
                {cluster.map((mark) => mark.ariaLabel).join(' · ')}
              </span>
            </div>
          </li>
        )}

        {blocks.map((block) => (
          <RequestBlock
            key={block.source_field ?? ''}
            block={block}
            expanded={!folded.has(block.source_field ?? '')}
            onToggle={toggleFold}
          />
        ))}

        {showJoinedFallback && (
          <li>
            <RowText text={requestText} />
          </li>
        )}
      </ul>
    </div>
  )
}
