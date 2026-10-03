/**
 * Camperships' page keys are owner-ruled product features, kept to their ruled scope (Decision 6,
 * RULED 2026-10-01): `/` focuses the jump box (D13), ↑/↓ highlight a row (D31). Slice 1 adds
 * `[`/`]` (D13). They aren't accessibility work. They are `window` listeners that stand aside
 * whenever a field owns the key, a modifier is held, or a modal is open
 * (Ruling 2026-10-01 (plan review)).
 */
import { hasOpenModal } from '../../ui/modalStack'

/** Inputs whose keys are not text or arrows; everything else (text, number, date/time, range, radio) owns the key. */
const NOT_TYPING = new Set([
  'checkbox',
  'button',
  'submit',
  'reset',
  'image',
  'file',
  'color',
  'hidden',
])

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('[contenteditable]:not([contenteditable="false"])') !== null) return true
  if (target instanceof HTMLInputElement) return !NOT_TYPING.has(target.type)
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

export interface PageKeyEvent {
  readonly target: EventTarget | null
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly defaultPrevented: boolean
  readonly repeat: boolean
  readonly isComposing: boolean
}

/**
 * A key the page may act on: no modifier held, not already handled, held down or part of an IME
 * composition, no field typing, no modal open.
 */
export function isPageKey(event: PageKeyEvent): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing) return false
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  return !isTypingTarget(event.target) && !hasOpenModal()
}

/** The page's own character keys (D13): the jump box's `/` and the walk's `[` and `]`. */
const PAGE_CHARACTERS: ReadonlySet<string> = new Set(['/', '[', ']'])

/**
 * Someone trying to type where the page owns the key (owner fast-follow (a), 10-03): one printable
 * character, not a space and not one of the page's own keys. A row that can't take an ask says
 * why only then, not every time it opens.
 */
export function isTypingAttempt(event: PageKeyEvent & { readonly key: string }): boolean {
  return (
    event.key.length === 1 &&
    event.key.trim() !== '' &&
    !PAGE_CHARACTERS.has(event.key) &&
    isPageKey(event)
  )
}
