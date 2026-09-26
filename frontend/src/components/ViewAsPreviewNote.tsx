/**
 * Read-only "Previewing as …" note for popout windows.
 *
 * Popouts (post-check, camper details) are opened with window.open, which
 * copies this tab's sessionStorage — so a popout enforces whatever persona was
 * active when it opened, and keeps it after the main tab exits. Popout routes
 * have no app shell, hence no ViewAsSwitcher chip; this note is the only way to
 * see that the window is previewing. It has no controls: exiting happens in
 * the main window.
 */
import { Eye } from 'lucide-react'
import { usePermissions } from '../hooks/usePermissions'
import { viewAsLabel } from '../auth/viewAs'

export function ViewAsPreviewNote() {
  const { viewAs } = usePermissions()
  if (viewAs === null) return null
  return (
    <div className="text-forest-900 flex items-center gap-2 border-b border-amber-600 bg-amber-500 px-3 py-1.5 text-xs font-bold">
      <Eye className="h-3.5 w-3.5 flex-shrink-0" />
      <span>
        Previewing as {viewAsLabel(viewAs)} · this pop-out keeps the preview it opened with — close
        and reopen it to change
      </span>
    </div>
  )
}
