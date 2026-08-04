/**
 * The one reading of the `sleeps` field, shared by everything that needs it.
 *
 * Two consumers must agree: `LodgingUnitForm` parses it to build the payload,
 * and `capacityFlag` parses it to decide what to say about it. Parsing it
 * twice invites them to drift, and a flag that reports on a different number
 * than the save will store is worse than no flag.
 *
 * `Number`, not `Number.parseInt`. `<input type="number">` accepts any valid
 * floating-point literal, so "1e2" reaches the handler intact and parseInt
 * stops at the `e` — classifying and saving 100 as 1.
 */

/** null means UNKNOWN — blank, zero, negative or unreadable. */
export function parseSleeps(raw: string): number | null {
  const value = Number(raw)
  // One check covers every unknown, which is why there is no separate blank
  // guard: `Number` trims its input and reads "" and "   " as 0, so a blank
  // field arrives here as 0 and leaves as null alongside the negatives and
  // NaN. None of them is a number of people, and 0 is how PocketBase spells
  // an unset number anyway.
  if (!Number.isFinite(value) || value <= 0) return null

  // The column is onlyInt, so a fraction cannot be stored. Truncate rather
  // than reject: rejecting would send an explicit 0 on the edit path and clear
  // a number the staffer was halfway through correcting.
  return Math.floor(value)
}
