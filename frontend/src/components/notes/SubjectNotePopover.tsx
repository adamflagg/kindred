/**
 * The card-level note editor, as locked (owner, 2026-09-25): an anchored
 * popover beside the card, portaled. No modal, no inline expansion.
 *
 * - Escape discards through `useOverlayEscape`. Its token is acquired after
 *   any panel beneath, so it closes first.
 * - A click outside with unsaved text SAVES (sticky-note behaviour); with
 *   nothing typed it closes. A second press on the corner that opened it
 *   keeps it open.
 * - Scrolling never closes it: `useAnchoredOverlay` re-places it instead.
 * - `mousedown` stops here, so the unplaced queue's click-outside
 *   (`FloatingQueueBadge`, a bubble-phase document listener) never collapses
 *   the queue under a click inside the popover.
 * - `role="dialog"` also keeps `shouldKeepPanelsOpen` from treating a click
 *   inside it as dead space.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { useOverlayEscape } from '../../hooks/useOverlayEscape'
import { useAnchoredOverlay } from '../ui/useAnchoredOverlay'
import { cardFor } from './cardFor'
import type { EditorTarget, SubjectNotesScopeValue } from './subjectNotesContext'
import { NOTE_LABEL, subjectKey } from './subjectNoteModel'
import { SubjectNoteEditor } from './SubjectNoteEditor'
import { useSubjectNoteEditor, type SubjectNoteEditorModel } from './useSubjectNoteEditor'

/**
 * A pending "eat the next click" guard, installed by a pointerdown on the
 * corner that opened this popover -- pressing it again must keep the popover
 * open rather than read as an outside click, but the `click` event that
 * follows that same physical press still needs to be kept from reaching the
 * corner's own `onClick` (a second, redundant `openEditor`) or any OTHER
 * document listener beneath it.
 *
 * Held in a ref, not a bare `document.addEventListener(..., { once: true })`
 * plus an untracked `setTimeout`: unremoved, that pairing outlives
 * this popover and eats a click meant for something else entirely -- in
 * tests, the NEXT TEST's corner click within the same file (Vitest isolates
 * *files*, not tests, so a leak reaches across `it` blocks but not across
 * files); in the app, a corner press, a drag off it, then a click elsewhere
 * within 400ms. Removed on the next pointerdown this hook sees and in its own
 * effect cleanup, so the guard can never outlive the popover that installed
 * it.
 */
interface PendingEater {
  eat: (event: MouseEvent) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Chrome and Firefox dispatch `pointerdown` to a SCROLL CONTAINER when its own
 * scrollbar is pressed, not just when its content is. Left untested, that
 * reads as an outside click and closes the popover on a scrollbar drag inside
 * the unplaced queue (`FloatingQueueBadge.tsx`), `SlideInPanel.tsx`, or
 * `CamperDetailsPanel.tsx` -- breaking the locked "scrolling never closes it"
 * rule. `event.offsetX`/`offsetY` are target-relative, so a press past
 * `clientWidth`/`clientHeight` landed in the gutter the scrollbar itself
 * occupies. Gated on the element actually HAVING a gutter
 * (`offsetWidth > clientWidth` or `offsetHeight > clientHeight`): an element
 * with `clientWidth === 0` (an inline element, or anything unmeasured under
 * jsdom) would otherwise satisfy `offsetX >= clientWidth` for every press and
 * swallow every genuine outside click.
 */
function isScrollbarGutterPress(event: PointerEvent, target: Element): boolean {
  if (!(target instanceof HTMLElement)) return false
  const hasGutter =
    target.offsetWidth > target.clientWidth || target.offsetHeight > target.clientHeight
  if (!hasGutter) return false
  return event.offsetX >= target.clientWidth || event.offsetY >= target.clientHeight
}

function useOutsidePointer(
  model: SubjectNoteEditorModel,
  containerRef: RefObject<HTMLElement | null>,
  cornerKey: string
) {
  const latest = useRef(model)
  useLayoutEffect(() => {
    latest.current = model
  })
  const pendingEater = useRef<PendingEater | null>(null)

  useEffect(() => {
    const clearPendingEater = () => {
      const pending = pendingEater.current
      if (!pending) return
      document.removeEventListener('click', pending.eat, true)
      clearTimeout(pending.timer)
      pendingEater.current = null
    }

    const swallowNextClick = (event: PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const eat = (click: MouseEvent) => {
        click.preventDefault()
        click.stopPropagation()
        clearPendingEater()
      }
      const timer = setTimeout(clearPendingEater, 400)
      pendingEater.current = { eat, timer }
      document.addEventListener('click', eat, { capture: true, once: true })
    }

    const onPointerDown = (event: PointerEvent) => {
      // Any eater from a PRIOR pointerdown has done its job (or overstayed
      // it) by the time another pointerdown lands -- drop it before deciding
      // what this one means.
      clearPendingEater()
      const target = event.target as Element | null
      if (!target || containerRef.current?.contains(target)) return
      if (isScrollbarGutterPress(event, target)) return
      if (target.closest(`[data-note-corner-for="${cornerKey}"]`)) {
        swallowNextClick(event)
        return
      }
      const current = latest.current
      if (current.dirty) void current.save()
      else current.discard()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      clearPendingEater()
    }
  }, [containerRef, cornerKey])
}

export function SubjectNotePopover({
  scope,
  target,
}: {
  scope: SubjectNotesScopeValue
  target: EditorTarget
}) {
  const model = useSubjectNoteEditor(scope, target)
  const { ref, position } = useAnchoredOverlay<HTMLDivElement>({
    open: true,
    getAnchorRect: () => cardFor(target.anchorEl)?.getBoundingClientRect() ?? null,
    placement: 'beside',
  })
  useOverlayEscape(true, model.discard)
  useOutsidePointer(model, ref, subjectKey(target.subject))
  // Focus restore (frontend/CLAUDE.md): the anchor corner's own button, not
  // whatever was focused before opening -- a click that opened this popover
  // does not reliably leave focus on the corner across browsers, so this is
  // more reliable than ConfirmActionPopover's plain capture-and-restore, and
  // is simpler here since the anchor is already at hand.
  //
  // Only when nothing else already claimed it: a DIRTY popover unmounts only
  // once `save()` resolves -- a network round trip after whatever click
  // started it -- so by the time this cleanup runs, that same click may
  // already have moved focus somewhere real (the "Elsewhere" button, an
  // input on the page). Reclaiming it there would yank focus away from what
  // the user is doing, and a programmatic focus on the corner also reopens
  // its Tooltip preview (it hits Tooltip's `onFocus`) as an unwanted side
  // effect. So this only fires when focus is either nowhere in particular
  // (`document.body`, e.g. Escape/Cancel closing synchronously) or still
  // somewhere inside this popover's own subtree (captured once at mount,
  // since `ref.current` is not reliably still attached to the tree by the
  // time an unmounting component's own cleanup runs -- `Node.contains` works
  // on a detached subtree exactly as it does on an attached one).
  useEffect(() => {
    const container = ref.current
    return () => {
      const active = document.activeElement
      if (active === document.body || (container?.contains(active) ?? false)) {
        target.anchorEl?.querySelector<HTMLElement>('button')?.focus()
      }
    }
  }, [target.anchorEl, ref])

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={NOTE_LABEL}
      data-note-popover
      // Above the unplaced queue (z-[70]) and the slide-in panels (z-[60]).
      className="animate-scale-in fixed z-[80]"
      style={{
        width: 340,
        maxWidth: 'calc(100vw - 16px)',
        left: position?.left ?? -9999,
        top: position?.top ?? 0,
      }}
      onMouseDown={(event) => {
        event.stopPropagation()
      }}
    >
      <SubjectNoteEditor model={model} framed />
    </div>,
    document.body
  )
}
