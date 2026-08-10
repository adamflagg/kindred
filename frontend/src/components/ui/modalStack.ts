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
 *
 * Deliberately its own counter, separate from the overlay token stack below:
 * `inert` is a "is ANY real dialog blocking the background" question that
 * only `ui/Modal` answers, while the token stack tracks every
 * independently-portalled overlay (tooltips, confirm popovers) that has no
 * business making the rest of the page inert.
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
 * kindred#2205. A LIFO stack of tokens, one per currently-open,
 * independently-portalled overlay — `ui/Modal`, `ConfirmActionPopover`,
 * `ui/Tooltip`'s pointer-opened bubble. Each acquires a token on open and
 * releases it on close; whichever token is on TOP owns the next Escape
 * keypress, and only that one.
 *
 * This widens the plain open-dialog counter above rather than replacing it.
 * The counter answers "is any `ui/Modal` open" (for `inert`); this answers
 * "which overlay, among however many are stacked, gets Escape right now" —
 * `ui/Modal` alone couldn't answer that once a second `ui/Modal` (or a
 * non-Modal overlay) opens on top of a first, because a bare count has no way
 * to ask "am I the topmost one?".
 *
 * A `symbol` per acquisition, not an incrementing id: identity comparison is
 * all `isTopOverlay` needs, and a symbol can't collide with a stale numeric
 * id a caller forgot to bump.
 */
export type OverlayToken = symbol

const overlayStack: OverlayToken[] = []

/** Registers a new overlay as the current topmost. Release it on close. */
export function acquireOverlayToken(): OverlayToken {
  const token = Symbol('overlay')
  overlayStack.push(token)
  return token
}

/**
 * Releases a token, wherever it sits in the stack — not only from the top.
 * An overlay in the middle can close first (e.g. a background `ui/Modal`
 * dismissed by something other than Escape while a popover on top of it
 * stays open), and removing by identity rather than by popping keeps the
 * overlay still on top correctly on top.
 */
export function releaseOverlayToken(token: OverlayToken): void {
  const index = overlayStack.indexOf(token)
  if (index !== -1) overlayStack.splice(index, 1)
}

/** Whether `token` is the topmost registered overlay right now. */
export function isTopOverlay(token: OverlayToken): boolean {
  return overlayStack.length > 0 && overlayStack[overlayStack.length - 1] === token
}

/**
 * Whether any overlay — `ui/Modal` or otherwise — is currently open.
 *
 * For a CONTAINER that closes itself on Escape and can host a dialog —
 * `weekend/FamilyDetailsPanel` is the first, via kindred#2073's "see members"
 * — to stand down while the dialog owns the key. Both listeners live on
 * `document`, so neither can stop the other by propagation: without this, one
 * Escape dismisses the dialog AND the surface underneath it, which is not
 * what the key was pressed for.
 *
 * Reads the overlay stack's length, not the `inert` counter above: a
 * container needs to stand down for ANY overlay on top of it, `ui/Modal` or
 * not — the case this function was named for still holds (`ui/Modal` was the
 * only registrant when it shipped), it's just no longer the only kind that
 * counts. Deliberately a function, not an exported boolean: a module-scope
 * value read at import time would freeze at `false`.
 */
export function hasOpenModal(): boolean {
  return overlayStack.length > 0
}
