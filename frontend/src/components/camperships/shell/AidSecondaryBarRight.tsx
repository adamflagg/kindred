import { canOpenCamperships } from '../../../config/programAccess'
import { usePermissions } from '../../../hooks/usePermissions'
import { RemainingLine } from './RemainingLine'

/** The secondary bar's right side on /aid (§3.4): the Remaining line, and the jump box from PR 3. */
export function AidSecondaryBarRight() {
  const { hasPermission } = usePermissions()
  if (!canOpenCamperships({ hasPermission })) return null
  return (
    <div className="flex items-center gap-3.5">
      <RemainingLine />
    </div>
  )
}
