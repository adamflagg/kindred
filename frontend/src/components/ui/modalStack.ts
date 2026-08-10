/**
 * How many `ui/Modal` dialogs are open, tracked at module scope.
 *
 * Module scope, not per-instance state, so that if a second dialog opens on
 * top of a first, the first closing doesn't remove the background `inert` out
 * from under the second — it only comes off once nothing needs it.
 *
 * A separate module rather than the top of `Modal.tsx` because `hasOpenModal`
 * is consumed OUTSIDE the modal (see below), and a `.tsx` file that exports
 * both a component and a plain function breaks Fast Refresh
 * (`react-refresh/only-export-components`). Nothing here renders, so this is
 * the file that rule asks for.
 */

let openDialogs = 0

export function acquireBackgroundInert(): void {
  openDialogs += 1
  if (openDialogs === 1) {
    document.getElementById('root')?.setAttribute('inert', '')
  }
}

export function releaseBackgroundInert(): void {
  openDialogs = Math.max(0, openDialogs - 1)
  if (openDialogs === 0) {
    document.getElementById('root')?.removeAttribute('inert')
  }
}

/**
 * Whether any `ui/Modal` is currently open.
 *
 * For a CONTAINER that closes itself on Escape and can host a dialog —
 * `weekend/FamilyDetailsPanel` is the first, via kindred#2073's "see members"
 * — to stand down while the dialog owns the key. Both listeners live on
 * `document`, so neither can stop the other by propagation: without this, one
 * Escape dismisses the dialog AND the surface underneath it, which is not
 * what the key was pressed for.
 *
 * Reads the same counter the inert bookkeeping uses rather than keeping a
 * second one, because that counter already IS "how many ui/Modals are open" —
 * incremented in the open effect, decremented in its cleanup. Deliberately a
 * function, not an exported boolean: a module-scope value read at import time
 * would freeze at `false`.
 */
export function hasOpenModal(): boolean {
  return openDialogs > 0
}
