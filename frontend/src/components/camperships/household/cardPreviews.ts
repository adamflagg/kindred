import { usePrefetchAidPreview } from '../../../hooks/camperships/useAidEditorPreview'
import type { ApiAidGridRow } from '../../../types/api-types'
import { roundOf } from '../requests/stage'
import type { CardEditKind } from './cardEdits'

/** The amount a kind's editor opens on: the appeal's ask, Round 3's ask, or its amount (pending, else decided). */
export function openingAmount(row: ApiAidGridRow, kind: CardEditKind): number | null {
  if (kind === 'appeal') return roundOf(row, 2)?.ask ?? null
  const r3 = roundOf(row, 3)
  return kind === 'round3_ask' ? (r3?.ask ?? null) : (r3?.pending_approval ?? r3?.decided ?? null)
}

/**
 * R2 (owner ruling 10-05): a resting card reads the preview its money editor would open on, so
 * opening it shows the line at once. Only an offered appeal or Round 3 amount that opens on an
 * amount asks (an ask alone prices nothing): at most two reads a card, none for most.
 */
export function usePrefetchCardPreviews(row: ApiAidGridRow, edits: readonly CardEditKind[]): void {
  const priced = (kind: 'appeal' | 'round3_amount') =>
    edits.includes(kind) ? openingAmount(row, kind) : null
  usePrefetchAidPreview(row.request_id, 2, priced('appeal'))
  usePrefetchAidPreview(row.request_id, 3, priced('round3_amount'))
}
