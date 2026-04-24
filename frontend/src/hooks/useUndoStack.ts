/**
 * useUndoStack Hook
 *
 * Client-only in-session undo stack for request actions (approve / decline).
 *
 * - Capacity: 3 entries. Pushing a 4th drops the oldest.
 * - Entries are React state — the stack clears on page refresh (by design).
 * - Each entry captures an `inverse` function that, when called, reverts
 *   the action on the server (e.g. PATCH status back to 'pending').
 *
 * API:
 *   const { push, pop, peek, clear, stackSize, canUndo } = useUndoStack()
 */

import { useState, useCallback } from 'react'

export interface UndoEntry {
  /** The PocketBase record ID of the affected request. */
  id: string
  /** Human-readable label shown in the Undo button tooltip / toast. */
  label: string
  /** Async function that reverts the action on the server. */
  inverse: () => Promise<void>
}

export interface UseUndoStackResult {
  /** Push a new entry onto the stack (oldest drops off at capacity > 3). */
  push: (entry: UndoEntry) => void
  /** Pop and return the top entry (LIFO). Returns undefined if empty. */
  pop: () => UndoEntry | undefined
  /** Peek at the top entry without removing it. Returns undefined if empty. */
  peek: () => UndoEntry | undefined
  /** Clear the entire stack. */
  clear: () => void
  /** Number of entries currently on the stack. */
  stackSize: number
  /** True when there is at least one entry that can be undone. */
  canUndo: boolean
}

const MAX_STACK_SIZE = 3

export function useUndoStack(): UseUndoStackResult {
  const [stack, setStack] = useState<UndoEntry[]>([])
  // Expose an imperative ref so pop() can synchronously read + mutate.
  const stackRef = { current: stack }
  stackRef.current = stack

  const push = useCallback((entry: UndoEntry) => {
    setStack((prev) => {
      // Append new entry; if over capacity, drop the oldest (index 0).
      const next = [...prev, entry]
      if (next.length > MAX_STACK_SIZE) {
        return next.slice(next.length - MAX_STACK_SIZE)
      }
      return next
    })
  }, [])

  const pop = useCallback((): UndoEntry | undefined => {
    const current = stackRef.current
    if (current.length === 0) return undefined
    const popped = current[current.length - 1]
    setStack(current.slice(0, current.length - 1))
    return popped
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack])

  const peek = useCallback((): UndoEntry | undefined => {
    return stack[stack.length - 1]
  }, [stack])

  const clear = useCallback(() => {
    setStack([])
  }, [])

  return {
    push,
    pop,
    peek,
    clear,
    stackSize: stack.length,
    canUndo: stack.length > 0,
  }
}
