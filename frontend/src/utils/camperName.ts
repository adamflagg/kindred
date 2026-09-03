/**
 * Name fallbacks for campers, where the operator is the whole point.
 */

/**
 * The camper name shown in the lock-group conflict dialog.
 *
 * `||`, not `??`, and that is deliberate. Both fields carry `''` rather than
 * `undefined` when the value is absent: `transforms.ts` writes
 * `first_name: person.first_name || ''`, and PocketBase zero-values scalars
 * rather than omitting them (measured -- every key present on every record),
 * which is also why `pocketbase-types.ts` wrapping records in `Required<>` is
 * accurate rather than a lie. With `??` neither fallback can ever fire and the
 * dialog renders a blank name. Same class as `weekend/partyKey.ts`, where
 * party ids serialize as `0`.
 *
 * Extracted from `LockGroupContext` and `LockGroupActionBar`, which had the
 * expression duplicated.
 */
export function resolveCamperName(camper: { name: string; first_name?: string }): string {
  // `prefer-nullish-coalescing` wants `??` on the second link because
  // `first_name` is optional. It is wrong here for the reason above, and this
  // is the one place that reasoning has to live rather than being repeated at
  // each call site.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return camper.name || camper.first_name || 'Camper'
}
