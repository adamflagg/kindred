/**
 * Occupancy evidence for the cabin-weekend attribution queue — the wire
 * payload reduced to what one queue row draws, plus that row's visual
 * vocabulary.
 *
 * The round-2 triage-attack master plan §12.8, owner-designed and owner-ruled
 * 2026-08-31. It closes no issue and none is filed, deliberately, per the
 * standing "fewer issues, not more" rule.
 *
 * ⛔ NOTHING IS CLASSIFIED HERE, AND THAT IS THE POINT. The verdict, the
 * conflict-aware suggestion and the occupant list all arrive computed from
 * `GET /api/lodging/attribution/conflicts`. The answer needs the live board's
 * placements AND its write-ins across every candidate weekend, and a client
 * that re-derived it would be a second implementation of availability —
 * `is_family_available` / `free_family_spots` in `api/services/lodging_rules.py`
 * carry owner rulings dated 2026-08-23 and 2026-08-29 and a comment expressly
 * guarding them against being "fixed". This module only RESHAPES: snake_case
 * to camelCase, a list to a lookup, and the two copy fragments the row's
 * sentences are built from.
 *
 * ⚠️ EVERY FIELD ON THE WIRE TYPE IS OPTIONAL. Pydantic fields with a default
 * render as `field?: T` in TypeScript, so `candidates`, `verdict` and the two
 * suggestions all arrive possibly-absent even on a row the server filled in
 * completely. Each is defaulted at the one place it is read, here, rather than
 * at the several places the row reads it.
 */
import type {
  AttributionOccupantKind,
  AttributionVerdictValue,
  SessionAttributionConflicts,
} from '../../../types/lodging'

/** One party the board already has in a candidate weekend's copy of the cabin. */
export interface SessionAttributionOccupant {
  kind: AttributionOccupantKind
  /** A household's mailing title or a write-in's occupant name — never an id. */
  label: string
  leafName: string
  /**
   * The building the CampMinder value NAMED, when this leaf came out of
   * expanding a container; `''` when the value named the leaf itself. Owner
   * ruling 3 makes a container conflict on any contained room, so the line
   * has to say "a room inside Clouds Rest" rather than naming a room staff
   * never wrote down.
   */
  containerName: string
}

/** One candidate weekend's verdict, with the evidence behind it. */
export interface AttributionCandidateEvidence {
  verdict: AttributionVerdictValue
  /**
   * Everyone the rule found in the cabin that weekend, EXCLUDING the party
   * being attributed. Non-empty on a `free` verdict too: a shareable leaf
   * with room left holds another party without conflicting.
   */
  occupants: SessionAttributionOccupant[]
}

/** One queue row's evidence, keyed for the row that renders it. */
export interface AttributionRowEvidence {
  byCandidate: Map<number, AttributionCandidateEvidence>
  /**
   * The CONFLICT-AWARE pick — `AttributeSession`'s own rule re-run over the
   * weekends that survive the conflict check. `undefined` when the rule
   * declined to answer (a stale row, or a value with no stored guess at all);
   * nothing is marked "best guess" then, which is the honest render.
   */
  suggestedSessionCmId: number | undefined
  /**
   * The UNCHANGED date-heuristic pick PocketBase stores on the row. Published
   * alongside the one above precisely so the banner can name both — a UI that
   * showed only the conflict-aware answer would silently disagree with the row
   * it is rendering.
   */
  timestampSessionCmId: number | undefined
  /** The two disagree: a conflict moved the guess. This is the banner's condition. */
  demotionApplied: boolean
  /**
   * Every candidate weekend conflicts. DEMOTES NOTHING (§12.8.3) — it is an
   * alarm about the cabin VALUE, since moving the guess would move it onto a
   * weekend the rule has just called wrong.
   */
  conflictInEveryCandidate: boolean
}

/**
 * The endpoint's rows, keyed by the queue row each annotates.
 *
 * An absent or failed response answers an EMPTY MAP rather than throwing: the
 * evidence is an enrichment, and a queue staff cannot see is worse than a
 * queue with no verdicts on it (the same degradation `useSessionAttributionQueue`
 * already applies to its alias and session fetches).
 */
export function rowEvidenceByIssueId(
  response: SessionAttributionConflicts | undefined
): Map<string, AttributionRowEvidence> {
  const byIssueId = new Map<string, AttributionRowEvidence>()
  for (const row of response?.rows ?? []) {
    const issueId = row.issue_id ?? ''
    // A row with no id can never be matched to a queue row, so it is dropped
    // rather than stored under '' where it would shadow the next one.
    if (issueId === '') continue

    const byCandidate = new Map<number, AttributionCandidateEvidence>()
    for (const candidate of row.candidates ?? []) {
      // The issue-id guard above, one level down and for the same reason: a
      // candidate the payload cannot name can never be asked for by a card, so
      // it is dropped rather than filed under 0, where the next such candidate
      // would shadow it and a real weekend carrying cm_id 0 would collide.
      const sessionCmId = candidate.session_cm_id ?? 0
      if (sessionCmId === 0) continue

      byCandidate.set(sessionCmId, {
        verdict: candidate.verdict ?? 'no_data',
        occupants: (candidate.occupants ?? []).map((occupant) => ({
          kind: occupant.kind ?? 'placement',
          label: occupant.label ?? '',
          leafName: occupant.leaf_name ?? '',
          containerName: occupant.container_name ?? '',
        })),
      })
    }

    byIssueId.set(issueId, {
      byCandidate,
      // `?? undefined`, not `?? 0`: the field is `number | null` and null means
      // the rule DECLINED to answer. Coercing that to 0 would mark whichever
      // candidate happened to carry cm_id 0 as the best guess.
      suggestedSessionCmId: row.conflict_aware_suggested_session_cm_id ?? undefined,
      timestampSessionCmId: row.timestamp_suggested_session_cm_id ?? undefined,
      demotionApplied: row.demotion_applied ?? false,
      conflictInEveryCandidate: row.conflict_in_every_candidate ?? false,
    })
  }
  return byIssueId
}

/**
 * One occupant, as the evidence line says it.
 *
 * "a placement" / "a write-in" is not decoration: an unsized write-in occupies
 * a unit WHOLESALE (kindred#2540), so it conflicts on a `single_party` leaf
 * whose recorded party size is 0 — and staff checking the claim need to know
 * which of the two boards to look at.
 */
export function occupantClause(occupant: SessionAttributionOccupant): string {
  const kind = occupant.kind === 'write_in' ? 'a write-in' : 'a placement'
  const inside = occupant.containerName === '' ? '' : ` — a room inside ${occupant.containerName}`
  return `${kind} for ${occupant.label} in ${occupant.leafName}${inside}`
}

/**
 * The evidence line's box. IDENTICAL ACROSS ALL THREE VERDICTS — owner ruling
 * 6, Treatment A, *"for the sake of visual uniformity and information."* Only
 * `ATTRIBUTION_VERDICT_CLASS` below varies, and only in colour.
 *
 * `text-xs` rather than the mock's 11.5px: `lodgingStyles.ts` sets text-xs as
 * this surface's floor and nothing here earns an exception.
 */
export const EVIDENCE_LINE = 'mt-2 rounded-lg border px-2 py-1.5 text-xs leading-snug'

/**
 * ⚠️ THIS PALETTE IS NOT RULED. The conflict/free/no-data hues are a NEW
 * vocabulary for this surface, derived from `--destructive` and `--primary`
 * exactly as the approved mock derives them. `weekend-card-vocabulary.md` §6
 * closes the hue set on the FAMILY CARD; this is the admin queue and the
 * board's attribution modal, which is probably far enough away — but that is
 * the owner's call and it has not been made. The alternative is adopting the
 * board's existing marks. See this PR's body.
 *
 * Every colour is a semantic token or a token-derived tint, never a hex and
 * never a hue absent from the mock — `dark:text-red-400` is the one Tailwind
 * step here, standing in for the mock's lightened dark-mode `--warn` (the
 * `--destructive` token darkens in dark mode instead of lightening, so reading
 * it straight would sink the text into its own background).
 */
export const ATTRIBUTION_VERDICT_CLASS: Record<AttributionVerdictValue, string> = {
  conflict: 'border-destructive/30 bg-destructive/10 text-destructive dark:text-red-400',
  free: 'border-primary/25 bg-primary/10 text-primary',
  no_data: 'border-border bg-muted/50 text-muted-foreground',
}

/** Both banners' shape; only the colour below differs. */
export const ATTRIBUTION_BANNER = 'rounded-xl border px-3 py-2 text-xs leading-relaxed'

/** The demotion banner — an explanation, not a warning. */
export const ATTRIBUTION_BANNER_MOVE = 'bg-secondary border-transparent text-primary'

/** The `conflict_in_every_candidate` alarm, in the accent the board alarms with. */
export const ATTRIBUTION_BANNER_ALARM =
  'bg-accent/20 border-accent/50 text-accent-foreground dark:text-accent'
