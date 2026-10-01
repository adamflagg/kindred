import type { ApiAidPreview } from '../../../types/api-types'
import type { EditorPreview } from './RequestEditor'

/** Who a payer share belongs to, as the surface knows it: the page's chip and name, when it has them. */
export interface PreviewHousehold {
  readonly chip: number | null
  readonly name: string | null
}

/**
 * The preview read as the editor shows it (§4.6). The stage words are the server's own
 * (`stage_after_label`); no code-to-words map lives here (#2924 frontend edit 3).
 */
export function toEditorPreview(
  out: ApiAidPreview,
  householdOf: (householdCmId: number) => PreviewHousehold
): EditorPreview {
  return {
    status: 'ready',
    award: out.award,
    trace: out.trace,
    stageChange: out.stage_after_label,
    pendingApproval: out.pending_approval,
    shares: out.shares.map((share) => {
      const household = householdOf(share.household_cm_id)
      return {
        householdCmId: share.household_cm_id,
        chip: household.chip,
        householdName: household.name,
        pct: share.pct,
        amount: share.amount,
      }
    }),
  }
}
