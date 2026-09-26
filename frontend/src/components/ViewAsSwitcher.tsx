/**
 * Admin "View as" persona switcher.
 *
 * Rendered for a REAL admin outside bypass mode, and it stays rendered while
 * previewing: it is gated on `realIsAdmin`, never the effective `isAdmin`, so
 * the way back can never be hidden. Every switch reloads the page so nothing
 * fetched under the previous persona survives in any cache. The persona itself
 * lives in auth/viewAs.ts; PocketBase and FastAPI enforce it.
 */
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Eye, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import { useRoles } from '../hooks/useRoles'
import { ALL_PERMISSIONS } from '../constants/permissions'
import { clearViewAs, writeViewAs, type ViewAsPersona } from '../auth/viewAs'

function switchTo(persona: ViewAsPersona | null) {
  if (persona === null) clearViewAs()
  else writeViewAs(persona)
  window.location.reload()
}

const byName = (a: string, b: string) => a.localeCompare(b)

const itemClass =
  'hover:bg-muted/50 text-foreground flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors'
const sectionClass =
  'text-muted-foreground px-3 pt-2 pb-1 text-xs font-bold tracking-wider uppercase'

function CheckSlot({ on }: { on: boolean }) {
  return (
    <span className="text-primary w-4 flex-shrink-0 pt-0.5">
      {on && <Check className="h-4 w-4" />}
    </span>
  )
}

export function ViewAsSwitcher() {
  const { isBypassMode } = useAuth()
  const { realIsAdmin, viewAs } = usePermissions()
  const canSwitch = realIsAdmin && !isBypassMode
  const { data: roles = [] } = useRoles({ enabled: canSwitch })
  const [isOpen, setIsOpen] = useState(false)
  const [isCustomOpen, setIsCustomOpen] = useState(viewAs?.source === 'custom')
  const [customPerms, setCustomPerms] = useState<string[]>(
    viewAs?.source === 'custom' ? viewAs.permissions : []
  )
  const menuRef = useRef<HTMLDivElement>(null)

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
  }, [isOpen])

  if (!canSwitch) return null

  const label =
    viewAs === null
      ? null
      : viewAs.source === 'custom'
        ? `Custom (${viewAs.permissions.length})`
        : viewAs.label

  const toggleCustomPerm = (perm: string) =>
    setCustomPerms((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm].sort(byName)
    )

  const chevron = (
    <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
  )

  return (
    <div className="relative flex items-center" ref={menuRef}>
      {label === null ? (
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 rounded-xl border border-white/25 px-3 py-2 text-sm font-semibold text-white/85 transition-all hover:bg-white/10"
        >
          <Eye className="h-4 w-4" />
          View as
          {chevron}
        </button>
      ) : (
        <div className="text-forest-900 flex items-center overflow-hidden rounded-xl border border-amber-600 bg-amber-500 text-sm font-bold">
          <button
            onClick={() => setIsOpen(!isOpen)}
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
        <div className="card-lodge shadow-lodge-lg animate-scale-in absolute top-full right-0 z-50 mt-2 w-80 p-2">
          <p className={sectionClass}>View as</p>
          <button onClick={() => switchTo(null)} className={itemClass}>
            <CheckSlot on={viewAs === null} />
            <span>
              <span className="font-semibold">Admin</span>
              <span className="bg-primary/15 text-primary ml-2 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold uppercase">
                you
              </span>
              <span className="text-muted-foreground block text-xs">
                {viewAs === null ? 'Your real access' : 'Exit preview — back to your real access'}
              </span>
            </span>
          </button>

          <div className="bg-border my-2 h-px" />
          <p className={sectionClass}>Roles</p>
          {roles.map((role) => (
            <button
              key={role.id}
              onClick={() =>
                switchTo({
                  label: role.name,
                  source: 'role',
                  permissions: [...role.permissions].sort(byName),
                })
              }
              className={itemClass}
            >
              <CheckSlot on={viewAs?.source === 'role' && viewAs.label === role.name} />
              <span>
                <span className="font-semibold">{role.name}</span>
                <span className="text-muted-foreground block text-xs">
                  {role.permissions.length > 0 ? role.permissions.join(' · ') : 'No permissions'}
                </span>
              </span>
            </button>
          ))}

          <div className="bg-border my-2 h-px" />
          <button
            onClick={() => switchTo({ label: 'No role', source: 'none', permissions: [] })}
            className={itemClass}
          >
            <CheckSlot on={viewAs?.source === 'none'} />
            <span>
              <span className="font-semibold">No role</span>
              <span className="text-muted-foreground block text-xs">
                What a new staff member sees before anyone grants them access
              </span>
            </span>
          </button>
          <button onClick={() => setIsCustomOpen(!isCustomOpen)} className={itemClass}>
            <CheckSlot on={viewAs?.source === 'custom'} />
            <span>
              <span className="font-semibold">Custom…</span>
              <span className="text-muted-foreground block text-xs">
                Any combination of permissions
              </span>
            </span>
          </button>
          {isCustomOpen && (
            <div className="px-3 pb-2 pl-10">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {ALL_PERMISSIONS.map((perm) => (
                  <label key={perm} className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={customPerms.includes(perm)}
                      onChange={() => toggleCustomPerm(perm)}
                    />
                    {perm}
                  </label>
                ))}
              </div>
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
          <p className="text-muted-foreground px-3 pt-2 pb-1 text-xs">
            Switching reloads the page. Only this tab previews — other tabs keep your real access.
            Changes you make while previewing are real.
          </p>
        </div>
      )}
    </div>
  )
}
