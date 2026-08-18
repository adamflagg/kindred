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
 * Layout is the owner's 2026-08-17 ruling, a hybrid of two mockup options:
 * blocks start EXPANDED, because a scanning eye must not miss request text,
 * and each is COLLAPSIBLE, because 9 of 382 rostered 2026 households render
 * four blocks and one renders seven entries inside them. The expectation is
 * explicitly that this ships and gets tuned against real staff use.
 *
 * Labels are the ORIGINAL CampMinder field names, verbatim, UNLESS THE OWNER
 * NAMED ONE. That was the 2026-08-17 ruling — "call them the original
 * fieldnames for now until staff can weigh in after it's live" — and staff
 * have since weighed in on three of the six, so `DISPLAY_LABELS` below is the
 * whole list of exceptions and the other three keep the raw CampMinder
 * spelling. Do not "improve" a label that is not already in that map.
 *
 * ## One treatment
 *
 * The amber blockquote is INHERITED, not invented: it is the same one the
 * camper details panel uses for parent request text, so a request reads the
 * same wherever staff meet one — and, after the owner's 2026-08-17 review of
 * the live panel, the same whoever wrote it. The two staff-authored fields
 * (`BunkingNotes Notes`, `Internal Bunk Notes`) briefly shipped on a grey rail
 * to keep an internal note from reading as a family's own ask; that is the one
 * thing the review reversed, and it also removes a weekend-only divergence
 * from summer, which renders its staff notes in amber too.
 *
 * A source field with no text renders NOTHING — no "nothing applicable"
 * clutter, composing with kindred#2255's chip ruling in this same modal.
 *
 * ## No permission gate on a FAMILY's own request text
 *
 * `request_text` and the family-authored blocks built from the same answers
 * have no permission check at all, while `MedicalNarrative` (rendered beside
 * them in `FamilyDetailsPanel`) is gated on `bunking.manage`. The split is
 * intentional: request text is a placement input — why a household wants a
 * particular cabin or setting is a legitimate placement concern for any
 * authenticated user to see, the same way the rest of the roster is. It is
 * free text a household wrote about where it wants to sleep, not the
 * structured medical questionnaire, even though it sometimes contains health
 * detail. `MedicalNarrative` covers that questionnaire, and that one is
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
 * paints nothing — see `REQUEST_RAIL`.
 */
import { AlertCircle, ChevronDown, ChevronRight, MapPin, Users } from 'lucide-react'
import { useCallback, useState } from 'react'

import type { ProximityKindValue, RequestTextBlockRow, ShareRequest } from '../../types/lodging'
import { SharePreferenceChip } from './SharePreferenceChip'

const PROXIMITY: Record<ProximityKindValue, { label: string; icon: typeof MapPin }> = {
  near: { label: 'Near another family', icon: MapPin },
  with: { label: 'Same cabin as another family', icon: Users },
  similar_ages: { label: 'With similarly-aged kids', icon: Users },
}

/**
 * The camper details panel's treatment for parent request text, reused
 * verbatim. `break-words` is the one addition: the longest single 2026 answer
 * is 680 characters in a 416px panel, and an unbroken token — an email
 * address, a URL — would otherwise push the panel into a horizontal scroll.
 *
 * EVERY block gets this one, family-authored or staff-authored. The two staff
 * fields briefly had a grey variant; the owner's 2026-08-17 review of the live
 * panel standardised on amber instead. **The authorship distinction is not
 * gone — it is merely not painted.** `block.authorship` still decides whether
 * `/lodging/roster` sends a staff block to this client at all
 * (`_may_read_staff_notes`, api/routers/lodging.py: `BunkingNotes Notes` and
 * `Internal Bunk Notes` are `original_bunk_requests` rows, gated on
 * `bunking.manage`), and it is still surfaced as `data-authorship` below.
 * Deleting the field because nothing reads it for colour would reopen that
 * permission hole.
 */
const REQUEST_RAIL =
  'text-foreground rounded-r-lg border-l-2 border-amber-300 bg-amber-50/60 px-3 py-2 text-sm whitespace-pre-wrap break-words italic dark:border-amber-500/60 dark:bg-amber-900/20'

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
 * ⚠️ `Shared-request` (cm_id 274133) is the CURRENT family-camp form field —
 * 112 rostered 2026 households — and is NOT its lookalike `FAM CAMP-Share
 * Comments` (cm_id 240598), which has 171 values in 2025, 112 in 2024 and
 * ZERO in 2026. Only the live one is renamed; renaming the retired one would
 * leave the field staff actually read still called `Shared-request`.
 *
 * The other three fields stay verbatim, and the rule for the next reader is
 * **verbatim unless the owner named it** — `Internal Bunk Notes`, `Share Bunk
 * With` and `FAM CAMP-Share Comments` were not named, and silence is not a
 * rename. Do not "improve" a label here on your own judgement.
 */
const DISPLAY_LABELS: Readonly<Record<string, string>> = {
  'BunkingNotes Notes': 'Bunking Notes',
  'COVID-19 Bunking Requests': 'Reg Form Bunk Notes',
  'Shared-request': 'Fam Info Form Bunk Notes',
}

export interface ShareRequestPanelProps {
  share: ShareRequest
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
  // field kept its instance — and its fold — across the click. 205 of 382
  // rostered households share `COVID-19 Bunking Requests`, so the next
  // family's request text arrived already hidden.
  const isStaff = block.authorship === 'staff'
  const sourceField = block.source_field ?? ''
  const label = DISPLAY_LABELS[sourceField] ?? sourceField

  return (
    <section
      data-testid="request-block"
      data-source-field={sourceField}
      data-authorship={isStaff ? 'staff' : 'family'}
      className="flex flex-col gap-1"
    >
      <button
        type="button"
        onClick={() => {
          onToggle(sourceField)
        }}
        className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 text-left transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 flex-shrink-0" />
        )}
        {/* Deliberately NOT the section heading's uppercase/tracked style,
            which `FamilyDetailsPanel`'s `Section` already spends above this.
            Repeating it would make a block read as a peer of "Share request"
            rather than a child of it — and at 11px in a 416px panel, a
            label as long as "Fam Info Form Bunk Notes" set in tracked
            uppercase is both wider and harder to read. */}
        <span className="text-xs font-semibold">{label}</span>
      </button>

      {expanded &&
        block.entries?.map((entry, index) => (
          <div key={`${String(index)}-${String(entry.text)}`} className="flex flex-col gap-0.5">
            {(entry.contributors ?? []).length > 0 && (
              <span
                data-testid="request-entry-contributors"
                className="text-muted-foreground pl-4 text-[11px]"
              >
                {(entry.contributors ?? []).join(', ')}
              </span>
            )}
            <blockquote data-testid="request-entry" className={REQUEST_RAIL}>
              {entry.text}
            </blockquote>
          </div>
        ))}
    </section>
  )
}

export function ShareRequestPanel({ share }: ShareRequestPanelProps) {
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
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const [foldedFor, setFoldedFor] = useState<ShareRequest>(share)
  if (foldedFor !== share) {
    setFoldedFor(share)
    if (folded.size > 0) setFolded(new Set())
  }
  const toggleFold = useCallback((sourceField: string) => {
    setFolded((current) => {
      const next = new Set(current)
      if (!next.delete(sourceField)) next.add(sourceField)
      return next
    })
  }, [])

  const proximity = share.proximity ?? []
  const blocks = withText(share.request_blocks ?? [])
  const requestText = share.request_text ?? ''
  // The pre-split fallback. Reachable only if the raw values and the derived
  // column disagree — a state production should not produce, and one where
  // silently dropping the text would be the worse failure.
  const showJoinedFallback = blocks.length === 0 && requestText.length > 0
  const needsResolution =
    share.needs_resolution === true && (blocks.length > 0 || showJoinedFallback)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <SharePreferenceChip
          preference={share.preference ?? 'unknown'}
          raw={share.preference_raw}
        />
        {proximity.map((kind) => {
          // An unmapped proximity value from a newer ingest renders as
          // nothing rather than crashing the row.
          if (!Object.hasOwn(PROXIMITY, kind)) return null
          const entry = PROXIMITY[kind]
          const Icon = entry.icon
          return (
            <span
              key={kind}
              className="bg-muted/60 text-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
            >
              <Icon className="h-3 w-3 flex-shrink-0" />
              {entry.label}
            </span>
          )
        })}
      </div>

      {blocks.map((block) => (
        <RequestBlock
          key={block.source_field ?? ''}
          block={block}
          expanded={!folded.has(block.source_field ?? '')}
          onToggle={toggleFold}
        />
      ))}

      {showJoinedFallback && (
        <blockquote data-testid="request-entry" className={REQUEST_RAIL}>
          {requestText}
        </blockquote>
      )}

      {/* ONCE for the household, not once per block. It is a fact about the
          request layer — no named family has been resolved to a household
          yet — and repeating it under every block would read as a different
          problem per source field. */}
      {needsResolution && (
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          <AlertCircle className="h-3 w-3 flex-shrink-0" />
          Needs resolution
        </span>
      )}
    </div>
  )
}
