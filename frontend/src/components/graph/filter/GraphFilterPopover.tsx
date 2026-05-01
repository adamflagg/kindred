/**
 * GraphFilterPopover — controlled popover that wraps GraphFilterTree.
 *
 * Closes on Escape and outside clicks (excluding the trigger button passed via
 * `triggerRef`, so the parent button's onClick can toggle without
 * race-canceling itself). Focuses the search input on open and restores focus
 * to the trigger on close.
 */
import { useEffect, useRef, type RefObject } from 'react'
import GraphFilterTree, { type GraphFilterTreeProps } from './GraphFilterTree'

export interface GraphFilterPopoverProps extends GraphFilterTreeProps {
  open: boolean
  onClose: () => void
  triggerRef?: RefObject<HTMLElement | null>
}

export default function GraphFilterPopover(props: GraphFilterPopoverProps) {
  const { open, onClose, triggerRef, ...treeProps } = props
  const ref = useRef<HTMLDivElement>(null)

  // Event listeners — depend on onClose; no focus side effects so onClose identity
  // changes while open don't accidentally steal focus from the search input.
  useEffect(() => {
    if (!open) return
    const trigger = triggerRef?.current ?? null

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onMouseDown = (e: MouseEvent) => {
      const popover = ref.current
      const target = e.target as Node | null
      if (!popover || !target) return
      if (popover.contains(target)) return
      if (trigger && trigger.contains(target)) return
      onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
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
