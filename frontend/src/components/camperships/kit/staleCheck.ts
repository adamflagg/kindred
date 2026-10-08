/**
 * The fresh-read check slice 3's editors make (Decision P-9; owner ruling 2026-10-02): no source,
 * group, grantor or commitment route takes a precondition, so an editor re-reads its record past the
 * cache when it opens and again just before it sends. If a watched field moved in between, it sends
 * nothing, names what moved and re-bases: the draft is rebuilt from the latest read plus only the
 * fields the person changed (`rebase`), so a second Save never writes back a stale value of a field
 * they didn't touch (review R3-1). Otherwise (and on a second Save) the later save wins.
 */

/** The labels of the watched fields that differ between the record as opened and as it is now. */
export function movedFields<T>(
  opened: T,
  latest: T,
  watched: ReadonlyArray<readonly [keyof T, string]>
): string[] {
  return watched
    .filter(([key]) => JSON.stringify(opened[key]) !== JSON.stringify(latest[key]))
    .map(([, label]) => label)
}

/**
 * "Someone changed this since you opened it: Programs. Nothing was saved. Your changes are kept;
 * everything else now shows the latest. Save again to put your edit in its place." The editor
 * re-bases (`rebase`), so a second Save is a choice made knowing what moved.
 */
export function movedWords(moved: readonly string[]): string {
  return `Someone changed this since you opened it: ${moved.join(', ')}. Nothing was saved. Your changes are kept; everything else now shows the latest. Save again to put your edit in its place.`
}

/**
 * The draft after a detected move (review R3-1): every field from the latest record's draft, except
 * the ones the person changed since the editor opened (typed differs from opened), which keep their
 * typing. Each editor's draft is a plain object of its fields, so a field nobody touched follows the
 * latest (the other person's change survives the second Save) and the note the person typed stays.
 */
export function rebase<D extends object>(openedDraft: D, latestDraft: D, typedDraft: D): D {
  const next = { ...latestDraft }
  for (const key of Object.keys(typedDraft) as Array<keyof D>) {
    if (JSON.stringify(typedDraft[key]) !== JSON.stringify(openedDraft[key])) {
      next[key] = typedDraft[key]
    }
  }
  return next
}

/** The editor's first read failed: nothing can be saved until it loads (R3-13: a read, not a write). */
export const OPEN_READ_FAILED =
  "Couldn't load the latest for this. Nothing can be saved until it loads: close this and try again."

/** The re-check just before sending failed: nothing was sent (R3-13: never "can't tell whether it saved"). */
export const RECHECK_FAILED =
  "Couldn't re-check the latest just before saving; nothing was saved. Try again."
