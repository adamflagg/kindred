/**
 * The three numbers a push report is summarised by (kindred#2477).
 *
 * All three read `PushBuildingReport.cls`, which is `classify_push`'s own
 * word computed SERVER-SIDE — inside a scenario the client never reads
 * `lodging_write_ins` at all, so there is no TS mirror of the classifier and
 * nothing here re-derives one. These are arithmetic over a published verdict.
 *
 * The class contract they lean on (`api/services/lodging_rules.py`):
 * `add` has draft rows and no live ones, `remove` has live rows and no draft
 * ones, `match` has both and they agree, `conflict` has both and they do not.
 */
import type { PushBuildingReport } from '../../services/lodgingApi'

/**
 * What a push with no decisions to make would actually write.
 *
 * `add`-class draft rows ONLY: `execute_push`'s `match` branch writes
 * nothing — it increments `matched` and never extends `adds` or `removes` —
 * and matches are the common case, not the exception, so summing every
 * building's draft rows overcounts almost every push.
 */
export function pushableRows(buildings: readonly PushBuildingReport[]): number {
  return buildings.filter((b) => b.cls === 'add').reduce((total, b) => total + b.draft.length, 0)
}

/**
 * Buildings staff must rule on before a push can apply. `conflict` and
 * `remove` only — an `add` or `match` building is shown for audit and is
 * never queued (kindred#2477 design contract).
 *
 * BUILDINGS, not rows, because that is the grain a verdict is given at:
 * `decisions` is keyed on `PushBuildingReport.key` and one card in the deck
 * settles the whole building.
 */
export function decisionsNeeded(buildings: readonly PushBuildingReport[]): number {
  return buildings.filter((b) => b.cls === 'conflict' || b.cls === 'remove').length
}

/**
 * How much work this report represents — the badge on the board's "Push
 * write-ins" button (owner ruling 2026-08-28).
 *
 * ROWS a push would write or delete, counted once each: an `add` building's
 * draft rows are created, a `conflict` building's draft rows replace what is
 * live, and a `remove` building's live rows are deleted. `match` buildings
 * contribute nothing, which is the entire point — the badge used to count
 * the board's own write-ins, so a weekend whose write-ins had all been
 * pushed already still read a large number staff had to open the modal to
 * disbelieve.
 *
 * Takes ONE side of each building, never both: a conflict resolved to the
 * scenario deletes the live rows and writes the draft ones, but staff are
 * being asked about one building's worth of occupants, and the deck is where
 * both sides get named. With nothing to decide this equals `pushableRows`,
 * so the badge and the modal's "Push N write-ins" CTA agree in the common
 * case.
 */
export function actionableRows(buildings: readonly PushBuildingReport[]): number {
  let total = 0
  for (const building of buildings) {
    if (building.cls === 'add' || building.cls === 'conflict') total += building.draft.length
    else if (building.cls === 'remove') total += building.live.length
  }
  return total
}
