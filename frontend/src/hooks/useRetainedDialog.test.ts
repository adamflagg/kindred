/**
 * TDD tests for useRetainedDialog (kindred#2541).
 *
 * Written FIRST, against a hook that does not exist yet. These are the
 * specification of the retained-snapshot pattern PR #2539 hand-rolled in four
 * places: the dialog's DATA outlives the close so `ui/Modal`'s 150ms leave
 * transition has something to paint, a separate flag drives `isOpen`, and a
 * per-open nonce keys the dialog's CONTENT so every open remounts fresh.
 *
 * The behaviour pins in CamperCohortsSection / IdentityPanel /
 * LodgingUnitsPanel / SessionLastUploadChip stay green unmodified — they are
 * the integration half of the same specification and this file is the unit
 * half.
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useRetainedDialog } from './useRetainedDialog'

interface Snapshot {
  id: string
}

describe('useRetainedDialog', () => {
  describe('initial state', () => {
    it('starts closed, with no snapshot', () => {
      const { result } = renderHook(() => useRetainedDialog<Snapshot>())

      expect(result.current.data).toBeNull()
      expect(result.current.isOpen).toBe(false)
    })
  })

  describe('open', () => {
    it('takes the snapshot, opens, and bumps the nonce', () => {
      const { result } = renderHook(() => useRetainedDialog<Snapshot>())
      const before = result.current.nonce

      act(() => result.current.open({ id: 'a' }))

      expect(result.current.data).toEqual({ id: 'a' })
      expect(result.current.isOpen).toBe(true)
      expect(result.current.nonce).not.toBe(before)
    })

    it('bumps the nonce on EVERY open, including a reopen of the same record', () => {
      // The nonce keys the dialog's CONTENT, so it is what guarantees a fresh
      // mount. Keying on the record id instead would not remount when the same
      // record is reopened — which is exactly the abandoned-draft hazard the
      // #2539 scan found at the lodging editor.
      const { result } = renderHook(() => useRetainedDialog<Snapshot>())
      const seen: number[] = []

      act(() => result.current.open({ id: 'a' }))
      seen.push(result.current.nonce)
      act(() => result.current.close())
      act(() => result.current.open({ id: 'a' }))
      seen.push(result.current.nonce)
      act(() => result.current.open({ id: 'b' }))
      seen.push(result.current.nonce)

      expect(new Set(seen).size).toBe(seen.length)
    })

    it('replaces the snapshot when a different record is opened while already open', () => {
      const { result } = renderHook(() => useRetainedDialog<Snapshot>())

      act(() => result.current.open({ id: 'a' }))
      act(() => result.current.open({ id: 'b' }))

      expect(result.current.data).toEqual({ id: 'b' })
      expect(result.current.isOpen).toBe(true)
    })
  })

  describe('close', () => {
    it('clears the open flag but RETAINS the snapshot — the fade still needs it', () => {
      // The whole point: `{data && <Modal isOpen={isOpen}>}` must keep
      // rendering through the leave. Dropping the data here is the bug this
      // pattern exists to prevent — the dialog would unmount on the frame the
      // close fires and the transition would never play.
      const { result } = renderHook(() => useRetainedDialog<Snapshot>())

      act(() => result.current.open({ id: 'a' }))
      act(() => result.current.close())

      expect(result.current.isOpen).toBe(false)
      expect(result.current.data).toEqual({ id: 'a' })
    })

    it('does not bump the nonce', () => {
      const { result } = renderHook(() => useRetainedDialog<Snapshot>())

      act(() => result.current.open({ id: 'a' }))
      const opened = result.current.nonce
      act(() => result.current.close())

      expect(result.current.nonce).toBe(opened)
    })
  })

  describe('afterLeave', () => {
    it('drops the snapshot once the fade has completed', () => {
      const { result } = renderHook(() => useRetainedDialog<Snapshot>())

      act(() => result.current.open({ id: 'a' }))
      act(() => result.current.close())
      act(() => result.current.afterLeave())

      expect(result.current.data).toBeNull()
      expect(result.current.isOpen).toBe(false)
    })

    it('is a no-op while the dialog is open — the snapshot is released only when closed', () => {
      // `ui/Modal` never fires afterLeave on an interrupted leave, so this
      // cannot arrive through Modal. The guard states the invariant anyway:
      // releasing the snapshot of an OPEN dialog would blank it mid-read.
      const { result } = renderHook(() => useRetainedDialog<Snapshot>())

      act(() => result.current.open({ id: 'a' }))
      act(() => result.current.afterLeave())

      expect(result.current.data).toEqual({ id: 'a' })
      expect(result.current.isOpen).toBe(true)
    })
  })

  describe('interrupted leave', () => {
    it('keeps the snapshot continuously across close → reopen, and bumps the nonce', () => {
      // An interrupted leave never unmounts the dialog's children and never
      // fires afterLeave — both correct, the dialog is open again and still
      // needs its data. So `afterLeave` cannot be what guarantees a fresh
      // mount; the nonce is.
      const { result } = renderHook(() => useRetainedDialog<Snapshot>())

      act(() => result.current.open({ id: 'a' }))
      const first = result.current.nonce
      act(() => result.current.close())
      expect(result.current.data).toEqual({ id: 'a' })
      // Reopen before afterLeave could ever fire.
      act(() => result.current.open({ id: 'a' }))

      expect(result.current.isOpen).toBe(true)
      expect(result.current.data).toEqual({ id: 'a' })
      expect(result.current.nonce).not.toBe(first)
    })
  })

  describe('transient source loss — the deliberate position', () => {
    it('LATCHES by default: a source that vanishes and returns leaves the dialog open', () => {
      // The cohort drill-down's behaviour, preserved. Its section returns null
      // while `cohorts` is refetching and the dialog re-opens itself when the
      // data comes back. Ruled 2026-08-22 not to patch ad hoc: closing a
      // dialog a staffer is actively reading, on an ordinary refetch blip, is
      // the worse failure.
      const { result, rerender } = renderHook(
        ({ lost }: { lost: boolean }) => useRetainedDialog<Snapshot>({ resetWhen: lost }),
        { initialProps: { lost: false } }
      )

      act(() => result.current.open({ id: 'a' }))
      rerender({ lost: false })

      expect(result.current.isOpen).toBe(true)
      expect(result.current.data).toEqual({ id: 'a' })
    })

    it('RESETS when resetWhen is true: closed and snapshot dropped, at render time', () => {
      // The chip's answer, made explicit. A render-time correction, not an
      // effect — React discards this render and re-renders with the corrected
      // state before anything commits, so there is no extra paint (same shape
      // as usePanelParty's render-time clearing).
      const { result, rerender } = renderHook(
        ({ lost }: { lost: boolean }) => useRetainedDialog<Snapshot>({ resetWhen: lost }),
        { initialProps: { lost: false } }
      )

      act(() => result.current.open({ id: 'a' }))
      rerender({ lost: true })

      expect(result.current.isOpen).toBe(false)
      expect(result.current.data).toBeNull()
    })

    it('does not re-pop the dialog when the source returns', () => {
      // The chip pin's shape: `open` used to survive the loss, so the
      // always-mounted dialog re-opened itself via Modal's `appear` the moment
      // data returned — with no click.
      const { result, rerender } = renderHook(
        ({ lost }: { lost: boolean }) => useRetainedDialog<Snapshot>({ resetWhen: lost }),
        { initialProps: { lost: false } }
      )

      act(() => result.current.open({ id: 'a' }))
      rerender({ lost: true })
      rerender({ lost: false })

      expect(result.current.isOpen).toBe(false)
      expect(result.current.data).toBeNull()
    })

    it('stays reopenable after a reset, with a fresh nonce', () => {
      const { result, rerender } = renderHook(
        ({ lost }: { lost: boolean }) => useRetainedDialog<Snapshot>({ resetWhen: lost }),
        { initialProps: { lost: false } }
      )

      act(() => result.current.open({ id: 'a' }))
      const first = result.current.nonce
      rerender({ lost: true })
      rerender({ lost: false })
      act(() => result.current.open({ id: 'b' }))

      expect(result.current.isOpen).toBe(true)
      expect(result.current.data).toEqual({ id: 'b' })
      expect(result.current.nonce).not.toBe(first)
    })
  })

  describe('callback identity', () => {
    it('keeps open/close/afterLeave stable across renders', () => {
      // `close` and `afterLeave` are passed straight to Modal props; Modal's
      // keydown effect lists `onClose` in its deps, so an identity that
      // changed every render would re-subscribe the document listener on
      // every render of the parent.
      const { result, rerender } = renderHook(() => useRetainedDialog<Snapshot>())
      const first = { ...result.current }

      act(() => result.current.open({ id: 'a' }))
      rerender()

      expect(result.current.open).toBe(first.open)
      expect(result.current.close).toBe(first.close)
      expect(result.current.afterLeave).toBe(first.afterLeave)
    })
  })
})
