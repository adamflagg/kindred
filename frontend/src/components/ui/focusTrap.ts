/**
 * Keeping Tab inside a small popover. Focus management serves every keyboard
 * user, so it stays under the minimal-accessibility policy (frontend/CLAUDE.md).
 *
 * EVERY focusable counts -- ConfirmActionPopover's first version collected
 * only `button`s, so any other control inside it fell outside its own trap.
 */
const FOCUSABLE =
  'button:not([disabled]):not([tabindex="-1"]), [href]:not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
}

/** Cycle Tab / Shift+Tab inside `root`. Returns true when it handled the key. */
export function trapTab(event: KeyboardEvent, root: HTMLElement | null): boolean {
  if (event.key !== 'Tab' || !root) return false
  const items = focusableWithin(root)
  if (items.length === 0) return false
  event.preventDefault()
  const index = items.indexOf(document.activeElement as HTMLElement)
  const next = event.shiftKey
    ? items[index <= 0 ? items.length - 1 : index - 1]
    : items[index >= items.length - 1 ? 0 : index + 1]
  next?.focus()
  return true
}
