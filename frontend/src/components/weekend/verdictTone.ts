/**
 * The four verdicts' colour, in one place.
 *
 * `classify_push` emits `add | match | conflict | remove` for write-ins
 * (kindred#2477) and `compare_placements` emits the same four words for
 * placements (kindred#2478 §5). Two screens now render them, and the ruling
 * that made them share a vocabulary is undone the moment they stop sharing a
 * palette — an amber conflict on one screen and a red one on the other reads
 * as two different kinds of answer.
 *
 * The values are the board's existing semantic classes, moved here verbatim
 * from `PushWriteInsModal`'s `TILE_META`: `unitBadges.ts`'s amber conflict
 * chip and `CamperDetail.tsx`'s amber panel are where they came from
 * originally. This introduces no colour and no token; it only stops the
 * second consumer from copying the first.
 */
export type Verdict = 'add' | 'match' | 'conflict' | 'remove'

export const VERDICT_TONE: Record<Verdict, string> = {
  add: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200',
  match: 'border-border bg-muted/40 text-muted-foreground',
  conflict:
    'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200',
  remove:
    'border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200',
}
