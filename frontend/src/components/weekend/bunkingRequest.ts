/**
 * An adult-weekend guest's Jotform bunking request, graded into the board's
 * mark vocabulary (kindred#2759; owner picks locked in the design lab).
 *
 * ONE Handshake anchor carries the whole state, in the family anchor's own
 * tones (`ANCHOR_CLASS`): solid = a request, muted = submitted with none,
 * dotted = no form yet. Only the solid one glows. An amber corner dot means
 * the request changed across filings. "Coming with" is its own muted circle,
 * one per tick, flushed into a capsule — icon set A — and never glows.
 *
 * Everything that DECIDES (normalisation, the change rule, whether it
 * changed) is server-side (`api/services/jotform_bunking.py`); this module
 * only draws the payload.
 */
import { Handshake, Heart, House, UserRound, UsersRound, type LucideIcon } from 'lucide-react'

import type { BunkingRequest, ComingWith } from '../../types/lodging'
import type { MarkRunSpec } from './markSpec'
import { ANCHOR_CLASS } from './shareMarks'

type RequestState = BunkingRequest['state']

export const BUNKING_ANCHOR_CLASS: Record<RequestState, string> = {
  request: ANCHOR_CLASS.yes,
  none: ANCHOR_CLASS.no,
  no_form: ANCHOR_CLASS.unanswered,
}

export const BUNKING_ANCHOR_LABEL: Record<RequestState, string> = {
  request: 'Has a bunking request',
  none: 'Submitted, no bunking request',
  no_form: 'No Jotform yet',
}

/** Icon set A (owner pick, 2026-09-24). */
export const COMING_WITH_ICON: Record<ComingWith, LucideIcon> = {
  solo: UserRound,
  family: House,
  friends: UsersRound,
  partner: Heart,
}

const COMING_WITH_PHRASE: Record<ComingWith, string> = {
  solo: 'solo',
  family: 'with family',
  friends: 'with friends',
  partner: 'with a partner',
}

/** Muted — context, never an ask. The anchor's own `no` tone. */
export const COMING_WITH_CLASS = ANCHOR_CLASS.no

export function comingWithLabel(tokens: readonly ComingWith[]): string {
  return `Coming ${tokens.map((token) => COMING_WITH_PHRASE[token]).join(' + ')}`
}

/**
 * The card's "changed" signal. Reads the server's `changed` flag (P15), which
 * compares EVERY consecutive pair of filings — NOT `change.kind`, which is the
 * net first-vs-latest markup: a request that moved and moved back
 * (A → A+B → A) has changed, though its net markup is all keep.
 */
export function requestChanged(request: BunkingRequest): boolean {
  return request.changed === true
}

/**
 * "Aug 31" from Jotform's "YYYY-MM-DD HH:MM:SS". Only the date part is read,
 * as UTC, so a stamp can never slip a day in the viewer's timezone.
 */
export function shortDate(stamp: string): string {
  const day = stamp.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return stamp
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function changeCaption(request: BunkingRequest): string {
  const change = request.change
  if (!change) return ''
  if (change.kind === 'identical') return `Filed ${String(change.count ?? 0)} times · identical`
  return `Changed · ${shortDate(change.from_date ?? '')} → ${shortDate(change.to_date ?? '')}`
}

export function resolveBunkingRequestRuns(request: BunkingRequest): MarkRunSpec[] {
  const state = request.state
  const changed = requestChanged(request)
  const base =
    state === 'request'
      ? `Bunking request: ${request.current_text ?? ''}`
      : BUNKING_ANCHOR_LABEL[state]
  const filings = (request.versions ?? []).length
  const runs: MarkRunSpec[] = [
    {
      key: 'bunking-anchor',
      // Only a non-empty request glows; muted and dotted never do.
      hot: state === 'request',
      dotTestId: changed ? 'bunking-request-changed-dot' : undefined,
      marks: [
        {
          key: 'anchor',
          Icon: Handshake,
          className: BUNKING_ANCHOR_CLASS[state],
          tooltip: changed ? `${base} · Changed across ${String(filings)} submissions` : base,
          ariaLabel: `Jotform: ${BUNKING_ANCHOR_LABEL[state]}`,
        },
      ],
    },
  ]
  const tokens = request.coming_with ?? []
  if (tokens.length > 0) {
    runs.push({
      key: 'coming-with',
      hot: false,
      testId: 'coming-with-capsule',
      marks: tokens.map((token) => ({
        key: token,
        Icon: COMING_WITH_ICON[token],
        className: COMING_WITH_CLASS,
        tooltip: comingWithLabel([token]),
        ariaLabel: comingWithLabel([token]),
      })),
    })
  }
  return runs
}

export interface WordOp {
  op: 'same' | 'add' | 'del'
  text: string
}

/** Word-level LCS diff for the prose fallback's highlight (display only). */
export function wordDiff(before: string, after: string): WordOp[] {
  const a = before.split(/\s+/).filter(Boolean)
  const b = after.split(/\s+/).filter(Boolean)
  const key = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  )
  for (let i = a.length - 1; i >= 0; i--) {
    const row = lcs[i] as number[]
    for (let j = b.length - 1; j >= 0; j--) {
      row[j] =
        key(a[i] ?? '') === key(b[j] ?? '')
          ? (lcs[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(lcs[i + 1]?.[j] ?? 0, row[j + 1] ?? 0)
    }
  }
  const ops: WordOp[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (key(a[i] ?? '') === key(b[j] ?? '')) {
      ops.push({ op: 'same', text: b[j] ?? '' })
      i++
      j++
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      ops.push({ op: 'del', text: a[i] ?? '' })
      i++
    } else {
      ops.push({ op: 'add', text: b[j] ?? '' })
      j++
    }
  }
  while (i < a.length) ops.push({ op: 'del', text: a[i++] ?? '' })
  while (j < b.length) ops.push({ op: 'add', text: b[j++] ?? '' })
  return ops
}

/**
 * A push/compare write-in row's linked request, or null. ADULT WEEKENDS ONLY,
 * read from the weekend's own `session_type`: a Family Camp surface draws
 * nothing, whatever a row carries.
 */
export function linkedRequest(
  row: { bunking_request?: BunkingRequest | null | undefined },
  isAdult: boolean
): BunkingRequest | null {
  return isAdult ? (row.bunking_request ?? null) : null
}
