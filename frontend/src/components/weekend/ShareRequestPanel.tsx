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
 * Labels are the ORIGINAL CampMinder field names, verbatim, including the
 * misnamed `COVID-19 Bunking Requests` that carries 205 households of general
 * bunking requests. Ruled deliberately — "call them the original fieldnames
 * for now until staff can weigh in after it's live" — with a display-names
 * issue to be filed once they have. Do not "improve" them here.
 *
 * ## Two treatments, and only two
 *
 * The amber blockquote is INHERITED, not invented: it is the same one the
 * camper details panel uses for parent request text, so a request reads the
 * same wherever staff meet one. The staff-authored fields (`BunkingNotes
 * Notes`, `Internal Bunk Notes`) get a grey rail in the same grammar, so an
 * internal note never reads as a family's own ask — a weekend-only divergence
 * from summer, which renders its staff notes in amber too, and one the ruling
 * made on purpose.
 *
 * A source field with no text renders NOTHING — no "nothing applicable"
 * clutter, composing with kindred#2255's chip ruling in this same modal.
 *
 * ## No permission gate on request_text
 *
 * `request_text` and the blocks built from the same answers have no
 * permission check at all, while `MedicalNarrative` (rendered beside them in
 * `FamilyDetailsPanel`) is gated on `bunking.manage`. The split is
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
 */
import { AlertCircle, ChevronDown, ChevronRight, MapPin, Users } from 'lucide-react'
import { useState } from 'react'

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
 */
const FAMILY_RAIL =
  'text-foreground rounded-r-lg border-l-2 border-amber-300 bg-amber-50/60 px-3 py-2 text-sm whitespace-pre-wrap break-words italic dark:border-amber-500/60 dark:bg-amber-900/20'

/** The same grammar, drained of colour, for the two staff-authored fields. */
const STAFF_RAIL =
  'text-muted-foreground rounded-r-lg border-l-2 border-border bg-muted/40 px-3 py-2 text-sm whitespace-pre-wrap break-words'

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

function RequestBlock({ block }: { block: RequestTextBlockRow }) {
  // Expanded on first render, every time the panel opens. Deliberately NOT
  // remembered across households: staff open the panel to read the request,
  // and a fold carried over from the last family would hide it.
  const [expanded, setExpanded] = useState(true)
  const isStaff = block.authorship === 'staff'
  const label = block.source_field ?? ''

  return (
    <section
      data-testid="request-block"
      data-source-field={label}
      data-authorship={isStaff ? 'staff' : 'family'}
      className="flex flex-col gap-1"
    >
      <button
        type="button"
        onClick={() => {
          setExpanded((open) => !open)
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
            rather than a child of it — and at 11px in a 416px panel,
            "COVID-19 Bunking Requests" set in tracked uppercase is both
            wider and harder to read. */}
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
            <blockquote data-testid="request-entry" className={isStaff ? STAFF_RAIL : FAMILY_RAIL}>
              {entry.text}
            </blockquote>
          </div>
        ))}
    </section>
  )
}

export function ShareRequestPanel({ share }: ShareRequestPanelProps) {
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
        <RequestBlock key={block.source_field ?? ''} block={block} />
      ))}

      {showJoinedFallback && (
        <blockquote data-testid="request-entry" className={FAMILY_RAIL}>
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
