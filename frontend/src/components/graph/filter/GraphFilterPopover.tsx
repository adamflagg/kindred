/**
 * GraphFilterPopover — controlled popover that wraps GraphFilterTree.
 *
 * Closes on Escape and outside clicks (excluding the trigger button passed via
 * `triggerRef`, so the parent button's onClick can toggle without
 * race-canceling itself). Focuses the search input on open and restores focus
 * to the trigger on close.
 *
 * NEEDS AN OVERLAY TOKEN (kindred#2237): this popover is rendered by the
 * EXPANDED `SocialNetworkGraph`, which collapses itself on Escape from its own
 * `window` listener. Two ungated handlers, one keypress, both fired -- the
 * filter closed and the graph it was filtering collapsed with it. Going
 * through `useOverlayEscape` makes this the topmost overlay while it is open,
 * and its conditional `stopPropagation` keeps the key from ever reaching the
 * graph beneath. That also means the graph itself needs no token: a
 * document-capture stop lands before any `window` bubble listener runs.
 */
import { useEffect, useRef, type RefObject } from 'react'
import GraphFilterTree, { type GraphFilterTreeProps } from './GraphFilterTree'
import { useOverlayEscape } from '../../../hooks/useOverlayEscape'

export interface GraphFilterPopoverProps extends GraphFilterTreeProps {
  open: boolean
  onClose: () => void
  triggerRef?: RefObject<HTMLElement | null>
}

export default function GraphFilterPopover(props: GraphFilterPopoverProps) {
  const { open, onClose, triggerRef, ...treeProps } = props
  const ref = useRef<HTMLDivElement>(null)

  useOverlayEscape(open, onClose)

  // Outside-click only — Escape is owned by `useOverlayEscape` above. Depends
  // on onClose; no focus side effects so onClose identity changes while open
  // don't accidentally steal focus from the search input.
  useEffect(() => {
    if (!open) return
    const trigger = triggerRef?.current ?? null

    const onMouseDown = (e: MouseEvent) => {
      const popover = ref.current
      const target = e.target as Node | null
      if (!popover || !target) return
      if (popover.contains(target)) return
      if (trigger && trigger.contains(target)) return
      onClose()
    }

    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [open, onClose, triggerRef])

  // Focus management — isolated from onClose so its identity changes don't trigger
  // a premature focus restore while the popover is still open.
  useEffect(() => {
    if (!open) return
    const trigger = triggerRef?.current ?? null
    const search = ref.current?.querySelector<HTMLInputElement>('input[role="searchbox"]')
    search?.focus()
    return () => {
      trigger?.focus()
    }
  }, [open, triggerRef])

  if (!open) return null

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Graph filter"
      className="border-border bg-background absolute top-full right-0 z-30 mt-1 w-80 overflow-hidden rounded-lg border shadow-lg"
    >
      <GraphFilterTree {...treeProps} />
    </div>
  )
}
