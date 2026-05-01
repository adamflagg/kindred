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

    // Focus search input on open
    const search = ref.current?.querySelector<HTMLInputElement>('input[role="searchbox"]')
    search?.focus()

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onMouseDown)
      // Restore focus to the trigger when closing
      trigger?.focus()
    }
  }, [open, onClose, triggerRef])

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
