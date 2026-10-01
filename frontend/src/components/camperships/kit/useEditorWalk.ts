/**
 * Owner rulings A and B (2026-10-01, Group 1), for any surface whose rows open the shared editor,
 * as refined by the slice 1 plan review (C1, I3, M8, M9):
 * - A: ↓ moves at once. If that save fails and the row moved to has nothing typed, the highlight
 *   goes back to the failed row with its typed text (RequestEditor `draft`) and the error. If
 *   something is typed there, focus stays, and the failure waits in `failures` for the surface's
 *   "Couldn't save … · Go back" line (Decision 3).
 * - B: a click on another row while something is typed saves first, then moves, like ↓. Something
 *   that can't be saved yet keeps the row and shows the editor's own problem (Decision 5).
 * - Leaving (`leave`) saves what is typed, waits for every save in flight, and goes only when all
 *   have landed. A failure, new or still listed, keeps the person here on that row (Decision 4).
 * - After the surface unmounts nothing moves: a late failure can't drag the person back.
 * Esc throws away what was typed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { AidRowNav } from './AidTable'
import type { EditorDraftReport, EditorSave, EditorTyped } from './RequestEditor'

export interface EditorWalkOptions {
  readonly highlighted: string | null
  /**
   * Moves the highlight with no questions asked: the walk has saved what needed saving. Pass sync
   * state (a `useState` setter); a surface that keeps the row in its URL may pass a stable callback
   * that sets the state and writes the URL with replace in the same call (the Requests page does:
   * PR 2). It must be STABLE
   * (a state setter or a `useCallback`): `onHighlight`, the table's nav and its key listener
   * follow its identity.
   */
  readonly setHighlighted: (key: string | null) => void
  /** Writes one row's save. Rejects with an Error whose message staff can read. */
  readonly save: (rowKey: string, save: EditorSave) => Promise<unknown>
  /**
   * The rows the surface has data for. A failure on any other row (a refetch dropped it, or it was
   * cancelled elsewhere) leaves `failures` and `failed`, and never holds `leave`: nothing on screen
   * could clear it. Omit it to keep every failure. Pass a memoised Set.
   */
  readonly rowKeys?: ReadonlySet<string> | undefined
}

export interface WalkEditorProps {
  readonly draft: EditorTyped | undefined
  readonly saving: boolean
  readonly saveError: string | null
  readonly showProblem: boolean
  readonly onDraftChange: (report: EditorDraftReport | null) => void
  readonly onSave: (save: EditorSave) => void
  readonly onMove: (direction: 1 | -1, save: EditorSave | null) => void
  readonly onCancel: () => void
}

export interface EditorWalk {
  /** AidTable's `onHighlight`: a click on another row, the table's ↑/↓, or a "Go back" (ruling B). */
  readonly onHighlight: (key: string | null) => void
  /** The editor's props for the row it opens under. */
  readonly editorFor: (rowKey: string, nav: AidRowNav) => WalkEditorProps
  /** The editor's React key: it changes when a save lands on a row whose reopened editor still shows it. */
  readonly editorKey: (rowKey: string) => string
  /**
   * Every way out the surface controls (a name link, a view link, a filter): saves what is typed,
   * waits for every save in flight, then calls `go`, highlighting `rowKey` first (null: leave it).
   * A failure keeps the person here, back on the first failed row.
   */
  readonly leave: (rowKey: string | null, go: () => void) => void
  /** Failed saves by row, in the server's words: the surface names them, on screen or not. */
  readonly failures: ReadonlyMap<string, string>
  readonly failed: ReadonlySet<string>
}

interface Typed {
  readonly rowKey: string
  readonly report: EditorDraftReport
}

function withKey<V>(
  map: ReadonlyMap<string, V>,
  key: string,
  value: V | undefined
): ReadonlyMap<string, V> {
  if (value === undefined && !map.has(key)) return map
  const next = new Map(map)
  if (value === undefined) next.delete(key)
  else next.set(key, value)
  return next
}

function withMember(set: ReadonlySet<string>, key: string, on: boolean): ReadonlySet<string> {
  if (set.has(key) === on) return set
  const next = new Set(set)
  if (on) next.add(key)
  else next.delete(key)
  return next
}

/** What the open editor reported for `rowKey`, if it is that row's. */
function typedOn(typed: Typed | null, rowKey: string | null): EditorDraftReport | null {
  return rowKey !== null && typed?.rowKey === rowKey ? typed.report : null
}

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message !== '' ? error.message : "Couldn't save"

export function useEditorWalk({
  highlighted,
  setHighlighted,
  save,
  rowKeys,
}: EditorWalkOptions): EditorWalk {
  // Text to put back when the editor next opens on a row: what a moved-away or failed save sent.
  const [stash, setStash] = useState<ReadonlyMap<string, EditorTyped>>(() => new Map())
  // The same, for handlers (state read in a callback can be a render behind).
  const stashed = useRef(new Map<string, EditorTyped>())
  // A save the server refused, by row. Mirrored to a ref for `leave`.
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(() => new Map())
  const refused = useRef(new Map<string, string>())
  // Rows whose editor should show its own problem: a click or a leave found it not ready (M9).
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(() => new Set())
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set())
  // Bumped when a save lands on a reopened editor still showing it, to remount it (M8).
  const [revisions, setRevisions] = useState<ReadonlyMap<string, number>>(() => new Map())
  // What the open editor last reported. Written by its effect, read by handlers, never during render.
  const typed = useRef<Typed | null>(null)
  // Every save still in flight, by row (C1): `leave` waits for them all.
  const inFlight = useRef(new Map<string, Promise<boolean>>())
  // What each in-flight save carries, so the same figure is never written twice.
  const inFlightEntry = useRef(new Map<string, EditorSave>())
  // True while a `leave` is waiting: a second one is ignored, so `go` runs once.
  const leaving = useRef(false)
  // Rows whose in-flight save a click-away skipped re-writing: if it fails, it comes back like a ↓.
  const jumpOnFail = useRef(new Set<string>())
  // The highlight now, for a save that answers after the person has moved on.
  const now = useRef(highlighted)
  // False once the surface is gone: nothing moves or sets after that (C1).
  const mounted = useRef(false)
  // The rows the surface has now, for `leave` (read in handlers, never during render).
  const known = useRef(rowKeys)
  useEffect(() => {
    now.current = highlighted
  }, [highlighted])
  useEffect(() => {
    known.current = rowKeys
  }, [rowKeys])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const putStash = useCallback((rowKey: string, value: EditorTyped | undefined) => {
    if (value === undefined) stashed.current.delete(rowKey)
    else stashed.current.set(rowKey, value)
    setStash((m) => withKey(m, rowKey, value))
  }, [])

  const putError = useCallback((rowKey: string, message: string | undefined) => {
    if (message === undefined) refused.current.delete(rowKey)
    else refused.current.set(rowKey, message)
    setErrors((e) => withKey(e, rowKey, message))
  }, [])

  const write = useCallback(
    (
      rowKey: string,
      entry: EditorSave,
      jumpBack: boolean,
      // What an Enter-save sent, text and all, kept if it is refused (never before: see below).
      retain?: EditorTyped
    ): Promise<boolean> => {
      setSaving((s) => withMember(s, rowKey, true))
      putError(rowKey, undefined)
      const sent = stashed.current.get(rowKey)
      // A newer save for the row supersedes this one: it answers for the row (settled is read later).
      const latest = () => inFlight.current.get(rowKey) === settled
      const settled: Promise<boolean> = save(rowKey, entry)
        .then(
          () => {
            if (!mounted.current) return true
            if (!latest()) return true
            putError(rowKey, undefined)
            // M8: an editor reopened on this row and still showing exactly what was saved starts
            // again from the saved figure. Anything typed since stays the person's.
            const shown = typedOn(typed.current, rowKey)
            if (
              sent !== undefined &&
              shown !== null &&
              shown.raw === sent.raw &&
              shown.reason === sent.reason
            ) {
              typed.current = null
              setRevisions((r) => withKey(r, rowKey, (r.get(rowKey) ?? 0) + 1))
            }
            jumpOnFail.current.delete(rowKey)
            putStash(rowKey, undefined)
            return true
          },
          (error: unknown) => {
            // C1: after the surface is gone a late failure moves nothing.
            if (!mounted.current) return false
            // Superseded: the newer save for this row answers for it, so this failure is not listed.
            if (!latest()) return true
            putError(rowKey, messageOf(error))
            // A refused Enter-save is kept like a ↓ failure, so a remount of the editor (a refetch,
            // a regrouping) doesn't clear the typing and the listed failure together.
            if (retain !== undefined) putStash(rowKey, retain)
            const jump = jumpBack || jumpOnFail.current.has(rowKey)
            jumpOnFail.current.delete(rowKey)
            const open = now.current
            // Ruling A, refined (Decision 3): come back at once only when the row being worked on
            // has nothing typed; else focus stays and the surface's failure line offers Go back.
            if (jump && open !== rowKey && typedOn(typed.current, open) === null) {
              setHighlighted(rowKey)
            }
            return false
          }
        )
        .finally(() => {
          // A superseded save leaves `saving` to the newer one, which is still out.
          if (!latest()) return
          inFlight.current.delete(rowKey)
          inFlightEntry.current.delete(rowKey)
          if (mounted.current) setSaving((s) => withMember(s, rowKey, false))
        })
      inFlight.current.set(rowKey, settled)
      inFlightEntry.current.set(rowKey, entry)
      return settled
    },
    [save, setHighlighted, putStash, putError]
  )

  /** Is this exactly what the row's save in flight already carries? Then writing it again is noise. */
  const alreadySent = useCallback((rowKey: string, entry: EditorSave): boolean => {
    const flying = inFlightEntry.current.get(rowKey)
    return flying?.amount === entry.amount && flying.reason === entry.reason
  }, [])

  /** Leaves `rowKey`: keeps its text in case the save fails, moves at once, then writes (ruling A). */
  const moveFrom = useCallback(
    (rowKey: string, entry: EditorSave | null, go: () => void) => {
      const report = typedOn(typed.current, rowKey)
      if (entry !== null && report !== null)
        putStash(rowKey, { raw: report.raw, reason: report.reason })
      // Cleared before moving, so the move isn't taken for a click with something typed (ruling B).
      typed.current = null
      go()
      if (entry !== null) {
        if (alreadySent(rowKey, entry)) jumpOnFail.current.add(rowKey)
        else void write(rowKey, entry, true)
      }
    },
    [write, putStash, alreadySent]
  )

  const onHighlight = useCallback(
    (key: string | null) => {
      if (key === highlighted) return
      const report = typedOn(typed.current, highlighted)
      if (highlighted === null || report === null) {
        setHighlighted(key)
        return
      }
      if (report.save === null) {
        setBlocked((b) => withMember(b, highlighted, true))
        return
      }
      moveFrom(highlighted, report.save, () => setHighlighted(key))
    },
    [highlighted, moveFrom, setHighlighted]
  )

  const leave = useCallback(
    (rowKey: string | null, go: () => void) => {
      if (leaving.current) return
      leaving.current = true
      const conclude = (firstFailed: string | undefined) => {
        leaving.current = false
        if (!mounted.current) return
        if (firstFailed !== undefined) {
          // C1: stay, back on the failed row with its amount and its error.
          // Decision 3: the row being typed on is never taken; the failure stays listed (Go back).
          if (firstFailed !== now.current && typedOn(typed.current, now.current) === null) {
            setHighlighted(firstFailed)
          }
          return
        }
        typed.current = null
        if (rowKey !== null && rowKey !== now.current) setHighlighted(rowKey)
        go()
      }
      // A failure on a row the surface no longer has can't be cleared there, so it never holds a leave.
      const firstListed = () =>
        [...refused.current.keys()].find(
          (key) => known.current === undefined || known.current.has(key)
        )
      // Looked at again after every wait: what was typed or saved while it ran counts too.
      const pass = () => {
        if (!mounted.current) {
          leaving.current = false
          return
        }
        const open = now.current
        const report = typedOn(typed.current, open)
        if (open !== null && report !== null) {
          if (report.save === null) {
            leaving.current = false
            setBlocked((b) => withMember(b, open, true))
            return
          }
          if (!alreadySent(open, report.save)) {
            putStash(open, { raw: report.raw, reason: report.reason })
            void write(open, report.save, false)
          }
        }
        const waiting = [...inFlight.current.entries()]
        if (waiting.length === 0) {
          // A failure still listed holds the person here too: its typing would die with the page.
          conclude(firstListed())
          return
        }
        void Promise.all(waiting.map(([key, done]) => done.then((ok) => (ok ? null : key)))).then(
          (outcomes) => {
            const failedNow = outcomes.find(
              (key): key is string =>
                key !== null && (known.current === undefined || known.current.has(key))
            )
            if (failedNow !== undefined) conclude(failedNow)
            else pass()
          }
        )
      }
      pass()
    },
    [putStash, setHighlighted, write, alreadySent]
  )

  const editorFor = useCallback(
    (rowKey: string, nav: AidRowNav): WalkEditorProps => ({
      draft: stash.get(rowKey),
      saving: saving.has(rowKey),
      saveError: errors.get(rowKey) ?? null,
      showProblem: blocked.has(rowKey),
      onDraftChange: (report) => {
        setBlocked((b) => withMember(b, rowKey, false))
        if (report !== null) {
          typed.current = { rowKey, report }
          return
        }
        if (typed.current?.rowKey === rowKey) typed.current = null
        // Back to what it opened with: nothing is waiting to be put back.
        putStash(rowKey, undefined)
        putError(rowKey, undefined)
      },
      onSave: (entry) => {
        const report = typedOn(typed.current, rowKey)
        void write(
          rowKey,
          entry,
          false,
          report === null ? undefined : { raw: report.raw, reason: report.reason }
        )
      },
      onMove: (direction, entry) => {
        moveFrom(rowKey, entry, direction === 1 ? nav.next : nav.previous)
      },
      onCancel: () => {
        if (typed.current?.rowKey === rowKey) typed.current = null
        putStash(rowKey, undefined)
        putError(rowKey, undefined)
        setBlocked((b) => withMember(b, rowKey, false))
        // Straight to the setter: Esc throws the typing away, so there is nothing to save first.
        setHighlighted(null)
      },
    }),
    [stash, saving, errors, blocked, write, moveFrom, putStash, putError, setHighlighted]
  )

  const editorKey = useCallback(
    (rowKey: string) => `${rowKey}:${String(revisions.get(rowKey) ?? 0)}`,
    [revisions]
  )

  const failures = useMemo(
    () =>
      rowKeys === undefined ? errors : new Map([...errors].filter(([key]) => rowKeys.has(key))),
    [errors, rowKeys]
  )
  const failed = useMemo(() => new Set(failures.keys()), [failures])

  return { onHighlight, editorFor, editorKey, leave, failures, failed }
}
