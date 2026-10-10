import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

import { useOverlayEscape } from '../../../../hooks/useOverlayEscape'

/**
 * One popover, anchored under its trigger (§S5 A, E, H): Esc or a click outside closes it. The trigger toggles on
 * its own click, so a press on it is not "outside". The caller keeps one open at a time.
 */
export function ScenarioPopover({
  open,
  onClose,
  anchor,
  align = 'left',
  width,
  testId,
  editor = false,
  children,
}: {
  open: boolean
  onClose: () => void
  anchor: RefObject<HTMLElement | null>
  align?: 'left' | 'right'
  width?: number
  testId: string
  /** The popover holds a kit EditorForm (§24): the editor is the card, so the shell draws only the float. */
  editor?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlayEscape(open, onClose)
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => {
      const target = event.target as Node
      if (ref.current?.contains(target) || anchor.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open, onClose, anchor])
  if (!open) return null
  return (
    <div
      ref={ref}
      data-testid={testId}
      className={`absolute top-full z-30 mt-1 shadow-lg ${editor ? 'rounded-[10px]' : 'bg-card border-border rounded-lg border p-2'} ${align === 'right' ? 'right-0' : 'left-0'}`}
      style={width === undefined ? undefined : { width: `${String(width)}px` }}
    >
      {children}
    </div>
  )
}
