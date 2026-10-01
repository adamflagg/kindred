import { canOpenCamperships } from '../../../config/programAccess'
import { Permission } from '../../../constants/permissions'
import { usePermissions } from '../../../hooks/usePermissions'
import { JumpBox } from './JumpBox'
import { RemainingLine } from './RemainingLine'

/**
 * The secondary bar's right side on /aid (§3.4): the Remaining line for everyone (D48, D75), then
 * the jump box for `view` holders. A summary-only user has none (D65).
 */
export function AidSecondaryBarRight() {
  const { hasPermission } = usePermissions()
  if (!canOpenCamperships({ hasPermission })) return null
  return (
    <div className="flex items-center gap-3.5">
      <RemainingLine />
      {hasPermission(Permission.FINANCIAL_AID_VIEW) && <JumpBox />}
    </div>
  )
}
