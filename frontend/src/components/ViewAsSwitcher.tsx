/**
 * Admin "View as" persona switcher.
 *
 * Available to a REAL admin outside bypass mode, and it stays available while
 * previewing: it is gated on `realIsAdmin`, never the effective `isAdmin`, so
 * the way back can never be hidden. Not previewing, the bar shows nothing: the
 * menu is opened from the user menu's "View as…" item (owner ruling
 * 2026-10-01), via the controlled `open` / `onOpenChange` props. While
 * previewing, the amber pill sits in the bar and opens the same menu. Every switch reloads the page so nothing
 * fetched under the previous persona survives in any cache. The persona itself
 * lives in auth/viewAs.ts; PocketBase and FastAPI enforce it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Eye, X } from 'lucide-react'
import { usePermissions } from '../hooks/usePermissions'
import { useCanViewAs } from '../hooks/useCanViewAs'
import { useRoles } from '../hooks/useRoles'
import { ALL_PERMISSIONS } from '../constants/permissions'
import { ViewAsPermissionPicker } from './ViewAsPermissionPicker'
import {
  clearViewAs,
  readViewAs,
  viewAsLabel,
  writeViewAs,
  type ViewAsPersona,
} from '../auth/viewAs'
import { recordViewAsSwitch } from '../auth/viewAsAudit'

function switchTo(persona: ViewAsPersona | null) {
  // Every start, persona change and exit goes through here: tell the admin
  // audit log first, while storage still holds the persona being left.
  recordViewAsSwitch(readViewAs(), persona)
  if (persona === null) clearViewAs()
  else writeViewAs(persona)
  window.location.reload()
}

const byName = (a: string, b: string) => a.localeCompare(b)

const itemClass =
  'hover:bg-muted/50 text-foreground flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition-colors'
const sectionClass =
  'text-muted-foreground flex-shrink-0 px-3 pt-1.5 pb-1 text-xs font-bold tracking-wider uppercase'

function CheckSlot({ on }: { on: boolean }) {
  return (
    <span className="text-primary w-4 flex-shrink-0">{on && <Check className="h-4 w-4" />}</span>
  )
}

interface ViewAsSwitcherProps {
  /** Controlled open state; the menu is uncontrolled when omitted. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function ViewAsSwitcher({ open, onOpenChange }: ViewAsSwitcherProps) {
  const { viewAs } = usePermissions()
  const canSwitch = useCanViewAs()
  const {
    data: roles = [],
    isLoading: rolesLoading,
    error: rolesError,
  } = useRoles({ enabled: canSwitch })
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isOpen = open ?? uncontrolledOpen
  const [isCustomOpen, setIsCustomOpen] = useState(viewAs?.source === 'custom')
  const [customPerms, setCustomPerms] = useState<string[]>(
    viewAs?.source === 'custom' ? viewAs.permissions : []
  )
  // Closing discards a Custom selection that was never applied, so the next
  // open, from the pill or from outside, starts from the real persona.
  const setIsOpen = useCallback(
    (next: boolean) => {
      if (!next) {
        setIsCustomOpen(viewAs?.source === 'custom')
        setCustomPerms(viewAs?.source === 'custom' ? viewAs.permissions : [])
      }
      setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange, viewAs]
  )
  const menuRef = useRef<HTMLDivElement>(null)

  const toggleMenu = () => setIsOpen(!isOpen)

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setIsOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, setIsOpen])

  if (!canSwitch) return null

  const label = viewAs === null ? null : viewAsLabel(viewAs)

  const chevron = (
    <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
  )

  return (
    <div className="relative flex items-center" ref={menuRef}>
      {label !== null && (
        <div className="text-forest-900 flex items-center overflow-hidden rounded-xl border border-amber-600 bg-amber-500 text-sm font-bold">
          <button
            onClick={toggleMenu}
            className="flex items-center gap-2 px-3 py-2 hover:bg-amber-400"
          >
            <Eye className="h-4 w-4" />
            {label}
            {chevron}
          </button>
          <button
            onClick={() => switchTo(null)}
            aria-label="Exit preview"
            className="border-l border-amber-600 px-2 py-2 hover:bg-amber-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {isOpen && (
        // Capped at the viewport below the sticky header. Only the role list
        // scrolls: Admin stays pinned on top, and No role / Custom (with its
        // picker and Apply) plus the footer never shrink, so they are always
        // reachable however many roles exist or however short the window is.
        <div
          data-testid="view-as-menu"
          className="card-lodge shadow-lodge-lg animate-scale-in text-foreground absolute top-full right-0 z-50 mt-2 flex max-h-[calc(100vh-5rem)] w-72 flex-col p-2"
        >
          <p className={sectionClass}>View as</p>
          <button
            onClick={() => switchTo(null)}
            className={itemClass}
            title={viewAs === null ? 'Your real access' : 'Exit preview — back to your real access'}
          >
            <CheckSlot on={viewAs === null} />
            <span className="font-semibold">Admin</span>
            <span className="bg-primary/15 text-primary rounded-md px-1.5 py-0.5 text-[10px] font-extrabold uppercase">
              you
            </span>
            {viewAs !== null && (
              <span className="text-muted-foreground ml-auto text-xs">exit preview</span>
            )}
          </button>

          <div className="bg-border my-1.5 h-px flex-shrink-0" />
          <p className={sectionClass}>Roles</p>
          <div data-testid="view-as-roles" className="min-h-10 flex-1 overflow-y-auto">
            {/* No role and Custom below stay usable whether or not roles loaded. */}
            {rolesLoading && (
              <p className="text-muted-foreground px-3 py-1.5 text-xs">Loading roles…</p>
            )}
            {rolesError && (
              <p className="text-muted-foreground px-3 py-1.5 text-xs">Couldn&apos;t load roles</p>
            )}
            {roles.map((role) => (
              <button
                key={role.id}
                onClick={() =>
                  switchTo({
                    label: role.name,
                    source: 'role',
                    roleId: role.id,
                    permissions: [...role.permissions].sort(byName),
                  })
                }
                className={itemClass}
                title={
                  role.permissions.length > 0 ? role.permissions.join(' · ') : 'No permissions'
                }
              >
                <CheckSlot on={viewAs?.source === 'role' && viewAs.roleId === role.id} />
                <span className="truncate font-semibold">{role.name}</span>
              </button>
            ))}
          </div>

          <div className="flex-shrink-0">
            <div className="bg-border my-1.5 h-px" />
            <button
              onClick={() => switchTo({ label: 'No role', source: 'none', permissions: [] })}
              className={itemClass}
              title="What a new staff member sees before anyone grants them access"
            >
              <CheckSlot on={viewAs?.source === 'none'} />
              <span className="font-semibold">No role</span>
            </button>
            <button
              onClick={() => setIsCustomOpen(!isCustomOpen)}
              className={itemClass}
              title="Any combination of permissions"
            >
              <CheckSlot on={viewAs?.source === 'custom'} />
              <span className="font-semibold">Custom…</span>
            </button>
            {isCustomOpen && (
              <div className="px-3 pb-2 pl-9">
                <ViewAsPermissionPicker
                  all={ALL_PERMISSIONS}
                  selected={customPerms}
                  onChange={setCustomPerms}
                />
                <button
                  onClick={() =>
                    switchTo({ label: 'Custom', source: 'custom', permissions: customPerms })
                  }
                  className="bg-primary text-primary-foreground mt-2 rounded-lg px-3 py-1.5 text-xs font-bold"
                >
                  Apply
                </button>
              </div>
            )}
            <p className="text-muted-foreground px-3 pt-1.5 pb-1 text-xs">
              Reloads the page · this tab only · changes you make are real
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
