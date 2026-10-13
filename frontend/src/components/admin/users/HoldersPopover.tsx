import { useCallback, useEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { RecordModel } from 'pocketbase'
import { useOverlayEscape } from '../../../hooks/useOverlayEscape'
import { useAnchoredOverlay } from '../../ui/useAnchoredOverlay'
import { UserAvatar } from './UserAvatar'
import { grantedVia, permissionHolders } from './usersPageModel'
import type { UsersPageData } from './types'

const WIDTH = 260
const ROW = 'flex h-[30px] w-full items-center gap-2 rounded-[7px] px-1.5 text-left text-[13px]'

const displayName = (u: RecordModel) => String(u['name'] ?? '') || String(u['email'] ?? '')

/**
 * "Who holds it" (owner 2026-10-13, option B): the non-admin holders of one
 * permission, in a card under its "N people" count. Admins are left to the
 * tab's purple strip. Escape, a click outside, or picking a name closes it;
 * it follows the count when the list scrolls and hides while the count is
 * scrolled out of the list.
 */
export function HoldersPopover({
  code,
  anchor,
  clip,
  data,
  canOpen,
  onOpen,
  onClose,
}: {
  code: string
  /** The count button that opened it. */
  anchor: HTMLElement
  /** The scroll box the count lives in. */
  clip: RefObject<HTMLElement | null>
  data: UsersPageData
  canOpen: (user: RecordModel) => boolean
  onOpen: (userId: string) => void
  onClose: () => void
}) {
  const holders = permissionHolders(code, data.users, data.held).sort((a, b) =>
    displayName(a).localeCompare(displayName(b))
  )

  // Right edge 6px past the count's (the mock's placement): a WIDTH-wide
  // anchor rect ending there, so 'below' centring lands the card on it.
  const getAnchorRect = useCallback(() => {
    const r = anchor.getBoundingClientRect()
    return { top: r.top, height: r.height, left: r.right + 6 - WIDTH, width: WIDTH }
  }, [anchor])
  const { ref, position } = useAnchoredOverlay<HTMLDivElement>({
    open: true,
    getAnchorRect,
    placement: 'below',
    gap: 6,
  })

  useOverlayEscape(true, () => {
    onClose()
    anchor.focus()
  })

  useEffect(() => {
    // The count toggles on its own click, so a press on it is not "outside".
    const outside = (event: MouseEvent) => {
      const target = event.target as Node
      if (anchor.contains(target) || ref.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [anchor, ref, onClose])

  const [clipped, setClipped] = useState(false)
  useEffect(() => {
    const check = () => {
      const box = clip.current?.getBoundingClientRect()
      const r = anchor.getBoundingClientRect()
      setClipped(box !== undefined && (r.bottom < box.top || r.top > box.bottom))
    }
    window.addEventListener('scroll', check, true)
    return () => window.removeEventListener('scroll', check, true)
  }, [anchor, clip])

  return createPortal(
    <div
      ref={ref}
      data-testid="perm-holders"
      className={`bg-card border-border fixed z-50 rounded-[10px] border p-1.5 shadow-lg ${
        clipped ? 'invisible' : ''
      }`}
      style={{
        width: WIDTH,
        top: `${String(position?.top ?? -9999)}px`,
        left: `${String(position?.left ?? -9999)}px`,
      }}
    >
      <div
        data-testid="holders-head"
        className="text-muted-foreground border-border mb-1 flex items-center gap-1.5 border-b px-1.5 pt-[3px] pb-[7px] text-[10.5px] font-bold tracking-[0.06em] uppercase"
      >
        Who holds it
        <span className="font-medium opacity-75">{holders.length}</span>
      </div>
      <ul className="max-h-[240px] overflow-y-auto">
        {holders.map((u) => {
          const via = grantedVia(code, data.held.get(u.id) ?? [])
          const inner = (
            <>
              <UserAvatar user={u} size={22} />
              <span data-testid="holder-name" className="truncate">
                {displayName(u)}
              </span>
              {via.length > 1 && (
                <span className="text-muted-foreground ml-auto text-[11.5px] font-normal whitespace-nowrap">
                  via {via.map((r) => r.name).join(' + ')}
                </span>
              )}
            </>
          )
          return (
            <li key={u.id}>
              {canOpen(u) ? (
                <button
                  type="button"
                  className={`${ROW} hover:bg-muted`}
                  onClick={() => onOpen(u.id)}
                >
                  {inner}
                </button>
              ) : (
                <div className={ROW}>{inner}</div>
              )}
            </li>
          )
        })}
      </ul>
    </div>,
    document.body
  )
}
