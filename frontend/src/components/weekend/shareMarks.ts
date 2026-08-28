/**
 * The share-question mark vocabulary — spec 2026-08-22
 * (`docs/plans/2026-08-22-share-icons-spec.md`, LOCAL ONLY, the Share Icons
 * Lab artifact `LOCKED-final-picks`).
 *
 * ## Why this module exists
 *
 * Two questions live on every household's card and used to have no mark at
 * all, or the wrong one:
 *
 *   - The **radio** (`share.preference`) had no mark whatsoever — staff could
 *     only see it by opening the panel.
 *   - The **checkboxes** (`share.proximity`) rendered as `FamilyCardChips`
 *     word chips, "Wants to share" / "Near another family" — collapsing two
 *     independent ticks (WITH-named vs. similar-age) into one chip, and
 *     giving `near` no visual distinction from either.
 *
 * This module is the ONE grading for both, in the register `needGlyphs.ts`
 * established: a pure `.ts` truth table, testable without rendering a card,
 * naming icon COMPONENTS rather than drawing them so the renderer
 * (`ShareMarks.tsx`, Task 4) owns the markup and this owns the vocabulary.
 *
 * ## Two families of marks, and the shape split is deliberate
 *
 * The board's need glyphs (`needGlyphs.ts`) are 20px rounded SQUARES
 * (`rounded-lg`). Share marks are CIRCLES — a solo tick is a full circle, 2+
 * ticks merge into a capsule with circular outer caps and square interior
 * connector edges. The split is intentional, not incidental: the share
 * question is a different KIND of signal from a housing need (who can bunk
 * together, not what the room provides), and staff should read it as its own
 * family of marks at a glance.
 *
 * ## The anchor is always on; the cluster appears only when ticked
 *
 * `resolveShareAnchor` answers the radio — one mark per household card,
 * every time, shaded by the answer (never by placement). `resolveShareCluster`
 * answers the checkboxes — zero to three marks, each its own icon, no
 * dominance/collapsing (a dominance rule was proposed and explicitly
 * REVERSED by the owner the same day).
 *
 * ## WITH keys on the un-ORed flag alone — no proximity fallback
 *
 * `share.wants_with_named` is the WITH-a-named-family checkbox specifically,
 * stored separately from `share.proximity` as of kindred's Task 1/2 split
 * (owner ruling 2026-08-22: "we def need to split those into their truly
 * separate answers"). Before that split, `proximity`'s `'with'` was the only
 * signal, and it was already an OR of the named tick and the similar-age
 * tick — so testing `proximity.includes('with')` here would be circular: it
 * would light the WITH icon for a similar-age-only filing, which is exactly
 * the collapse the two-icon design exists to undo. The flag is the single
 * source of truth for this icon; `proximity`'s `'with'` remains a real and
 * separately useful superset (open-to-share filters, eligibility), just not
 * this mark's input. Live data is only correct once every 2025+2026 record
 * has been re-derived by the transform (Task 5's rollout step) — a stale row
 * with `wants_with_named` still unbackfilled under-renders the WITH mark
 * until that run, which is expected and not a bug in this module.
 *
 * ## Anchor wording — TWO maps, split by purpose (controller ruling 2026-08-22)
 *
 * The anchor's tooltip fallback and its aria-label are NOT the same text, and
 * that is deliberate rather than an oversight to converge:
 *
 *   - `ANCHOR_TOOLTIP_PREFIX` is the bubble text: a fixed short prefix per
 *     state (owner ruling 2026-08-22 — staff know the answer wordings, so the
 *     verbatim sentence is noise and `preference_raw` renders nowhere), with
 *     the reg-form Shared-request text appended as `: <content>` on
 *     yes/maybe. The dotted `unanswered` mark is a lone hover target with no
 *     neighbouring caption, so its entry spells out what is missing —
 *     `'Share question not answered'` — rather than reusing the terser chip
 *     word, which would read as cut off in isolation.
 *   - `ANCHOR_ARIA_LABEL` is the test-query handle (`frontend/CLAUDE.md`'s a11y
 *     policy: an `aria-label` exists only when a test needs one, never for
 *     assistive tech). It is copied VERBATIM from `SharePreferenceChip`'s
 *     `CHIP` map for all four states, `'Not answered'` included, so the same
 *     answer reads with the same word wherever a test queries it by role/name
 *     — and so it matches Task 4's rendering contract exactly. If
 *     `SharePreferenceChip`'s wording changes, re-check this map by hand; it
 *     is not derived from it.
 *
 * Three of the four values happen to coincide (`Open to sharing` / `Only if
 * mutual` / `Will not share`) — only `unanswered` diverges between the two
 * maps, which is why splitting them beats keeping one map with a special case.
 *
 * ## `ShareAnchorSpec.label` (additive, spec 2026-08-27 panel-row mockup)
 *
 * `ShareRequestPanel`'s row-grammar rework needs the anchor's bare state
 * wording — `"Yes, Share Cabin"`, not the tooltip's `preference`-appended
 * `": <content>"` form — as a ROW HEADER LABEL, not a hover bubble. Restating
 * `ANCHOR_TOOLTIP_PREFIX`'s four strings in that file would be a second copy
 * of a LOCKED vocabulary, so `resolveShareAnchor` now also returns `label`,
 * reading the exact same private map. This is the one authorised, additive
 * edit to this module for that rework: no existing field changed shape, and
 * `label` is inert to every caller that does not read it.
 */
import { HeartHandshake, Milestone, UsersRound, type LucideIcon } from 'lucide-react'

import type {
  ProximityKindValue,
  RequestTextBlockRow,
  RosterPartyRow,
  ShareRequest,
  SharePreferenceValue,
} from '../../types/lodging'

/** The radio's four states, `unanswered` covering both `unknown` and no share block. */
export type ShareAnchorState = 'yes' | 'maybe' | 'no' | 'unanswered'

/** The always-on radio mark for one household card. */
export interface ShareAnchorSpec {
  readonly state: ShareAnchorState
  readonly className: string
  /** The bare state wording (`ANCHOR_TOOLTIP_PREFIX[state]`), with no `preference_raw`/Shared-request append — see the header comment's "ShareAnchorSpec.label" section. */
  readonly label: string
  readonly tooltip: string
  readonly ariaLabel: string
}

/** One checkbox tick's mark. Zero to three of these render, in fixed order. */
export interface ShareClusterMark {
  readonly key: 'with' | 'similar_ages' | 'near'
  readonly Icon: LucideIcon
  readonly className: string
  readonly tooltip: string
  readonly ariaLabel: string
}

/**
 * Which corners of a capsule mark are rounded.
 *
 * Computed from the mark's POSITION IN THE LIST (`clusterCap`), never from
 * CSS tree position — the half-pill trap (spec §4): `ui/Tooltip` nests each
 * glyph in its own trigger element, which defeats `:only-child` /
 * `:last-child` selectors a caller might otherwise reach for.
 */
export type ClusterCap = 'solo' | 'left' | 'right' | 'middle'

/** The locked cap treatments. A solo mark is a full circle; 2+ marks flush into a capsule with a -1px overlap so there is no visible gap. */
export const CAP_CLASSES: Record<ClusterCap, string> = {
  solo: 'rounded-full',
  left: 'rounded-l-full rounded-r-none',
  right: 'rounded-r-full rounded-l-none -ml-px',
  middle: 'rounded-none -ml-px',
}

/** `SharePreferenceValue` (`unknown` included) -> this module's anchor state. */
const ANCHOR_STATE: Record<SharePreferenceValue, ShareAnchorState> = {
  yes_share: 'yes',
  maybe_mutual: 'maybe',
  no_share: 'no',
  unknown: 'unanswered',
}

/**
 * The tooltip prefix, by state. Owner ruling 2026-08-22 (supersedes the
 * spec's raw-sentence clause): staff already know the answer wordings, so the
 * verbatim CampMinder sentence is noise — `preference_raw` renders nowhere.
 * The reg-form Shared-request text (274133) appends as `: <content>` on
 * yes/maybe when present; the bare prefix stands alone otherwise.
 * `unanswered` stays self-explanatory rather than matching
 * `SharePreferenceChip`'s terser chip word.
 */
const ANCHOR_TOOLTIP_PREFIX: Record<ShareAnchorState, string> = {
  yes: 'Yes, Share Cabin',
  maybe: 'Maybe Share Cabin',
  no: "Don't Share Cabin",
  unanswered: 'Share question not answered',
}

/**
 * The aria-label text, by state — copied verbatim from `SharePreferenceChip`'s
 * `CHIP` map (see the header comment). This is the map rule 10's
 * `` `Share: ${label}` `` composition reads, and it is NOT
 * `ANCHOR_TOOLTIP_PREFIX` — the two serve different purposes and now share no
 * wording at all.
 */
const ANCHOR_ARIA_LABEL: Record<ShareAnchorState, string> = {
  yes: 'Open to sharing',
  maybe: 'Only if mutual',
  no: 'Will not share',
  unanswered: 'Not answered',
}

/**
 * The locked anchor treatments (spec §2). `no` is quiet gray, NEVER red — red
 * was considered and rejected because it would compete with the board's
 * unmet-need signal. `unanswered` carries no fill at all, so it never looks
 * like a positive answer while still never being hidden.
 */
const ANCHOR_CLASS: Record<ShareAnchorState, string> = {
  yes: 'bg-forest-100 text-forest-800 dark:bg-forest-950/50 dark:text-forest-300',
  maybe: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  no: 'bg-muted text-muted-foreground',
  unanswered: 'border border-dotted border-muted-foreground/60 text-muted-foreground/70',
}

/** The free-text source field the anchor's own append reads — gated to yes/maybe (274133). */
const SHARED_REQUEST_SOURCE = 'Shared-request'

/** The free-text source field every cluster mark's tooltip reads (206286, the names box). */
const NAMES_SOURCE = 'COVID-19 Bunking Requests'

/** The locked icon, per cluster key (spec §3). The anchor's own `Handshake` is fixed in Task 4's JSX — `ShareAnchorSpec` carries no `Icon` field because every state draws the same one. */
const CLUSTER_ICON: Record<ShareClusterMark['key'], LucideIcon> = {
  with: HeartHandshake,
  similar_ages: UsersRound,
  near: Milestone,
}

/**
 * The locked cluster treatments (spec §3). Green ("good share candidate")
 * applies to WITH-named and similar-age only; NEAR stays indigo because it
 * is a proximity request, not a sharing one.
 */
const CLUSTER_CLASS: Record<ShareClusterMark['key'], string> = {
  with: 'bg-forest-100 text-forest-800 dark:bg-forest-950/50 dark:text-forest-300',
  similar_ages: 'bg-forest-100 text-forest-800 dark:bg-forest-950/50 dark:text-forest-300',
  near: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400',
}

/** The per-icon tooltip/aria-label shorthand, and the fixed draw order (WITH, similar, NEAR). */
const CLUSTER_SHORTHAND: Record<ShareClusterMark['key'], string> = {
  with: 'Share with family',
  similar_ages: 'Similar age kids',
  near: 'Near family',
}
const CLUSTER_ORDER: ReadonlyArray<ShareClusterMark['key']> = ['with', 'similar_ages', 'near']

/**
 * Every distinct family answer in one CampMinder source field, joined for
 * display (rule 6).
 *
 * Reads only the block whose `source_field` matches AND whose `authorship`
 * is `'family'` — a staff-authored block (`BunkingNotes`, `Internal Bunk
 * Notes`) never feeds a share mark's tooltip, the same authorship gate
 * `ShareRequestPanel` reads for its own rendering decision. `''` when no such
 * block exists, so a caller never needs to guard against `undefined`.
 */
export function requestBlockText(share: ShareRequest | undefined, sourceField: string): string {
  const blocks = share?.request_blocks ?? []
  const block = blocks.find(
    (candidate: RequestTextBlockRow) =>
      candidate.source_field === sourceField && candidate.authorship === 'family'
  )
  const entries = block?.entries ?? []
  return entries
    .map((entry) => entry.text?.trim() ?? '')
    .filter((text) => text.length > 0)
    .join('; ')
}

/**
 * The always-on radio mark for a household card, or `null` for a person-grain
 * party (rule 1) — adult weekends have no share question, so a person-grain
 * card must not render a dotted "unanswered" mark for a question never asked.
 */
export function resolveShareAnchor(party: RosterPartyRow): ShareAnchorSpec | null {
  if (party.grain !== 'household') return null

  const preference = party.share?.preference ?? 'unknown'
  const state = Object.hasOwn(ANCHOR_STATE, preference) ? ANCHOR_STATE[preference] : 'unanswered'
  let tooltip = ANCHOR_TOOLTIP_PREFIX[state]

  // The Shared-request (274133) append is hard-gated to yes/maybe — a value
  // showing up for no/unanswered would be drift in the data, not a case to
  // render (rule 3). Both the radio and 274133 live on the REGISTRATION form
  // (provenance doc §3b: 274133 is its "note your request(s) below in the
  // comments" box); the Information form's names text (206286) belongs to the
  // cluster icons, never here.
  if (state === 'yes' || state === 'maybe') {
    const sharedRequestText = requestBlockText(party.share, SHARED_REQUEST_SOURCE)
    if (sharedRequestText.length > 0) {
      tooltip = `${tooltip}: ${sharedRequestText}`
    }
  }

  return {
    state,
    className: ANCHOR_CLASS[state],
    label: ANCHOR_TOOLTIP_PREFIX[state],
    tooltip,
    ariaLabel: `Share: ${ANCHOR_ARIA_LABEL[state]}`,
  }
}

/**
 * The checkbox cluster for a household card — zero to three marks, in the
 * fixed WITH/similar/NEAR order, or `[]` for a person-grain party (rule 1).
 *
 * No dominance or collapsing: every ticked option renders its own icon. The
 * same names text repeats verbatim under every icon present — that is the
 * spec (rule 5), not a bug to dedupe away.
 */
export function resolveShareCluster(party: RosterPartyRow): ShareClusterMark[] {
  if (party.grain !== 'household') return []

  const share = party.share
  const proximity: readonly ProximityKindValue[] = share?.proximity ?? []
  const keys = CLUSTER_ORDER.filter((key) => {
    if (key === 'with') return share?.wants_with_named === true
    return proximity.includes(key)
  })

  const namesText = requestBlockText(share, NAMES_SOURCE)

  return keys.map((key) => {
    const shorthand = CLUSTER_SHORTHAND[key]
    return {
      key,
      Icon: CLUSTER_ICON[key],
      className: CLUSTER_CLASS[key],
      tooltip: namesText.length > 0 ? `${shorthand}: ${namesText}` : shorthand,
      ariaLabel: shorthand,
    }
  })
}

/**
 * Which corners `index` rounds within a `count`-mark cluster (rule 7).
 *
 * Pure function of position and length — never read CSS tree position (the
 * half-pill trap the header comment explains).
 */
export function clusterCap(index: number, count: number): ClusterCap {
  if (count <= 1) return 'solo'
  if (index === 0) return 'left'
  if (index === count - 1) return 'right'
  return 'middle'
}
