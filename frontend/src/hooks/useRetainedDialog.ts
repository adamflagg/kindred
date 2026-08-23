import { useCallback, useState } from 'react'

export interface RetainedDialog<T> {
  /**
   * The retained snapshot — `null` until the first open, then kept ACROSS the
   * close. Gate the dialog on it (`{data && <Modal …>}`); driving the gate
   * from `isOpen` instead is the bug this hook exists to prevent.
   */
  data: T | null
  /** Drives `Modal`'s `isOpen`, and nothing else. */
  isOpen: boolean
  /**
   * Bumped on every open. Key the dialog's CONTENT on it — never `<Modal>`
   * itself; see the hook docstring.
   */
  nonce: number
  /** Take the snapshot, open, bump the nonce. */
  open: (data: T) => void
  /** `Modal`'s `onClose`: clears the open flag only. The snapshot survives. */
  close: () => void
  /** `Modal`'s `afterLeave`: the fade has finished, release the snapshot. */
  afterLeave: () => void
}

export interface UseRetainedDialogOptions {
  /**
   * OPT-IN answer to transient source loss — see the hook docstring's third
   * section. `true` closes the dialog and drops the snapshot AT RENDER TIME;
   * omitted (the default) latches, and a source that vanishes and returns
   * leaves the dialog exactly as the staffer left it.
   */
  resetWhen?: boolean
}

interface RetainedDialogState<T> {
  data: T | null
  isOpen: boolean
  nonce: number
}

/**
 * One home for the retained-snapshot dialog pattern (kindred#2541), extracted
 * from the four sites that hand-rolled it in kindred#2539.
 *
 * ## Why a dialog needs a retained snapshot at all
 *
 * `ui/Modal` plays a 150ms leave transition (kindred#2530). A parent whose
 * mount gate IS its close mechanism — `{selected && <Modal isOpen …>}` where
 * `onClose` nulls `selected` — unmounts the dialog on the frame the close
 * fires, and the transition never gets to play. The fix separates the two
 * concerns: the dialog's DATA becomes a snapshot that outlives the close, and
 * a dedicated flag drives `isOpen`.
 *
 *     const editor = useRetainedDialog<UnitRecord>()
 *     …
 *     {editor.data && (
 *       <Modal isOpen={editor.isOpen} onClose={editor.close} afterLeave={editor.afterLeave}>
 *         <UnitForm key={editor.nonce} unit={editor.data} />
 *       </Modal>
 *     )}
 *
 * ## The two details this hook exists to encode, both paid for in #2539
 *
 * 1. **Key the CONTENT, not the Modal chrome.** A reopen that interrupts the
 *    exit fade must not remount `<Modal>` — the fading chrome would snap away
 *    mid-transition. `nonce` goes on what is INSIDE the dialog. Keying on the
 *    record's own id is not the same thing and is not enough: reopening the
 *    SAME record leaves the key unchanged, React reuses the instance, and the
 *    abandoned draft from the cancelled edit is still in the fields for the
 *    next Save to write (#2539 scan finding 1, reproduced as a real defect).
 * 2. **`afterLeave` never fires on an interrupted leave**, and that is
 *    correct — the dialog is open again and still needs its data. Which is
 *    precisely why the NONCE, not `afterLeave`, is what guarantees a fresh
 *    mount. `afterLeave` is only the housekeeping half: it releases the
 *    snapshot once the fade has actually completed, so the parent stops
 *    re-evaluating a dialog subtree the closed `<Transition>` discards.
 *
 * Deliberately NOT solved by making `ui/Modal` retain its last non-null
 * children internally: that makes Modal cache renders behind its callers'
 * backs and breaks the "children unmount while closed" property the
 * kindred#2529 / #2538 audits rely on. Rejected on purpose; do not revive it.
 *
 * ## Transient source loss — the position, and why it is a knob
 *
 * A retained dialog's source can vanish briefly: a refetch gap, a weekend
 * switch, a parent that `return null`s while its query is in flight. There
 * are exactly two defensible answers and this codebase has shipped both, so
 * the hook makes the choice explicit at the call site instead of letting each
 * consumer re-derive one by accident.
 *
 * - **Latch (the default).** The dialog survives the blip. When the source
 *   returns the dialog is still open — which, if the parent unmounted it, is
 *   a dialog that re-opens itself with no click. That is the cohort
 *   drill-down's long-standing behaviour (`CamperCohortsSection` returns null
 *   while `useCamperCohorts` is loading), and the owner ruled on 2026-08-22
 *   not to patch it ad hoc: the alternative closes a dialog a staffer is
 *   actively reading, on an ordinary refetch blip, which is the worse
 *   failure. All four #2539 sites take this answer.
 * - **Reset (`resetWhen`).** The dialog closes and forgets, at render time,
 *   the moment the caller says its source is gone. `SessionLastUploadChip`
 *   took this answer for a real defect — a latched `open` across a transient
 *   summary loss re-opened its dialog via Modal's `appear`. Pass
 *   `{ resetWhen: !session || !runId }` for that shape. It forgoes the exit
 *   fade, deliberately: there is nothing to fade a vanished source out of.
 *
 * The chip itself is not a consumer here — its dialog is always mounted and
 * holds no snapshot, which its own pin requires — but its answer is what
 * `resetWhen` is.
 *
 * The reset is a render-time correction rather than an effect, following
 * `usePanelParty`: React discards this render's output and re-renders
 * synchronously with the corrected state, so there is no extra commit and no
 * paint of the wrong thing.
 *
 * Same hazard family, not covered by this hook because it is a missing `key`
 * rather than a missing reset: `CamperDetailsPanel` in `BunkingBoardByArea`
 * renders without a `key`, so switching campers while a drill-down is open
 * re-pops it under the previous camper's snapshot. A `key` on the panel is
 * that one's fix; `resetWhen` would only close the dialog, not re-target it.
 */
export function useRetainedDialog<T>(options?: UseRetainedDialogOptions): RetainedDialog<T> {
  // ONE state object, not three: `afterLeave` has to consult `isOpen` to know
  // whether releasing the snapshot is safe, and the updater form is how it
  // reads a value it is not allowed to close over. It also makes open/close
  // atomic — three separate setState calls can be interleaved by a caller
  // that only means to do one thing.
  const [state, setState] = useState<RetainedDialogState<T>>({
    data: null,
    isOpen: false,
    nonce: 0,
  })

  // Render-time correction. Guarded on the current state so the corrected
  // re-render does not re-enter it — this is a loop if it is unconditional.
  if (options?.resetWhen === true && (state.isOpen || state.data !== null)) {
    setState((s) => ({ ...s, data: null, isOpen: false }))
  }

  const open = useCallback((data: T) => {
    // The nonce is monotonic and bumps on EVERY open, same record or not.
    setState((s) => ({ data, isOpen: true, nonce: s.nonce + 1 }))
  }, [])

  const close = useCallback(() => {
    setState((s) => ({ ...s, isOpen: false }))
  }, [])

  const afterLeave = useCallback(() => {
    setState((s) => (s.isOpen ? s : { ...s, data: null }))
  }, [])

  return { data: state.data, isOpen: state.isOpen, nonce: state.nonce, open, close, afterLeave }
}
