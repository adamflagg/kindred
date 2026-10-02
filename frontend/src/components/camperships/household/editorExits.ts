import { useMemo } from 'react'

type Leave = (go: () => void) => void

/**
 * The page's one open editor (F2 4/5). A working card with an editor open registers how to leave it
 * (save what is typed, then go); an exit the page owns asks here first, and so does a card opening its
 * own editor, so there is only ever one editor open on the page.
 */
export interface EditorExits {
  /** Leave the open editor, if any, then `go`. A failed or unsaveable edit never calls `go`. */
  beforeLeave(go: () => void): void
  /** Leave every editor but `id`'s, then `go`. */
  leaveOthers(id: string, go: () => void): void
  /** A card's open editor; the returned function unregisters it. */
  register(id: string, leave: Leave): () => void
}

export function createEditorExits(): EditorExits {
  const open = new Map<string, Leave>()
  const leaveFirst = (skip: string | null, go: () => void) => {
    // Read at the moment of asking, never captured earlier: a save in between may have closed it.
    const other = [...open].find(([id]) => id !== skip)
    if (other === undefined) go()
    else other[1](go)
  }
  return {
    beforeLeave: (go) => leaveFirst(null, go),
    leaveOthers: (id, go) => leaveFirst(id, go),
    register: (id, leave) => {
      open.set(id, leave)
      return () => {
        if (open.get(id) === leave) open.delete(id)
      }
    },
  }
}

/** One stable coordinator for the page. */
export function useEditorExits(): EditorExits {
  return useMemo(createEditorExits, [])
}
