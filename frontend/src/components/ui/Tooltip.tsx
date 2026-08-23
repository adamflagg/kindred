/**
 * A tooltip a keyboard and a touchscreen can actually reach (kindred#2177).
 *
 * The weekend lodging board explained a dozen chips, cells and counters with
 * the native `title` attribute alone. `title` fires on mouse hover and nothing
 * else: a staff member on a tablet, or moving by Tab, saw the chip and never
 * the sentence explaining it. `eslint-plugin-jsx-a11y` has no rule for that,
 * so the gap survived a whole a11y sweep.
 *
 * There was nothing here to extend — `CamperTooltip`, `WaitlistTooltip` and
 * `BunkCellTooltip` are chart-cell content renderers positioned by their
 * caller, not trigger primitives — so this is the one place the behaviour is
 * written down.
 *
 * Four decisions worth keeping:
 *
 * 1. **The bubble is portalled to `document.body`.** Three of the call sites
 *    sit inside a clipping ancestor (`HouseholdRosterTable`'s `overflow-x-auto`,
 *    `FamilyDetailsPanel`'s `overflow-y-auto`, `LodgingBoard`'s
 *    `overflow-hidden`), and `position: fixed` is not a way out of those when
 *    any ancestor is transformed. `BunkCellTooltip` portals for the same
 *    reason.
 *
 * 2. **No `aria-describedby` relationship at all — the bubble IS the
 *    description.** An earlier version mirrored `content` into a closed-state
 *    `sr-only` span so the attribute always resolved. `sr-only` clips
 *    visually but leaves the text rendered, so browser find-in-page matched
 *    every closed tooltip's sentence and scrolled to an invisible box
 *    (kindred#2348). No assistive tech reads this app (kindred#2249's
 *    `frontend/CLAUDE.md` policy) and the visible bubble already carries the
 *    text for anyone who opens it, so there is nothing left for the
 *    attribute to buy.
 *
 * 3. **A tap PINS the bubble; nothing dismisses it on a timer.** WCAG 2.2
 *    §1.4.13 requires hover/focus content to be persistent — visible until
 *    dismissed, until the pointer leaves, or until it stops being valid. A
 *    three-second fade would fail the very criterion this component exists to
 *    satisfy. It also matches the surface: `FloatingQueueBadge`, the nearest
 *    popover in `ui/`, is click-toggled, and no weekend surface auto-dismisses
 *    anything.
 *
 * 4. **Escape never lands on a BUBBLE-phase `document` listener.**
 *    `ui/modalStack` exists because two bubble-phase `document` listeners
 *    cannot stop each other by propagation, so one keypress dismissed a dialog
 *    AND the panel under it. Both of this component's Escape paths avoid that
 *    trap, and which one runs depends on where focus is:
 *
 *    - **Focus is on the trigger** (opened by Tab, or by a tap the browser
 *      focused): a React `onKeyDown`. React's handler runs at the root
 *      container, a descendant of `document`, so `stopPropagation` genuinely
 *      stops the native event before `FamilyDetailsPanel`'s or `Modal`'s
 *      listener sees it.
 *    - **Focus is elsewhere and the POINTER opened the bubble**: nothing on
 *      the trigger can see the key at all, and WCAG 1.4.13 "Dismissible"
 *      still requires a way out that does not move the pointer. So a
 *      `document` listener in the CAPTURE phase, which runs before the event
 *      has reached anything and can therefore stop every bubble-phase host
 *      listener with one `stopPropagation` — but ONLY once it has confirmed,
 *      via `ui/modalStack`'s overlay token stack, that this bubble is the
 *      TOPMOST open overlay. Capture always runs first regardless of open
 *      order, so an ungated version can beat a dialog that opens outside and
 *      AFTER a bubble a hovering pointer left open — kindred#2205's second
 *      finding, fixed the same way as the bubble-phase collision it names.
 *
 *    Either way the event is swallowed ONLY while a bubble is showing AND
 *    this bubble is topmost, and only for Escape; anything else passes
 *    straight through.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

import { acquireOverlayToken, isTopOverlay, releaseOverlayToken } from './modalStack'

export interface TooltipProps {
  /**
   * What the bubble carries when opened by hover, focus, or tap — usually a
   * sentence, occasionally a node (the need glyphs append the family's
   * explain paragraphs under their label). Still never a control: the bubble
   * is `role="tooltip"` and nothing inside it can take focus.
   */
  content: ReactNode
  /** The visible trigger content — a chip label, a count, a room name. */
  children: ReactNode
  /** Classes for the trigger itself: it replaces the `<span>` that used to carry `title`. */
  className?: string
  style?: CSSProperties
  /**
   * Only where the visible content does not already name the control. Most
   * triggers get their name from their own text and must not set this.
   */
  'aria-label'?: string
  'aria-pressed'?: boolean
  'data-testid'?: string
  /**
   * The trigger's OWN action, for an element that was already a control
   * (`MapUnitPopover`'s room cell picks the room). When set, a click runs the
   * action and does not pin — the bubble is already open from the hover or the
   * focus the tap produced.
   */
  onActivate?: () => void
  /**
   * Opt a purely informational trigger out of decision 3's tap-pins default.
   *
   * That default exists so a bubble a staff member opened stays readable while
   * they work beside it. Worth having where the sentence is something to act
   * on; it reads as a stuck popover where the sentence merely restates a value
   * already on screen. `HouseholdJourneyCard`'s provenance name is the second
   * kind — it says what staff typed that season and there is nothing to do
   * about it — so a click there should leave no residue (kindred#2332).
   *
   * This is NOT a way to make a tooltip mouse-only: the trigger stays a
   * focusable button and Tab still opens the bubble.
   */
  pinOnClick?: boolean
  /**
   * Reports open/close TRANSITIONS of the bubble, once each — the
   * lazy-content affordance. The need glyphs mount a permission-gated fetch
   * on the first `true` and drop what it brought on `false`, which is what
   * keeps ~82 cards from fetching a medical payload nobody asked to read.
   * Not called at mount: a closed bubble is not a transition. Hover and
   * focus arriving together are ONE open — a consumer mounting work on
   * `true` must not see it remount for the same bubble.
   */
  onOpenChange?: ((open: boolean) => void) | undefined
}

/**
 * Guarantees a 24x24 CSS-pixel target (WCAG 2.5.8) around triggers as small as
 * a two-digit occupancy figure, without drawing anything.
 *
 * A transparent pseudo-element rather than padding, and emphatically not a
 * visible box: `LodgingUnitCard` already spends a dashed border on "empty
 * room", and the board's signal vocabulary has no room for a fifth mark. The
 * pseudo-element grows only where the trigger is under 24px, so a wide chip is
 * untouched.
 */
const HIT_TARGET =
  "relative after:absolute after:top-1/2 after:left-1/2 after:h-[max(100%,24px)] after:w-[max(100%,24px)] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"

/** `HouseholdRosterRow`'s ring, so a focused chip looks like a focused row. */
const FOCUS_RING = 'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none'

export function Tooltip({
  content,
  children,
  className = '',
  style,
  'aria-label': ariaLabel,
  'aria-pressed': ariaPressed,
  'data-testid': testId,
  onActivate,
  pinOnClick = true,
  onOpenChange,
}: TooltipProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  /**
   * Did the focus about to arrive come from a POINTER press?
   *
   * A browser focuses a <button> on pointer-down, so on a `pinOnClick={false}`
   * trigger a click would otherwise hold the bubble open through `focused`
   * long after the pointer left — the very thing that opt-out exists to
   * prevent. A ref rather than state: it is read inside the focus handler that
   * fires in the same tick, and re-rendering on it would buy nothing.
   *
   * Cleared on blur, so a later Tab return is keyboard focus again and opens
   * the bubble normally.
   */
  const focusCameFromPointer = useRef(false)

  const [hovering, setHovering] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pinned, setPinned] = useState(false)
  // Escape suppresses a bubble whose reason to be open (focus on the trigger)
  // has not gone away. Cleared by the next deliberate interaction, so the
  // trigger is not left mute for as long as it holds focus.
  const [dismissed, setDismissed] = useState(false)

  const open = !dismissed && (hovering || focused || pinned)

  // The transition report, via refs rather than effect deps: the callback's
  // identity must not matter (a caller passing an inline closure would
  // otherwise re-fire the effect every render), and only a CHANGE of `open`
  // is a transition — mount with a closed bubble says nothing.
  const onOpenChangeRef = useRef(onOpenChange)
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  }, [onOpenChange])
  const reportedOpenRef = useRef(false)
  useEffect(() => {
    if (reportedOpenRef.current === open) return
    reportedOpenRef.current = open
    onOpenChangeRef.current?.(open)
  }, [open])

  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const anchor = triggerRef.current
      const bubble = bubbleRef.current
      if (!anchor || !bubble) return
      const rect = anchor.getBoundingClientRect()
      const width = bubble.offsetWidth
      const height = bubble.offsetHeight
      const EDGE = 6
      // Above by default, flipped below when there is no room. The bubble's
      // own transparent padding IS the visual gap, so its box touches the
      // trigger's — a pointer travelling up to read it never crosses dead
      // space, which is what keeps `relatedTarget` inside the bubble and the
      // bubble open (WCAG 1.4.13 "hoverable").
      const above = rect.top - height
      const top = above < EDGE ? rect.bottom : above
      const centred = rect.left + rect.width / 2 - width / 2
      const left = Math.max(EDGE, Math.min(centred, window.innerWidth - width - EDGE))
      setCoords({ top, left })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, content])

  // Pointer-down anywhere else drops a pinned bubble. `pointerdown`, not
  // `keydown` — nothing here competes with the Escape coordination in
  // `modalStack`.
  useEffect(() => {
    if (!pinned) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && (triggerRef.current?.contains(target) ?? false)) return
      if (target && (bubbleRef.current?.contains(target) ?? false)) return
      setPinned(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [pinned])

  // The pointer-opened half of the Escape story — see decision 4 in the file
  // header for why this is the CAPTURE phase and why it only exists while
  // focus is somewhere other than the trigger.
  //
  // kindred#2205: capture always runs before ANY bubble-phase overlay, no
  // matter which one opened more recently — that's what lets it beat
  // `ui/Modal`'s listener when the bubble is INSIDE the dialog. Left
  // ungated, it is exactly as able to beat a dialog that opens OUTSIDE and
  // AFTER a stale hover bubble (mouse resting on a trigger while a click or
  // Tab elsewhere opens a modal) — a fresh instance of the same defect. This
  // component still registers in the shared overlay stack and only acts —
  // swallowing the key and dismissing itself — while it is the topmost
  // overlay; otherwise it lets the event continue so whichever overlay
  // really is on top (its own bubble-phase listener, gated the same way)
  // gets it.
  useEffect(() => {
    if (!open || focused) return
    const token = acquireOverlayToken()
    const onEscapeCapture = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (!isTopOverlay(token)) return
      event.stopPropagation()
      setPinned(false)
      setHovering(false)
      setDismissed(true)
    }
    document.addEventListener('keydown', onEscapeCapture, true)
    return () => {
      document.removeEventListener('keydown', onEscapeCapture, true)
      releaseOverlayToken(token)
    }
  }, [open, focused])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-pressed={ariaPressed}
        data-testid={testId}
        style={style}
        className={`${HIT_TARGET} ${FOCUS_RING} ${onActivate ? '' : 'cursor-help'} ${className}`}
        onPointerEnter={() => {
          setDismissed(false)
          setHovering(true)
        }}
        onPointerDown={() => {
          focusCameFromPointer.current = true
        }}
        // No "did the pointer land on the bubble" guard here, deliberately.
        // React synthesises leave AND enter from the SAME native `pointerout`,
        // so a pointer moving straight from the trigger onto the bubble runs
        // both handlers in one batch and `hovering` never settles false. What
        // makes that reliable is the bubble's transparent bridge — see
        // `place` — which leaves no gap for the pointer to fall through.
        onPointerLeave={() => {
          setHovering(false)
        }}
        onFocus={() => {
          // A pointer press focuses this button as a side effect. On a trigger
          // that has opted out of pinning, honouring that focus would keep the
          // bubble open after the pointer left and look identical to the pin
          // the opt-out removed. Keyboard focus arrives with no preceding
          // pointer press and still opens it.
          if (!pinOnClick && focusCameFromPointer.current) return
          setFocused(true)
        }}
        onBlur={() => {
          focusCameFromPointer.current = false
          setFocused(false)
          setPinned(false)
          setDismissed(false)
        }}
        onClick={() => {
          setDismissed(false)
          if (onActivate) {
            onActivate()
            return
          }
          if (!pinOnClick) return
          setPinned((wasPinned) => !wasPinned)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !open) return
          // Only swallowed while something is showing — see the file header.
          event.stopPropagation()
          setPinned(false)
          setHovering(false)
          setDismissed(true)
        }}
      >
        {children}
      </button>

      {open &&
        createPortal(
          <div
            ref={bubbleRef}
            role="tooltip"
            style={{ top: coords.top, left: coords.left }}
            // `py-1.5` is transparent bridge, not spacing — see `place`.
            className="fixed z-[100] max-w-[18rem] py-1.5"
            onPointerEnter={() => {
              setHovering(true)
            }}
            onPointerLeave={() => {
              setHovering(false)
            }}
          >
            {/* `BunkCellTooltip`'s popover surface, so the board's two tooltip
                shapes read as one thing. */}
            <div className="bg-popover text-popover-foreground border-border rounded-lg border px-2.5 py-1.5 text-xs leading-snug shadow-lg">
              {content}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
